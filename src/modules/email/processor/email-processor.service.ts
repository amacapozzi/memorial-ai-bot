import type { ReminderService } from "@modules/reminders/reminder.service";
import type { WhatsAppClient } from "@modules/whatsapp/client/whatsapp.client";
import type { ProcessedEmail, EmailType } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { ProcessedEmailRepository } from "./processed-email.repository";
import type { EmailAnalyzerService, AnalyzedEmail } from "../analyzer/email-analyzer.service";
import type { GmailService, EmailMessage } from "../gmail/gmail.service";
import type { UserService } from "../user/user.service";

export class EmailProcessorService {
  private readonly logger = createLogger("email-processor");

  constructor(
    private readonly gmailService: GmailService,
    private readonly emailAnalyzerService: EmailAnalyzerService,
    private readonly processedEmailRepository: ProcessedEmailRepository,
    private readonly reminderService: ReminderService,
    private readonly whatsappClient: WhatsAppClient,
    private readonly userService: UserService
  ) {}

  async processEmail(
    userId: string,
    chatId: string,
    email: EmailMessage
  ): Promise<ProcessedEmail | null> {
    this.logger.info(`Processing email ${email.id} for user ${userId}`);

    // Check if already processed
    const exists = await this.processedEmailRepository.existsByGmailId(userId, email.id);
    if (exists) {
      this.logger.debug(`Email ${email.id} already processed, skipping`);
      return null;
    }

    // Analyze the email with AI
    const analysis = await this.emailAnalyzerService.analyzeEmail(email);

    this.logger.info(`Email classified as ${analysis.type} with confidence ${analysis.confidence}`);

    // Skip if it's OTHER type or low confidence
    if (analysis.type === "OTHER" || analysis.confidence < 0.7) {
      this.logger.debug(`Email ${email.id} is type OTHER or low confidence, skipping reminder`);

      return this.processedEmailRepository.create({
        userId,
        gmailMessageId: email.id,
        threadId: email.threadId,
        subject: email.subject,
        sender: email.from,
        receivedAt: email.date,
        emailType: analysis.type as EmailType,
        extractedData: this.buildExtractedData(analysis),
        status: "SKIPPED"
      });
    }

    // Create reminder if suggested
    let reminderId: string | undefined;

    if (analysis.shouldCreateReminder && analysis.suggestedReminderDateTime) {
      try {
        const reminder = await this.reminderService.createReminder({
          originalText: `[Email] ${email.subject}`,
          reminderText: analysis.suggestedReminderText || analysis.summary,
          scheduledAt: analysis.suggestedReminderDateTime,
          chatId
        });

        reminderId = reminder.id;
        this.logger.info(`Created reminder ${reminderId} from email ${email.id}`);

        // Notify user about the new reminder
        await this.notifyUser(chatId, analysis);
      } catch (error) {
        this.logger.error(`Failed to create reminder for email ${email.id}: ${error}`);
      }
    }

    // Save processed email
    const processedEmail = await this.processedEmailRepository.create({
      userId,
      gmailMessageId: email.id,
      threadId: email.threadId,
      subject: email.subject,
      sender: email.from,
      receivedAt: email.date,
      emailType: analysis.type as EmailType,
      extractedData: this.buildExtractedData(analysis),
      reminderId,
      status: reminderId ? "REMINDER_CREATED" : "PROCESSED"
    });

    return processedEmail;
  }

  async processNewEmailsForUser(userId: string, chatId: string): Promise<ProcessedEmail[]> {
    this.logger.info(`Processing new emails for user ${userId}`);

    try {
      const emails = await this.gmailService.getNewMessages(userId, 10);

      this.logger.info(`Found ${emails.length} new emails for user ${userId}`);

      const processed: ProcessedEmail[] = [];

      for (const email of emails) {
        try {
          const result = await this.processEmail(userId, chatId, email);
          if (result) {
            processed.push(result);
          }
        } catch (error) {
          this.logger.error(`Failed to process email ${email.id}: ${error}`);
        }
      }

      return processed;
    } catch (error) {
      this.logger.error(`Failed to fetch emails for user ${userId}: ${error}`);
      return [];
    }
  }

  private async notifyUser(chatId: string, analysis: AnalyzedEmail): Promise<void> {
    let message = "";

    switch (analysis.type) {
      case "DELIVERY":
        message = `📦 Encontre un email sobre una entrega!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.deliveryInfo?.estimatedDelivery) {
          const date = analysis.deliveryInfo.estimatedDelivery.toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long"
          });
          message += `Llega: ${date}\n`;
        }
        message += `\nTe voy a avisar cuando sea el momento!`;
        break;

      case "APPOINTMENT":
        message = `📅 Encontre un turno/cita en tu email!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.appointmentInfo) {
          const date = analysis.appointmentInfo.dateTime.toLocaleString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit"
          });
          message += `Cuando: ${date}\n`;
          if (analysis.appointmentInfo.location) {
            message += `Donde: ${analysis.appointmentInfo.location}\n`;
          }
        }
        message += `\nTe aviso antes para que no te olvides!`;
        break;

      case "MEETING":
        message = `🗓️ Encontre una reunion en tu email!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.meetingInfo) {
          const date = analysis.meetingInfo.dateTime.toLocaleString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit"
          });
          message += `Cuando: ${date}\n`;
          message += `Organiza: ${analysis.meetingInfo.organizer}\n`;
        }
        message += `\nTe aviso unos minutos antes!`;
        break;

      case "FLIGHT":
        message = `✈️ Encontre un vuelo en tu email!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.flightInfo) {
          const date = analysis.flightInfo.departure.dateTime.toLocaleString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit"
          });
          message += `Vuelo: ${analysis.flightInfo.airline} ${analysis.flightInfo.flightNumber}\n`;
          message += `Sale: ${date} desde ${analysis.flightInfo.departure.airport}\n`;
        }
        message += `\nTe aviso con tiempo para que llegues al aeropuerto!`;
        break;

      default:
        return; // Don't notify for other types
    }

    try {
      await this.whatsappClient.sendMessage(chatId, message);
    } catch (error) {
      this.logger.error(`Failed to notify user ${chatId}: ${error}`);
    }
  }

  private buildExtractedData(analysis: AnalyzedEmail): Record<string, unknown> {
    const data: Record<string, unknown> = {
      summary: analysis.summary,
      confidence: analysis.confidence
    };

    if (analysis.deliveryInfo) {
      data.deliveryInfo = {
        ...analysis.deliveryInfo,
        estimatedDelivery: analysis.deliveryInfo.estimatedDelivery?.toISOString()
      };
    }

    if (analysis.appointmentInfo) {
      data.appointmentInfo = {
        ...analysis.appointmentInfo,
        dateTime: analysis.appointmentInfo.dateTime.toISOString()
      };
    }

    if (analysis.meetingInfo) {
      data.meetingInfo = {
        ...analysis.meetingInfo,
        dateTime: analysis.meetingInfo.dateTime.toISOString()
      };
    }

    if (analysis.purchaseInfo) {
      data.purchaseInfo = analysis.purchaseInfo;
    }

    if (analysis.flightInfo) {
      data.flightInfo = {
        ...analysis.flightInfo,
        departure: {
          ...analysis.flightInfo.departure,
          dateTime: analysis.flightInfo.departure.dateTime.toISOString()
        },
        arrival: {
          ...analysis.flightInfo.arrival,
          dateTime: analysis.flightInfo.arrival.dateTime.toISOString()
        }
      };
    }

    return data;
  }
}
