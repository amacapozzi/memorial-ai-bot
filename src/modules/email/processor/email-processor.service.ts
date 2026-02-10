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
    } else if (analysis.type === "SECURITY") {
      // Security alerts are always notified even without reminders
      await this.notifyUser(chatId, analysis);
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
          if (analysis.meetingInfo.meetingLink) {
            message += `Link: ${analysis.meetingInfo.meetingLink}\n`;
          }
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

      case "SECURITY": {
        const alertTypeLabels: Record<string, string> = {
          login_suspicious: "Inicio de sesion sospechoso",
          password_change: "Cambio de contraseña",
          phishing: "Posible phishing",
          data_breach: "Brecha de datos",
          unrecognized_transaction: "Transaccion no reconocida",
          new_device: "Nuevo dispositivo",
          unauthorized_access: "Acceso no autorizado",
          unknown_subscription: "Suscripcion desconocida"
        };
        message = `🚨 *ALERTA DE SEGURIDAD*\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.securityInfo) {
          message += `🔐 Servicio: ${analysis.securityInfo.service}\n`;
          const alertLabel =
            alertTypeLabels[analysis.securityInfo.alertType] || analysis.securityInfo.alertType;
          message += `⚠️ Tipo: ${alertLabel}\n`;
          if (analysis.securityInfo.ipOrLocation) {
            message += `📍 Ubicacion/IP: ${analysis.securityInfo.ipOrLocation}\n`;
          }
          message += `\n*Accion recomendada:* ${analysis.securityInfo.actionRequired}\n`;
        }
        message += `\n_Si no fuiste vos, actua de inmediato._`;
        break;
      }

      case "LEGAL_HEARING":
        message = `⚖️ AUDIENCIA JUDICIAL detectada!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.legalHearingInfo) {
          const date = analysis.legalHearingInfo.dateTime.toLocaleString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit"
          });
          message += `📍 ${analysis.legalHearingInfo.court}\n`;
          message += `📅 ${date}\n`;
          if (analysis.legalHearingInfo.caseNumber) {
            message += `📁 Exp: ${analysis.legalHearingInfo.caseNumber}\n`;
          }
          if (analysis.legalHearingInfo.caseName) {
            message += `📋 ${analysis.legalHearingInfo.caseName}\n`;
          }
          if (analysis.legalHearingInfo.hearingType) {
            message += `Tipo: ${analysis.legalHearingInfo.hearingType}\n`;
          }
          if (analysis.legalHearingInfo.location) {
            message += `Direccion: ${analysis.legalHearingInfo.location}\n`;
          }
        }
        message += `\nTe aviso 24 horas antes!`;
        break;

      case "DEADLINE":
        message = `⏰ VENCIMIENTO detectado!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.deadlineInfo) {
          const date = analysis.deadlineInfo.dueDate.toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long"
          });
          message += `📅 Vence: ${date}\n`;
          message += `📝 Accion: ${analysis.deadlineInfo.action}\n`;
          if (analysis.deadlineInfo.caseNumber) {
            message += `📁 Exp: ${analysis.deadlineInfo.caseNumber}\n`;
          }
          message += `Tipo: ${analysis.deadlineInfo.deadlineType}\n`;
        }
        message += `\nTe aviso 48 horas antes para que tengas tiempo de actuar!`;
        break;

      case "COURSE":
        message = `📚 Encontre un curso/capacitacion!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.courseInfo) {
          const date = analysis.courseInfo.dateTime.toLocaleString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit"
          });
          message += `📅 Inicio: ${date}\n`;
          message += `🏛️ Organiza: ${analysis.courseInfo.organizer}\n`;
          if (analysis.courseInfo.instructor) {
            message += `👨‍🏫 Instructor: ${analysis.courseInfo.instructor}\n`;
          }
          if (analysis.courseInfo.meetingLink) {
            message += `🔗 Link: ${analysis.courseInfo.meetingLink}\n`;
          }
          if (analysis.courseInfo.location) {
            message += `📍 Lugar: ${analysis.courseInfo.location}\n`;
          }
        }
        message += `\nTe aviso 1 hora antes!`;
        break;

      case "TASK":
        message = `✅ Nueva tarea detectada!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.taskInfo) {
          message += `📝 ${analysis.taskInfo.title}\n`;
          if (analysis.taskInfo.dueDate) {
            const date = analysis.taskInfo.dueDate.toLocaleDateString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long"
            });
            message += `📅 Para: ${date}\n`;
          }
          if (analysis.taskInfo.relatedCase) {
            message += `📁 Caso: ${analysis.taskInfo.relatedCase}\n`;
          }
          if (analysis.taskInfo.assignedBy) {
            message += `👤 Asignado por: ${analysis.taskInfo.assignedBy}\n`;
          }
          if (analysis.taskInfo.priority) {
            message += `🔴 Prioridad: ${analysis.taskInfo.priority}\n`;
          }
        }
        message += `\nTe recuerdo mañana para que no se te pase!`;
        break;

      case "LEGAL_INFO":
        message = `📜 Informacion juridica relevante!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.legalInfoData) {
          message += `📑 ${analysis.legalInfoData.title}\n`;
          message += `🏛️ Fuente: ${analysis.legalInfoData.source}\n`;
          if (analysis.legalInfoData.summary) {
            message += `📝 ${analysis.legalInfoData.summary}\n`;
          }
          if (analysis.legalInfoData.relevance) {
            message += `⭐ ${analysis.legalInfoData.relevance}\n`;
          }
          if (analysis.legalInfoData.link) {
            message += `🔗 ${analysis.legalInfoData.link}\n`;
          }
        }
        message += `\nTe recuerdo mañana para que lo revises!`;
        break;

      case "EVENT":
        message = `🎯 Encontre un evento!\n\n`;
        message += `${analysis.summary}\n`;
        if (analysis.eventInfo) {
          const date = analysis.eventInfo.dateTime.toLocaleString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit"
          });
          message += `📅 Cuando: ${date}\n`;
          if (analysis.eventInfo.organizer) {
            message += `🏛️ Organiza: ${analysis.eventInfo.organizer}\n`;
          }
          if (analysis.eventInfo.location) {
            message += `📍 Lugar: ${analysis.eventInfo.location}\n`;
          }
          if (analysis.eventInfo.meetingLink) {
            message += `🔗 Link: ${analysis.eventInfo.meetingLink}\n`;
          }
        }
        message += `\nTe aviso 30 minutos antes!`;
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

    if (analysis.legalHearingInfo) {
      data.legalHearingInfo = {
        ...analysis.legalHearingInfo,
        dateTime: analysis.legalHearingInfo.dateTime.toISOString()
      };
    }

    if (analysis.securityInfo) {
      data.securityInfo = analysis.securityInfo;
    }

    if (analysis.deadlineInfo) {
      data.deadlineInfo = {
        ...analysis.deadlineInfo,
        dueDate: analysis.deadlineInfo.dueDate.toISOString()
      };
    }

    if (analysis.courseInfo) {
      data.courseInfo = {
        ...analysis.courseInfo,
        dateTime: analysis.courseInfo.dateTime.toISOString(),
        endDateTime: analysis.courseInfo.endDateTime?.toISOString()
      };
    }

    if (analysis.taskInfo) {
      data.taskInfo = {
        ...analysis.taskInfo,
        dueDate: analysis.taskInfo.dueDate?.toISOString()
      };
    }

    if (analysis.legalInfoData) {
      data.legalInfoData = {
        ...analysis.legalInfoData,
        date: analysis.legalInfoData.date?.toISOString()
      };
    }

    if (analysis.eventInfo) {
      data.eventInfo = {
        ...analysis.eventInfo,
        dateTime: analysis.eventInfo.dateTime.toISOString(),
        endDateTime: analysis.eventInfo.endDateTime?.toISOString()
      };
    }

    return data;
  }
}
