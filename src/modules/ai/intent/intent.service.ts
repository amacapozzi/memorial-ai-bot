import { createLogger } from "@shared/logger/logger";

import { buildReminderIntentPrompt, FUN_REMINDER_SYSTEM_PROMPT } from "./prompts";
import type { GroqClient } from "../groq/groq.client";

export type RecurrenceType = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface ReminderDetail {
  description: string;
  dateTime: Date | null;
  recurrence: RecurrenceType;
  recurrenceDay: number | null;
  recurrenceTime: string | null;
  funMessage: string | null;
}

export type IntentType =
  | "create_reminder"
  | "list_tasks"
  | "cancel_task"
  | "modify_task"
  | "link_email"
  | "unlink_email"
  | "email_status"
  | "reply_email"
  | "search_email"
  | "search_product"
  | "link_mercadolibre"
  | "unlink_mercadolibre"
  | "track_order"
  | "enable_digest"
  | "disable_digest"
  | "check_expenses"
  | "financial_advice"
  | "check_dollar"
  | "get_news"
  | "check_crypto"
  | "get_directions"
  | "unknown";

export interface ParsedIntent {
  type: IntentType;
  taskNumber?: number;
  reminderDetails?: ReminderDetail[];
  originalText?: string;
  newDateTime?: Date;
  missingDateTime?: boolean;
  emailReplyInstruction?: string;
  emailSearchQuery?: string;
  emailExtractionQuery?: string;
  productSearchQuery?: string;
  digestHour?: number;
  expensePeriod?: "day" | "week" | "month";
  newsQuery?: string;
  newsCategory?: string;
  coins?: string[];
  directionsOrigin?: string;
  directionsDestination?: string;
  travelMode?: string;
  confidence: number;
}

interface IntentResponse {
  intentType: IntentType;
  taskNumber: number | null;
  reminderDetails: Array<{
    description: string;
    dateTime: string | null;
    recurrence: RecurrenceType;
    recurrenceDay: number | null;
    recurrenceTime: string | null;
    funMessage: string | null;
  }> | null;
  newDateTime: string | null;
  missingDateTime: boolean;
  emailReplyInstruction: string | null;
  emailSearchQuery: string | null;
  emailExtractionQuery: string | null;
  productSearchQuery: string | null;
  digestHour: number | null;
  expensePeriod: "day" | "week" | "month" | null;
  newsQuery: string | null;
  newsCategory: string | null;
  coins: string[] | null;
  directionsOrigin: string | null;
  directionsDestination: string | null;
  travelMode: string | null;
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
        confidence: response.confidence,
        missingDateTime: response.missingDateTime || false
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

      // Handle email reply instruction
      if (response.emailReplyInstruction) {
        result.emailReplyInstruction = response.emailReplyInstruction;
      }

      // Handle email search query
      if (response.emailSearchQuery) {
        result.emailSearchQuery = response.emailSearchQuery;
      }

      // Handle email extraction query
      if (response.emailExtractionQuery) {
        result.emailExtractionQuery = response.emailExtractionQuery;
      }

      // Handle product search query
      if (response.productSearchQuery) {
        result.productSearchQuery = response.productSearchQuery;
      }

      // Handle digest hour
      if (response.digestHour !== null && response.digestHour !== undefined) {
        result.digestHour = response.digestHour;
      }

      // Handle expense period
      if (response.expensePeriod) {
        result.expensePeriod = response.expensePeriod;
      }

      // Handle news fields
      if (response.newsQuery) result.newsQuery = response.newsQuery;
      if (response.newsCategory) result.newsCategory = response.newsCategory;

      // Handle crypto coins
      if (response.coins && response.coins.length > 0) result.coins = response.coins;

      // Handle directions fields
      if (response.directionsOrigin) result.directionsOrigin = response.directionsOrigin;
      if (response.directionsDestination)
        result.directionsDestination = response.directionsDestination;
      if (response.travelMode) result.travelMode = response.travelMode;

      // Handle reminder details for create (supports multiple reminders)
      if (
        response.intentType === "create_reminder" &&
        response.reminderDetails &&
        response.reminderDetails.length > 0
      ) {
        result.reminderDetails = response.reminderDetails.map((detail) => {
          let dateTime: Date | null = null;

          // Only parse dateTime if provided and not a recurring reminder without specific date
          if (detail.dateTime) {
            dateTime = new Date(detail.dateTime);

            // Validate the date is in the future (only for non-recurring)
            if (detail.recurrence === "NONE" && dateTime <= new Date()) {
              this.logger.warn(
                `Parsed date for "${detail.description}" is in the past, adjusting to tomorrow`
              );
              dateTime.setDate(dateTime.getDate() + 1);
            }
          }

          return {
            description: detail.description,
            dateTime,
            recurrence: detail.recurrence || "NONE",
            recurrenceDay: detail.recurrenceDay,
            recurrenceTime: detail.recurrenceTime,
            funMessage: detail.funMessage || null
          };
        });
        result.originalText = text;
      }

      return result;
    } catch (error) {
      // Re-throw rate limit errors so the caller can inform the user
      if (
        typeof error === "object" &&
        error !== null &&
        (error as Record<string, unknown>).status === 429
      ) {
        throw error;
      }
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
