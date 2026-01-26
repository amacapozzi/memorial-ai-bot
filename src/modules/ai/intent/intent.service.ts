import { createLogger } from "@shared/logger/logger";

import { buildReminderIntentPrompt, FUN_REMINDER_SYSTEM_PROMPT } from "./prompts";
import type { GroqClient } from "../groq/groq.client";

export interface ParsedIntent {
  type: "create_reminder" | "list_tasks" | "cancel_task" | "modify_task" | "unknown";
  taskNumber?: number;
  reminderDetails?: {
    description: string;
    dateTime: Date;
    originalText: string;
  };
  newDateTime?: Date;
  confidence: number;
}

interface IntentResponse {
  intentType: "create_reminder" | "list_tasks" | "cancel_task" | "modify_task" | "unknown";
  taskNumber: number | null;
  reminderDetails: {
    description: string;
    dateTime: string;
  } | null;
  newDateTime: string | null;
  confidence: number;
}

export class IntentService {
  private readonly logger = createLogger("intent");

  constructor(private readonly groqClient: GroqClient) {}

  async parseIntent(text: string): Promise<ParsedIntent> {
    this.logger.info(`Parsing intent for: "${text.substring(0, 50)}..."`);

    const systemPrompt = buildReminderIntentPrompt();

    try {
      const response = await this.groqClient.chatJSON<IntentResponse>(systemPrompt, text);

      const result: ParsedIntent = {
        type: response.intentType,
        confidence: response.confidence
      };

      // Handle task number for cancel/modify
      if (response.taskNumber) {
        result.taskNumber = response.taskNumber;
      }

      // Handle new date/time for modify
      if (response.newDateTime) {
        const newDateTime = new Date(response.newDateTime);
        if (newDateTime > new Date()) {
          result.newDateTime = newDateTime;
        } else {
          newDateTime.setDate(newDateTime.getDate() + 1);
          result.newDateTime = newDateTime;
        }
      }

      // Handle reminder details for create
      if (response.intentType === "create_reminder" && response.reminderDetails) {
        const dateTime = new Date(response.reminderDetails.dateTime);

        // Validate the date is in the future
        if (dateTime <= new Date()) {
          this.logger.warn("Parsed date is in the past, adjusting to tomorrow");
          dateTime.setDate(dateTime.getDate() + 1);
        }

        result.reminderDetails = {
          description: response.reminderDetails.description,
          dateTime,
          originalText: text
        };
      }

      return result;
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
