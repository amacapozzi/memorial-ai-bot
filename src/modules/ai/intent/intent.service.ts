import { createLogger } from "@shared/logger/logger";

import { buildReminderIntentPrompt, FUN_REMINDER_SYSTEM_PROMPT } from "./prompts";
import type { GroqClient } from "../groq/groq.client";

export interface ParsedIntent {
  type: "reminder" | "query" | "unknown";
  reminderDetails?: {
    description: string;
    dateTime: Date;
    originalText: string;
  };
  confidence: number;
}

interface ReminderIntentResponse {
  isReminder: boolean;
  description: string;
  dateTime: string;
  confidence: number;
}

export class IntentService {
  private readonly logger = createLogger("intent");

  constructor(private readonly groqClient: GroqClient) {}

  async parseIntent(text: string): Promise<ParsedIntent> {
    this.logger.info(`Parsing intent for: "${text.substring(0, 50)}..."`);

    const systemPrompt = buildReminderIntentPrompt();

    try {
      const response = await this.groqClient.chatJSON<ReminderIntentResponse>(systemPrompt, text);

      if (response.isReminder && response.description && response.dateTime) {
        const dateTime = new Date(response.dateTime);

        // Validate the date is in the future
        if (dateTime <= new Date()) {
          this.logger.warn("Parsed date is in the past, adjusting to tomorrow");
          dateTime.setDate(dateTime.getDate() + 1);
        }

        return {
          type: "reminder",
          reminderDetails: {
            description: response.description,
            dateTime,
            originalText: text
          },
          confidence: response.confidence
        };
      }

      return {
        type: response.isReminder ? "unknown" : "query",
        confidence: response.confidence
      };
    } catch (error) {
      this.logger.error("Failed to parse intent", error);
      return {
        type: "unknown",
        confidence: 0
      };
    }
  }

  async generateFunReminderMessage(description: string): Promise<string> {
    this.logger.debug(`Generating fun reminder for: "${description}"`);

    const message = await this.groqClient.chat(
      FUN_REMINDER_SYSTEM_PROMPT,
      `Genera un mensaje de recordatorio para: ${description}`
    );

    return message;
  }
}
