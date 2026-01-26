import type { IntentService } from "@modules/ai/intent/intent.service";
import type { TranscriptionService } from "@modules/ai/transcription/transcription.service";
import type { ReminderService } from "@modules/reminders/reminder.service";
import { createLogger } from "@shared/logger/logger";

import type { WhatsAppClient } from "../client/whatsapp.client";
import type { MessageContent } from "../client/whatsapp.types";

export class MessageHandler {
  private readonly logger = createLogger("message-handler");

  constructor(
    private readonly whatsappClient: WhatsAppClient,
    private readonly transcriptionService: TranscriptionService,
    private readonly intentService: IntentService,
    private readonly reminderService: ReminderService
  ) {}

  async handle(message: MessageContent): Promise<void> {
    // Skip messages from self (unless testing)
    if (message.fromMe) {
      this.logger.debug("Skipping message from self");
      return;
    }

    // Skip unknown message types
    if (message.type === "unknown") {
      return;
    }

    this.logger.info(`Received ${message.type} message from ${message.chatId}`);

    let text: string;

    // Process audio messages
    if (message.type === "audio" && message.audioBuffer) {
      this.logger.info("Transcribing audio...");
      try {
        text = await this.transcriptionService.transcribe(
          message.audioBuffer,
          message.mimeType || "audio/ogg"
        );
        this.logger.info(`Transcription: "${text}"`);
      } catch (error) {
        this.logger.error("Failed to transcribe audio", error);
        await this.whatsappClient.sendMessage(
          message.chatId,
          "No pude entender el audio. Por favor intenta de nuevo."
        );
        return;
      }
    } else if (message.type === "text" && message.text) {
      text = message.text;
    } else {
      return;
    }

    // Parse intent
    try {
      const intent = await this.intentService.parseIntent(text);
      this.logger.info(`Parsed intent: ${intent.type} (confidence: ${intent.confidence})`);

      if (intent.type === "reminder" && intent.reminderDetails) {
        // Create reminder
        const funMessage = await this.intentService.generateFunReminderMessage(
          intent.reminderDetails.description
        );

        const reminder = await this.reminderService.createReminder({
          originalText: text,
          reminderText: funMessage,
          scheduledAt: intent.reminderDetails.dateTime,
          chatId: message.chatId
        });

        // Send confirmation
        const confirmationTime = intent.reminderDetails.dateTime.toLocaleString("es-AR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit"
        });

        await this.whatsappClient.sendMessage(
          message.chatId,
          `Listo! Te recordare: "${intent.reminderDetails.description}" el ${confirmationTime}`
        );

        this.logger.info(`Reminder created: ${reminder.id}`);
      } else if (intent.type === "query") {
        // Handle queries (future feature)
        await this.whatsappClient.sendMessage(
          message.chatId,
          "Por ahora solo puedo ayudarte con recordatorios. Dime algo como 'recuerdame manana a las 3 llamar a mama'"
        );
      } else {
        // Unknown intent
        await this.whatsappClient.sendMessage(
          message.chatId,
          "No entendi bien. Puedo ayudarte con recordatorios. Por ejemplo: 'recuerdame el viernes a las 5 que tengo reunion'"
        );
      }
    } catch (error) {
      this.logger.error("Failed to process message", error);
      await this.whatsappClient.sendMessage(
        message.chatId,
        "Hubo un error procesando tu mensaje. Intenta de nuevo mas tarde."
      );
    }
  }
}
