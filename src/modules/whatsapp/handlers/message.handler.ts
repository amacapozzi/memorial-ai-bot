import type { IntentService, ReminderDetail } from "@modules/ai/intent/intent.service";
import type { TranscriptionService } from "@modules/ai/transcription/transcription.service";
import type { GmailAuthService } from "@modules/email/gmail/gmail-auth.service";
import type { GmailService } from "@modules/email/gmail/gmail.service";
import type { ProcessedEmailRepository } from "@modules/email/processor/processed-email.repository";
import type { EmailReplyService } from "@modules/email/reply/email-reply.service";
import type { UserService } from "@modules/email/user/user.service";
import type { LinkingCodeService } from "@modules/linking/linking.service";
import type { ReminderService } from "@modules/reminders/reminder.service";
import type { SubscriptionService } from "@modules/subscription/subscription.service";
import type { RecurrenceType } from "@prisma-module/generated/client";
import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { WhatsAppClient } from "../client/whatsapp.client";
import type { MessageContent } from "../client/whatsapp.types";

const DAYS_OF_WEEK = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const CONNECT_COMMANDS = ["/connect", "/link", "/conectar"];
const CONFIRM_SEND = ["enviar", "si", "send", "yes"];
const CANCEL_SEND = ["cancelar", "cancel", "no"];

