import { App, Assistant } from "@slack/bolt";
import dotenv from "dotenv";
import { runAgent } from "./agentFactory";
import { initializeMcpClient } from "./mcpClient";

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Create assistant instance
const assistant = new Assistant({
  threadStarted: async ({ saveThreadContext, say }) => {
    try {
      await say({
        text: "Hi! I'm your Plex assistant. Ask me anything about your Plex library, like 'How many movies do I have?' or 'What TV shows are in my library?'"
      });

      await saveThreadContext();
    } catch (error) {
      console.error("Error in threadStarted:", error);
    }
  },

  userMessage: async ({ message, say, setStatus, setSuggestedPrompts, client }) => {
    try {
      // @ts-ignore - message has text
      const prompt = message.text?.trim();

      if (!prompt) {
        return;
      }

      console.log(message)

      // Get user info to match with Plex user
      let userEmail = null;
      try {
        // @ts-ignore - message has user_id
        const userInfo = await client.users.info({ user: message.user });
        console.log(userInfo)
        userEmail = userInfo.user?.profile?.email;
      } catch (err) {
        console.error("Could not fetch user email:", err);
      }

      // Set status while processing
      await setStatus("Fetching information to provide a complete response...");

      // Run the agent with user context
      const reply = await runAgent(prompt, "read", userEmail);

      // Send the response
      await say({
        text: reply
      });

      // Suggest follow-up prompts
      await setSuggestedPrompts({
        prompts: [
          { title: "Show my TV shows", message: "What TV shows do I have?" },
          { title: "Count my movies", message: "How many movies do I have?" },
          { title: "Recent additions", message: "What was recently added?" }
        ]
      });
    } catch (error) {
      console.error("Error in userMessage:", error);
      await say({
        text: "Sorry, I encountered an error processing your request."
      });
    }
  }
});

// Register the assistant with the app
app.assistant(assistant);

// Handle @mentions in channels (separate from Assistant tab)
app.event("app_mention", async ({ event, say, client }) => {
  try {
    // Remove the bot mention from the message
    const prompt = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

    if (!prompt) {
      await say({
        text: "How can I help you with your Plex library?",
        thread_ts: event.ts
      });
      return;
    }

    // Get user info to match with Plex user
    let userEmail = null;
    try {
      const userInfo = await client.users.info({ user: event.user });
      userEmail = userInfo.user?.profile?.email;
    } catch (err) {
      console.error("Could not fetch user email:", err);
    }

    // Set status while processing (only if in a thread, not for top-level messages)
    try {
      await client.assistant.threads.setStatus({
        channel_id: event.channel,
        thread_ts: event.ts,
        status: "Fetching information to provide a complete response..."
      });
    } catch (statusError) {
      // Ignore status errors - not all messages support this
      console.log("Could not set status (this is normal for top-level messages)");
    }

    // Run the agent with user context
    const reply = await runAgent(prompt, "read", userEmail);

    // Clear status
    try {
      await client.assistant.threads.setStatus({
        channel_id: event.channel,
        thread_ts: event.ts,
        status: ""
      });
    } catch (statusError) {
      // Ignore status errors
    }

    // Post the final response in the thread
    await say({
      text: reply,
      thread_ts: event.ts
    });
  } catch (error) {
    console.error("Error in app_mention:", error);
    await say({
      text: "Sorry, I encountered an error processing your request.",
      thread_ts: event.ts
    });
  }
});

// Keep slash command for backwards compatibility
app.command("/plex", async ({ command, ack, respond }) => {
  await ack();
  try {
    const [subcommand, ...args] = command.text.split(" ");
    const prompt = args.join(" ");

    if (subcommand === "ask") {
      const reply = await runAgent(prompt, "read");
      await respond(reply);
    } else if (subcommand === "rename") {
      const reply = await runAgent(prompt, "write");
      await respond(reply);
    } else {
      await respond(`Unknown subcommand: ${subcommand}`);
    }
  } catch (error) {
    console.log("ERROR!!!")
    console.error(error)
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack trace:", error.stack);
    }
  }
});

(async () => {
  // Initialize MCP client connection first
  await initializeMcpClient();

  // Then start the Slack app
  await app.start(parseInt(process.env.PORT || "3000"));
  console.log("⚡ Plex Slack Bot is running!");
})();
