import { App, Assistant } from "@slack/bolt";
import dotenv from "dotenv";
import { runAgent } from "./agentFactory";
import { initializeMcpClient } from "./mcpClient";
import { log } from "./logger";
import { getThreadHistory } from "./threadHistory";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

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
      log.error("Error in threadStarted:", error as Error);
    }
  },

  userMessage: async ({ message, say, setStatus, setSuggestedPrompts, client, context, payload, getThreadContext }) => {
    try {
      
      const prompt = 'text' in message && message.text?.trim();

      if (!prompt) {
        return;
      }

      if (message.subtype === undefined) {
        log.debug("Received message from Assistant", {
          text: message.text,
          user: message.user,
        });
      }

      // Get user info to match with Plex user
      let userEmail = null;
      try {
        if (!('user' in message) || !message.user) throw Error("Message does not contain user property")
        const userInfo = await client.users.info({ user: message.user });
        log.debug("User info retrieved", {
          email: userInfo.user?.profile?.email,
          name: userInfo.user?.real_name
        });
        userEmail = userInfo.user?.profile?.email;
      } catch (err) {
        log.error("Could not fetch user email:", err as Error);
      }

      // Get thread context from Assistant API
      const threadContext = await getThreadContext();

      // Fetch thread history for context
      log.debug("Assistant context info", {
        payloadKeys: Object.keys(payload),
        messageKeys: Object.keys(message),
        threadContext: threadContext,
        channel: payload.channel
      });

      // @ts-ignore - try multiple possible field names
      const channelId = payload.channel_id || payload.channelId || payload.channel || message.channel;
      const threadTs = 'thread_ts' in payload ?  payload.thread_ts : threadContext?.channel_id;

      let conversationHistory: ChatCompletionMessageParam[] = [];
      if (channelId && threadTs && context.botUserId) {
        conversationHistory = await getThreadHistory(
          client,
          channelId,
          threadTs,
          context.botUserId
        );
      } else {
        log.warn("Cannot fetch thread history - missing channel, thread, or bot user I info", {
          channelId,
          threadTs,
          botUserId: context.botUserId,
          availablePayloadKeys: Object.keys(payload)
        });
      }

      // Set status while processing
      await setStatus("Fetching information to provide a complete response...");

      // Run the agent with user context and conversation history
      const reply = await runAgent(prompt, "read", userEmail, conversationHistory);

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
      log.error("Error in userMessage:", error as Error);
      await say({
        text: "Sorry, I encountered an error processing your request."
      });
    }
  }
});

// Register the assistant with the app
app.assistant(assistant);

// Handle @mentions in channels (separate from Assistant tab)
app.event("app_mention", async ({ event, say, client, context }) => {
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
      if (!('user' in event) || !event.user) throw Error("Message does not contain user property")
      const userInfo = await client.users.info({ user: event.user });
      userEmail = userInfo.user?.profile?.email;
    } catch (err) {
      log.error("Could not fetch user email:", err as Error);
    }

    // Fetch thread history if this is a threaded conversation
    let conversationHistory: ChatCompletionMessageParam[] = [];
    if (event.thread_ts && context.botUserId) {
      conversationHistory = await getThreadHistory(
        client,
        event.channel,
        event.thread_ts,
        context.botUserId
      );
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
      log.debug("Could not set status (this is normal for top-level messages)");
    }

    // Run the agent with user context and conversation history
    const reply = await runAgent(prompt, "read", userEmail, conversationHistory);

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
    log.error("Error in app_mention:", error as Error);
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
    log.error("Error in /plex command:", error as Error);
  }
});

(async () => {
  // Initialize MCP client connection first
  await initializeMcpClient();

  // Then start the Slack app
  const port = parseInt(process.env.PORT || "3000");
  await app.start(port);
  log.info(`⚡ Plex Slack Bot is running on port ${port}!`);
})();