function extractRateLimitWait(error: unknown): string | null {
  const msg =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>).message : null;
  if (typeof msg !== "string") return null;
  const match = msg.match(/try again in (\d+h)?(\d+m)?(\d+(?:\.\d+)?s)?/i);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hora${hours > 1 ? "s" : ""}`);
  if (minutes > 0) parts.push(`${minutes} minuto${minutes > 1 ? "s" : ""}`);
  if (parts.length === 0) parts.push("unos segundos");
  return parts.join(" y ");
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as Record<string, unknown>).status === 429;
}

interface PendingReply {
  userId: string;
  messageId: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
}

interface ViewedEmail {
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
}

export class MessageHandler {
  private readonly logger = createLogger("message-handler");
  private readonly pendingReplies = new Map<string, PendingReply>();
  private readonly lastViewedEmail = new Map<string, ViewedEmail>();
  private readonly pendingSearchReply = new Set<string>();
  private readonly pendingReplyInstruction = new Set<string>();

  constructor(
    private readonly whatsappClient: WhatsAppClient,
    private readonly transcriptionService: TranscriptionService,
    private readonly intentService: IntentService,
    private readonly reminderService: ReminderService,
    private readonly userService?: UserService,
    private readonly gmailAuthService?: GmailAuthService,
    private readonly linkingCodeService?: LinkingCodeService,
    private readonly subscriptionService?: SubscriptionService,
    private readonly emailReplyService?: EmailReplyService,
    private readonly gmailService?: GmailService,
    private readonly processedEmailRepository?: ProcessedEmailRepository
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
        if (isRateLimitError(error)) {
          const wait = extractRateLimitWait(error) || "unos minutos";
          await this.whatsappClient.sendMessage(
            message.chatId,
            `Estoy saturado en este momento. Intenta de nuevo en ${wait}.`
          );
        } else {
          await this.whatsappClient.sendMessage(
            message.chatId,
            "No pude entender el audio. Por favor intenta de nuevo."
          );
        }
        return;
      }
    } else if (message.type === "text" && message.text) {
      text = message.text;
    } else {
      return;
    }

    // Check for pending email reply confirmation
    if (this.pendingReplies.has(message.chatId)) {
      await this.handlePendingReplyResponse(message.chatId, text);
      return;
    }

    // Check for pending search reply ("queres responder?")
    if (this.pendingSearchReply.has(message.chatId)) {
      await this.handlePendingSearchReplyResponse(message.chatId, text);
      return;
    }

    // Check for pending reply instruction (user said "si", now we need the instruction)
    if (this.pendingReplyInstruction.has(message.chatId)) {
      await this.handleReplyToViewedEmail(message.chatId, text);
      return;
    }

    // Check for /connect command before LLM parsing
    if (CONNECT_COMMANDS.includes(text.trim().toLowerCase())) {
      await this.handleConnect(message.chatId);
      return;
    }

    // Check subscription access (linked account + active plan)
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkBotAccess(message.chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(message.chatId, access.message);
        return;
      }
    }

    // Parse intent
    try {
      const intent = await this.intentService.parseIntent(text);
      this.logger.info(`Parsed intent: ${intent.type} (confidence: ${intent.confidence})`);

      switch (intent.type) {
        case "create_reminder":
          await this.handleCreateReminder(message.chatId, text, intent);
          break;

        case "list_tasks":
          await this.handleListTasks(message.chatId);
          break;

        case "cancel_task":
          await this.handleCancelTask(message.chatId, intent.taskNumber);
          break;

        case "modify_task":
          await this.handleModifyTask(message.chatId, intent.taskNumber, intent.newDateTime);
          break;

        case "link_email":
          await this.handleLinkEmail(message.chatId);
          break;

        case "unlink_email":
          await this.handleUnlinkEmail(message.chatId);
          break;

        case "email_status":
          await this.handleEmailStatus(message.chatId);
          break;

        case "reply_email":
          await this.handleReplyEmail(message.chatId, intent.emailReplyInstruction);
          break;

        case "search_email":
          await this.handleSearchEmail(message.chatId, intent.emailSearchQuery);
          break;

        default:
          await this.whatsappClient.sendMessage(
            message.chatId,
            "No entendi bien. Puedo ayudarte con:\n" +
              "- Crear recordatorios: 'recuerdame manana a las 3 llamar a mama'\n" +
              "- Recordatorios recurrentes: 'recuerdame todos los dias a las 8 tomar la pastilla'\n" +
              "- Ver tareas: 'que tareas tengo'\n" +
              "- Cancelar: 'cancela la tarea 2'\n" +
              "- Cambiar hora: 'cambia la tarea 1 a las 5pm'\n" +
              "- Conectar email: 'conecta mi email'\n" +
              "- Responder email: 'respondele al mail diciendo que acepto'\n" +
              "- Buscar email: 'busca el mail de Juan sobre el presupuesto'\n" +
              "- Vincular con la web: /connect"
          );
      }
    } catch (error) {
      this.logger.error("Failed to process message", error);
      if (isRateLimitError(error)) {
        const wait = extractRateLimitWait(error) || "unos minutos";
        await this.whatsappClient.sendMessage(
          message.chatId,
          `Estoy saturado en este momento. Intenta de nuevo en ${wait}.`
        );
      } else {
        await this.whatsappClient.sendMessage(
          message.chatId,
          "Hubo un error procesando tu mensaje. Intenta de nuevo mas tarde."
        );
      }
    }
  }

  private async handleCreateReminder(
    chatId: string,
    originalText: string,
    intent: {
      reminderDetails?: ReminderDetail[];
      missingDateTime?: boolean;
    }
  ): Promise<void> {
    // Check reminder limit
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkCanCreateReminder(chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(chatId, access.message);
        return;
      }
    }

    // Check if missing date/time
    if (intent.missingDateTime) {
      const description = intent.reminderDetails?.[0]?.description || "lo que me pediste";
      await this.whatsappClient.sendMessage(
        chatId,
        `Para crear el recordatorio de "${description}", necesito que me digas cuando.\n\n` +
          "Por ejemplo:\n" +
          "- 'manana a las 3'\n" +
          "- 'el viernes a las 10'\n" +
          "- 'todos los dias a las 8'\n" +
          "- 'todos los lunes a las 9'\n\n" +
          "Decime cuando queres que te recuerde!"
      );
      return;
    }

    if (!intent.reminderDetails || intent.reminderDetails.length === 0) {
      await this.whatsappClient.sendMessage(
        chatId,
        "No pude entender los detalles del recordatorio. Decime que queres que te recuerde y cuando."
      );
      return;
    }

    const createdReminders: Array<{
      description: string;
      dateTime: Date | null;
      recurrence: string;
      recurrenceDay: number | null;
    }> = [];

    for (const detail of intent.reminderDetails) {
      const funMessage = detail.funMessage ?? detail.description;

      // Calculate scheduledAt based on recurrence or specific date
      let scheduledAt: Date;

      if (detail.recurrence !== "NONE" && detail.recurrenceTime) {
        // For recurring reminders, calculate the first occurrence
        scheduledAt = this.calculateFirstOccurrence(
          detail.recurrence as RecurrenceType,
          detail.recurrenceDay,
          detail.recurrenceTime
        );
      } else if (detail.dateTime) {
        scheduledAt = detail.dateTime;
      } else {
        // Shouldn't happen, but fallback to tomorrow 9am
        scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + 1);
        scheduledAt.setHours(9, 0, 0, 0);
      }

      const reminder = await this.reminderService.createReminder({
        originalText,
        reminderText: funMessage,
        scheduledAt,
        chatId,
        recurrence: (detail.recurrence as RecurrenceType) || "NONE",
        recurrenceDay: detail.recurrenceDay ?? undefined,
        recurrenceTime: detail.recurrenceTime ?? undefined
      });

      createdReminders.push({
        description: detail.description,
        dateTime: scheduledAt,
        recurrence: detail.recurrence,
        recurrenceDay: detail.recurrenceDay
      });

      this.logger.info(`Reminder created: ${reminder.id}`);
    }

    // Build confirmation message
    if (createdReminders.length === 1) {
      const r = createdReminders[0];
      await this.whatsappClient.sendMessage(chatId, this.buildConfirmationMessage(r));
    } else {
      let message = `Listo! Te cree ${createdReminders.length} recordatorios:\n\n`;
      createdReminders.forEach((r, index) => {
        message += `${index + 1}. ${this.buildConfirmationMessageShort(r)}\n`;
      });
      await this.whatsappClient.sendMessage(chatId, message);
    }
  }

  private calculateFirstOccurrence(
    recurrence: RecurrenceType,
    recurrenceDay: number | null,
    recurrenceTime: string
  ): Date {
    const now = new Date();
    const [hours, minutes] = recurrenceTime.split(":").map(Number);
    let nextDate = new Date(now);
    nextDate.setHours(hours, minutes, 0, 0);

    switch (recurrence) {
      case "DAILY":
        if (nextDate <= now) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        break;

      case "WEEKLY":
        const targetDay = recurrenceDay ?? 0;
        const currentDay = nextDate.getDay();
        let daysUntilTarget = targetDay - currentDay;
        if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextDate <= now)) {
          daysUntilTarget += 7;
        }
        nextDate.setDate(nextDate.getDate() + daysUntilTarget);
        break;

      case "MONTHLY":
        const targetDayOfMonth = recurrenceDay ?? 1;
        nextDate.setDate(targetDayOfMonth);
        if (nextDate <= now) {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }
        break;
    }

    return nextDate;
  }

  private buildConfirmationMessage(r: {
    description: string;
    dateTime: Date | null;
    recurrence: string;
    recurrenceDay: number | null;
  }): string {
    if (r.recurrence === "DAILY") {
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `Listo! Te voy a recordar "${r.description}" todos los dias a las ${timeStr} 🔁`;
    }

    if (r.recurrence === "WEEKLY" && r.recurrenceDay !== null) {
      const dayName = DAYS_OF_WEEK[r.recurrenceDay];
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `Listo! Te voy a recordar "${r.description}" todos los ${dayName} a las ${timeStr} 🔁`;
    }

    if (r.recurrence === "MONTHLY" && r.recurrenceDay !== null) {
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `Listo! Te voy a recordar "${r.description}" el dia ${r.recurrenceDay} de cada mes a las ${timeStr} 🔁`;
    }

    // Non-recurring
    const confirmationTime = r.dateTime?.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit"
    });
    return `Listo! Te recordare: "${r.description}" el ${confirmationTime}`;
  }

  private buildConfirmationMessageShort(r: {
    description: string;
    dateTime: Date | null;
    recurrence: string;
    recurrenceDay: number | null;
  }): string {
    if (r.recurrence === "DAILY") {
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `"${r.description}" - todos los dias ${timeStr} 🔁`;
    }

    if (r.recurrence === "WEEKLY" && r.recurrenceDay !== null) {
      const dayName = DAYS_OF_WEEK[r.recurrenceDay];
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `"${r.description}" - ${dayName} ${timeStr} 🔁`;
    }

    const timeStr = r.dateTime?.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
    return `"${r.description}" - ${timeStr}`;
  }

  private async handleListTasks(chatId: string): Promise<void> {
    const reminders = await this.reminderService.getPendingRemindersOrdered(chatId);

    if (reminders.length === 0) {
      await this.whatsappClient.sendMessage(chatId, "No tenes tareas pendientes! 🎉");
      return;
    }

    let response = "📋 *Tus tareas pendientes:*\n\n";

    reminders.forEach((reminder, index) => {
      const isRecurring = reminder.recurrence !== "NONE";
      const recurrenceIcon = isRecurring ? " 🔁" : "";

      let dateStr: string;
      if (isRecurring) {
        const timeStr = reminder.recurrenceTime || "09:00";
        if (reminder.recurrence === "DAILY") {
          dateStr = `Todos los dias ${timeStr}`;
        } else if (reminder.recurrence === "WEEKLY" && reminder.recurrenceDay !== null) {
          dateStr = `${DAYS_OF_WEEK[reminder.recurrenceDay]} ${timeStr}`;
        } else {
          dateStr = reminder.scheduledAt.toLocaleString("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
          });
        }
      } else {
        dateStr = reminder.scheduledAt.toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        });
      }

      response += `*${index + 1}.* ${reminder.reminderText}${recurrenceIcon}\n   📅 ${dateStr}\n\n`;
    });

    response += "_Podes decir 'cancela la tarea X' o 'cambia la tarea X a las Y'_";

    await this.whatsappClient.sendMessage(chatId, response);
  }

  private async handleCancelTask(chatId: string, taskNumber?: number): Promise<void> {
    if (!taskNumber) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime el numero de tarea a cancelar. Ej: 'cancela la tarea 2'"
      );
      return;
    }

    const reminders = await this.reminderService.getPendingRemindersOrdered(chatId);

    if (taskNumber < 1 || taskNumber > reminders.length) {
      await this.whatsappClient.sendMessage(
        chatId,
        `No existe la tarea ${taskNumber}. Tenes ${reminders.length} tarea(s) pendiente(s).`
      );
      return;
    }

    const reminder = reminders[taskNumber - 1];
    const wasRecurring = reminder.recurrence !== "NONE";
    await this.reminderService.cancelReminder(reminder.id);

    const cancelMsg = wasRecurring
      ? `Tarea recurrente ${taskNumber} cancelada: "${reminder.reminderText}" ❌\n(Ya no se va a repetir)`
      : `Tarea ${taskNumber} cancelada: "${reminder.reminderText}" ❌`;

    await this.whatsappClient.sendMessage(chatId, cancelMsg);

    this.logger.info(`Reminder ${reminder.id} cancelled by user`);
  }

  private async handleModifyTask(
    chatId: string,
    taskNumber?: number,
    newDateTime?: Date
  ): Promise<void> {
    if (!taskNumber) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime el numero de tarea a modificar. Ej: 'cambia la tarea 2 a las 5pm'"
      );
      return;
    }

    if (!newDateTime) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime la nueva hora. Ej: 'cambia la tarea 2 a las 5 de la tarde'"
      );
      return;
    }

    const reminders = await this.reminderService.getPendingRemindersOrdered(chatId);

    if (taskNumber < 1 || taskNumber > reminders.length) {
      await this.whatsappClient.sendMessage(
        chatId,
        `No existe la tarea ${taskNumber}. Tenes ${reminders.length} tarea(s) pendiente(s).`
      );
      return;
    }

    const reminder = reminders[taskNumber - 1];
    await this.reminderService.modifyReminderTime(reminder.id, newDateTime);

    const newTimeStr = newDateTime.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit"
    });

    await this.whatsappClient.sendMessage(
      chatId,
      `Tarea ${taskNumber} reprogramada para el ${newTimeStr} ✅`
    );

    this.logger.info(`Reminder ${reminder.id} rescheduled to ${newDateTime.toISOString()}`);
  }

  private async handleLinkEmail(chatId: string): Promise<void> {
    if (!this.userService || !this.gmailAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de email no esta disponible en este momento."
      );
      return;
    }

    // Check email access on plan
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkEmailAccess(chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(chatId, access.message);
        return;
      }
    }

    try {
      // Get or create user
      const user = await this.userService.getOrCreateUser(chatId);

      // Check if already linked
      const isLinked = await this.gmailAuthService.isAuthenticated(user.id);
      if (isLinked) {
        await this.whatsappClient.sendMessage(
          chatId,
          "Ya tenes tu email conectado! 📧\n\n" +
            "Te aviso automaticamente de entregas, citas y reuniones.\n\n" +
            "Si queres desconectarlo, decime 'desconecta mi email'."
        );
        return;
      }

      // Check if user's plan includes email reply to decide scopes
      let includeReply = false;
      if (this.subscriptionService) {
        const info = await this.subscriptionService.checkBotAccess(chatId);
        if (info.allowed && info.info.hasEmailReply) {
          includeReply = true;
        }
      }

      // Generate OAuth URL using userId (clean cuid, no special chars)
      const hostUrl = env().HOST_URL;
      const authUrl = includeReply
        ? `${hostUrl}/auth/gmail?userId=${user.id}&includeSend=true`
        : `${hostUrl}/auth/gmail?userId=${user.id}`;

      const replyLine = includeReply ? "📧 Responder emails desde WhatsApp\n" : "";
      const privacyLine = includeReply
        ? "_Tu privacidad es importante: solo accedo a lo necesario para leer y responder._"
        : "_Tu privacidad es importante: solo leo los emails, nunca envio nada._";

      await this.whatsappClient.sendMessage(
        chatId,
        `📧 *Conectar tu Gmail*

