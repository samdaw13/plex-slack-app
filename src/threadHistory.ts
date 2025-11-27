import { WebClient } from "@slack/web-api";
import { log } from "./logger.js";
import OpenAI from "openai";

interface SlackMessage {
  type: string;
  user?: string;
  text?: string;
  bot_id?: string;
  ts: string;
}

/**
 * Fetch thread history from Slack and convert to OpenAI message format
 */
export async function getThreadHistory(
  client: WebClient,
  channelId: string,
  threadTs: string,
  botUserId: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  try {
    log.debug("Fetching thread history", { channelId, threadTs });

    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 100
    });

    if (!result.messages || result.messages.length === 0) {
      log.debug("No thread history found");
      return [];
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const msg of result.messages as SlackMessage[]) {
      // Skip the current message (we'll add it separately)
      if (msg.ts === threadTs) {
        continue;
      }

      // Determine if message is from bot or user
      const isBot = msg.bot_id || msg.user === botUserId;
      const text = msg.text || "";

      // Remove bot mentions from user messages
      const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();

      if (isBot) {
        messages.push({
          role: "assistant",
          content: cleanText
        });
      } else {
        messages.push({
          role: "user",
          content: cleanText
        });
      }
    }

    log.debug("Thread history loaded", { messageCount: messages.length });
    return messages;
  } catch (error) {
    log.error("Failed to fetch thread history", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