Para vincular tu email, hace click en este link:

${authUrl}

Una vez que autorices, voy a poder avisarte de:
📦 Entregas de compras
📅 Turnos y citas
🗓️ Reuniones
✈️ Vuelos
${replyLine}
${privacyLine}`
      );

      this.logger.info(`Email link URL sent to ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to handle link email for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error generando el link. Intenta de nuevo mas tarde."
      );
    }
  }

  private async handleUnlinkEmail(chatId: string): Promise<void> {
    if (!this.userService || !this.gmailAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de email no esta disponible en este momento."
      );
      return;
    }

    // Check email access on plan
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkEmailAccess(chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(chatId, access.message);
        return;
      }
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);

      if (!user) {
        await this.whatsappClient.sendMessage(chatId, "No tenes ningun email conectado.");
        return;
      }

      const isLinked = await this.gmailAuthService.isAuthenticated(user.id);

      if (!isLinked) {
        await this.whatsappClient.sendMessage(chatId, "No tenes ningun email conectado.");
        return;
      }

      await this.gmailAuthService.revokeAccess(user.id);

      await this.whatsappClient.sendMessage(
        chatId,
        "Email desconectado exitosamente. ✅\n\n" +
          "Ya no voy a recibir notificaciones de tu correo.\n" +
          "Si queres volver a conectarlo, decime 'conecta mi email'."
      );

      this.logger.info(`Email unlinked for ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to unlink email for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error desconectando el email. Intenta de nuevo mas tarde."
      );
    }
  }

  private async handleConnect(chatId: string): Promise<void> {
    if (!this.linkingCodeService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de vinculacion no esta disponible en este momento."
      );
      return;
    }

    try {
      const code = await this.linkingCodeService.generateCode(chatId);

      await this.whatsappClient.sendMessage(
        chatId,
        `🔗 *Vincular con la web*\n\n` +
          `Tu codigo de vinculacion es:\n\n` +
          `*${code}*\n\n` +
          `Ingresalo en la pagina de conexiones de tu cuenta.\n\n` +
          `⏳ Este codigo expira en 5 minutos.`
      );

      this.logger.info(`Linking code sent to ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to generate linking code for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error generando el codigo. Intenta de nuevo mas tarde."
      );
    }
  }

  private async handleReplyEmail(chatId: string, instruction?: string): Promise<void> {
    if (
      !this.emailReplyService ||
      !this.gmailService ||
      !this.processedEmailRepository ||
      !this.userService ||
      !this.gmailAuthService
    ) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de respuesta de email no esta disponible en este momento."
      );
      return;
    }

    // Check email reply access on plan
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkEmailReplyAccess(chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(chatId, access.message);
        return;
      }
    }

    if (!instruction) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime que queres responder. Ej: 'respondele al mail diciendo que acepto la reunion'"
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);
      if (!user) {
        await this.whatsappClient.sendMessage(chatId, "No tenes cuenta vinculada.");
        return;
      }

      // Check if user has send scope
      const hasSend = await this.gmailAuthService.hasSendScope(user.id);
      if (!hasSend) {
        const hostUrl = env().HOST_URL;
        const authUrl = `${hostUrl}/auth/gmail?userId=${user.id}&includeSend=true`;
        await this.whatsappClient.sendMessage(
          chatId,
          "Para responder emails, necesitas re-autorizar tu Gmail con permisos de envio.\n\n" +
            `Hace click aca: ${authUrl}\n\n` +
            "Una vez autorizado, volveme a pedir que responda el email."
        );
        return;
      }

      // Check if there's a viewed email from search first
      const viewed = this.lastViewedEmail.get(chatId);
      let gmailMessageId: string;
      let threadId: string;

      if (viewed) {
        gmailMessageId = viewed.gmailMessageId;
        threadId = viewed.threadId;
        this.lastViewedEmail.delete(chatId);
      } else {
        // Get most recent processed email
        const recentEmails = await this.processedEmailRepository.findRecentForChat(user.id, 1);
        if (recentEmails.length === 0) {
          await this.whatsappClient.sendMessage(
            chatId,
            "No tengo un email reciente al que responder."
          );
          return;
        }
        gmailMessageId = recentEmails[0].gmailMessageId;
        threadId = recentEmails[0].threadId || "";
      }

      // Fetch full email from Gmail
      const fullEmail = await this.gmailService.getMessage(user.id, gmailMessageId);

      // Compose reply using AI
      const reply = await this.emailReplyService.composeReply({
        originalEmail: {
          subject: fullEmail.subject,
          from: fullEmail.from,
          body: fullEmail.body,
          date: fullEmail.date
        },
        userInstruction: instruction,
        locale: user.locale || "es"
      });

      // Show preview
      await this.whatsappClient.sendMessage(
        chatId,
        `*Preview de tu respuesta:*\n\n` +
          `*Para:* ${fullEmail.from}\n` +
          `*Asunto:* ${reply.subject}\n\n` +
          `${reply.body}\n\n` +
          `_Responde "enviar" para enviar o "cancelar" para descartar._`
      );

      // Store pending reply
      this.pendingReplies.set(chatId, {
        userId: user.id,
        messageId: gmailMessageId,
        threadId,
        to: fullEmail.from,
        subject: reply.subject,
        body: reply.body
      });

      this.logger.info(`Pending reply set for ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to handle reply email for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error preparando la respuesta. Intenta de nuevo mas tarde."
      );
    }
  }

  private async handlePendingReplyResponse(chatId: string, text: string): Promise<void> {
    const pending = this.pendingReplies.get(chatId);
    if (!pending) return;

    const normalized = text.trim().toLowerCase();

    if (CONFIRM_SEND.includes(normalized)) {
      // Send the email
      try {
        if (!this.gmailService) {
          await this.whatsappClient.sendMessage(chatId, "Error: servicio de Gmail no disponible.");
          this.pendingReplies.delete(chatId);
          return;
        }

        await this.gmailService.sendReply(pending.userId, pending.messageId, pending.threadId, {
          to: pending.to,
          subject: pending.subject,
          body: pending.body
        });

        await this.whatsappClient.sendMessage(chatId, "Email enviado exitosamente!");
        this.logger.info(`Email reply sent for ${chatId}`);
      } catch (error) {
        this.logger.error(`Failed to send email reply for ${chatId}`, error);
        await this.whatsappClient.sendMessage(
          chatId,
          "Hubo un error enviando el email. Intenta de nuevo mas tarde."
        );
      }
      this.pendingReplies.delete(chatId);
    } else if (CANCEL_SEND.includes(normalized)) {
      await this.whatsappClient.sendMessage(chatId, "Respuesta descartada.");
      this.pendingReplies.delete(chatId);
    } else {
      // Treat as new instruction — re-compose
      this.pendingReplies.delete(chatId);
      await this.handleReplyEmail(chatId, text);
    }
  }

  private async handleSearchEmail(chatId: string, searchQuery?: string): Promise<void> {
    if (
      !this.gmailService ||
      !this.processedEmailRepository ||
      !this.userService ||
      !this.gmailAuthService
    ) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de email no esta disponible en este momento."
      );
      return;
    }

    // Check email access on plan
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkEmailAccess(chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(chatId, access.message);
        return;
      }
    }

    if (!searchQuery) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime que email buscas. Ej: 'busca el mail de Juan sobre el presupuesto'"
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);
      if (!user) {
        await this.whatsappClient.sendMessage(chatId, "No tenes cuenta vinculada.");
        return;
      }

      const isLinked = await this.gmailAuthService.isAuthenticated(user.id);
      if (!isLinked) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenes email conectado. Decime 'conecta mi email' para vincularlo."
        );
        return;
      }

      await this.whatsappClient.sendMessage(chatId, "Buscando en tus emails... 🔍");

      // Stage 1: Local search
      let foundEmail: {
        gmailMessageId: string;
        threadId: string;
        from: string;
        subject: string;
        content: string;
        date: Date;
      } | null = null;

      const localResults = await this.processedEmailRepository.searchByKeywords(
        user.id,
        searchQuery
      );

      if (localResults.length > 0) {
        const best = localResults[0];
        const summary =
          best.extractedData && typeof best.extractedData === "object"
            ? (best.extractedData as Record<string, unknown>).summary
            : null;
        foundEmail = {
          gmailMessageId: best.gmailMessageId,
          threadId: best.threadId || "",
          from: best.sender || "Desconocido",
          subject: best.subject || "(sin asunto)",
          content: typeof summary === "string" ? summary : "",
          date: best.receivedAt
        };
      }

      // Stage 2: Gmail API search if nothing local
      if (!foundEmail) {
        const gmailResults = await this.gmailService.searchMessages(user.id, searchQuery, 1);
        if (gmailResults.length > 0) {
          const msg = gmailResults[0];
          const content = msg.snippet || msg.body.substring(0, 500);
          foundEmail = {
            gmailMessageId: msg.id,
            threadId: msg.threadId,
            from: msg.from,
            subject: msg.subject,
            content,
            date: msg.date
          };
        }
      }

      if (!foundEmail) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No encontre ningun email que coincida con tu busqueda. Intenta con otros terminos."
        );
        return;
      }

      // Format result
      const dateStr = foundEmail.date.toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });

      const contentPreview =
        foundEmail.content.length > 500
          ? foundEmail.content.substring(0, 500) + "..."
          : foundEmail.content;

      let message = `📧 *Email encontrado:*\n\n`;
      message += `*De:* ${foundEmail.from}\n`;
      message += `*Asunto:* ${foundEmail.subject}\n`;
      message += `*Fecha:* ${dateStr}\n`;
      if (contentPreview) {
        message += `\n${contentPreview}\n`;
      }
      message += `\n_Queres responder a este email? Decime "si" o "no"_`;

      await this.whatsappClient.sendMessage(chatId, message);

      // Save state
      this.lastViewedEmail.set(chatId, {
        gmailMessageId: foundEmail.gmailMessageId,
        threadId: foundEmail.threadId,
        from: foundEmail.from,
        subject: foundEmail.subject
      });
      this.pendingSearchReply.add(chatId);

      this.logger.info(`Email search result shown for ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to search emails for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error buscando emails. Intenta de nuevo mas tarde."
      );
    }
  }

  private async handlePendingSearchReplyResponse(chatId: string, text: string): Promise<void> {
    this.pendingSearchReply.delete(chatId);
    const normalized = text.trim().toLowerCase();

    if (["si", "sí", "yes"].includes(normalized)) {
      this.pendingReplyInstruction.add(chatId);
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime que queres responder. Ej: 'decile que acepto la propuesta'"
      );
    } else {
      this.lastViewedEmail.delete(chatId);
      await this.whatsappClient.sendMessage(chatId, "OK!");
    }
  }

  private async handleReplyToViewedEmail(chatId: string, instruction: string): Promise<void> {
    this.pendingReplyInstruction.delete(chatId);

    if (
      !this.emailReplyService ||
      !this.gmailService ||
      !this.userService ||
      !this.gmailAuthService
    ) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de respuesta de email no esta disponible en este momento."
      );
      this.lastViewedEmail.delete(chatId);
      return;
    }

    const viewed = this.lastViewedEmail.get(chatId);
    if (!viewed) {
      await this.whatsappClient.sendMessage(chatId, "No tengo un email guardado para responder.");
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);
      if (!user) {
        await this.whatsappClient.sendMessage(chatId, "No tenes cuenta vinculada.");
        this.lastViewedEmail.delete(chatId);
        return;
      }

      // Check send scope
      const hasSend = await this.gmailAuthService.hasSendScope(user.id);
      if (!hasSend) {
        const hostUrl = env().HOST_URL;
        const authUrl = `${hostUrl}/auth/gmail?userId=${user.id}&includeSend=true`;
        await this.whatsappClient.sendMessage(
          chatId,
          "Para responder emails, necesitas re-autorizar tu Gmail con permisos de envio.\n\n" +
            `Hace click aca: ${authUrl}\n\n` +
            "Una vez autorizado, volveme a pedir que responda el email."
        );
        this.lastViewedEmail.delete(chatId);
        return;
      }

      // Fetch full email
      const fullEmail = await this.gmailService.getMessage(user.id, viewed.gmailMessageId);

      // Compose reply
      const reply = await this.emailReplyService.composeReply({
        originalEmail: {
          subject: fullEmail.subject,
          from: fullEmail.from,
          body: fullEmail.body,
          date: fullEmail.date
        },
        userInstruction: instruction,
        locale: user.locale || "es"
      });

      // Show preview
      await this.whatsappClient.sendMessage(
        chatId,
        `*Preview de tu respuesta:*\n\n` +
          `*Para:* ${fullEmail.from}\n` +
          `*Asunto:* ${reply.subject}\n\n` +
          `${reply.body}\n\n` +
          `_Responde "enviar" para enviar o "cancelar" para descartar._`
      );

      // Store pending reply (reuses existing send/cancel flow)
      this.pendingReplies.set(chatId, {
        userId: user.id,
        messageId: viewed.gmailMessageId,
        threadId: viewed.threadId,
        to: fullEmail.from,
        subject: reply.subject,
        body: reply.body
      });

      this.lastViewedEmail.delete(chatId);
      this.logger.info(`Reply preview from search shown for ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to compose reply to viewed email for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error preparando la respuesta. Intenta de nuevo mas tarde."
      );
      this.lastViewedEmail.delete(chatId);
    }
  }

  private async handleEmailStatus(chatId: string): Promise<void> {
    if (!this.userService || !this.gmailAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de email no esta disponible en este momento."
      );
      return;
    }

    // Check email access on plan
    if (this.subscriptionService) {
      const access = await this.subscriptionService.checkEmailAccess(chatId);
      if (!access.allowed) {
        await this.whatsappClient.sendMessage(chatId, access.message);
        return;
      }
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);

      if (!user) {
        await this.whatsappClient.sendMessage(
          chatId,
          "📧 *Estado del Email*\n\n" +
            "No tenes email conectado.\n\n" +
            "Decime 'conecta mi email' para vincularlo."
        );
        return;
      }

      const isLinked = await this.gmailAuthService.isAuthenticated(user.id);

      if (isLinked) {
        await this.whatsappClient.sendMessage(
          chatId,
          "📧 *Estado del Email*\n\n" +
            "✅ Tu email esta conectado!\n\n" +
            "Estoy monitoreando tus emails para avisarte de entregas, citas, reuniones y vuelos."
        );
      } else {
        await this.whatsappClient.sendMessage(
          chatId,
          "📧 *Estado del Email*\n\n" +
            "❌ Tu email no esta conectado.\n\n" +
            "Decime 'conecta mi email' para vincularlo."
        );
      }
    } catch (error) {
      this.logger.error(`Failed to check email status for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error verificando el estado. Intenta de nuevo mas tarde."
      );
    }
  }
}
