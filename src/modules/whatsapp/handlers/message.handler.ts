import type { IntentService, ReminderDetail } from "@modules/ai/intent/intent.service";
import type { TranscriptionService } from "@modules/ai/transcription/transcription.service";
import type { CryptoService } from "@modules/crypto/services/crypto.service";
import type { DollarService } from "@modules/dollar/services/dollar.service";
import type { GmailAuthService } from "@modules/email/gmail/gmail-auth.service";
import type { GmailService } from "@modules/email/gmail/gmail.service";
import type { ProcessedEmailRepository } from "@modules/email/processor/processed-email.repository";
import type { EmailReplyService } from "@modules/email/reply/email-reply.service";
import type { UserService } from "@modules/email/user/user.service";
import type { FinancialAdviceService } from "@modules/expenses/advice/financial-advice.service";
import type { ExpenseService } from "@modules/expenses/expense.service";
import type { ExpenseSummaryService } from "@modules/expenses/summary/expense-summary.service";
import type { LinkingCodeService } from "@modules/linking/linking.service";
import type { Coordinates, MapsService, TravelMode } from "@modules/maps/services/maps.service";
import type { MeliApiService } from "@modules/mercadolibre/api/meli-api.service";
import type { MeliAuthService } from "@modules/mercadolibre/auth/meli-auth.service";
import type { MeliTransferService } from "@modules/mercadolibre/transfers/transfer.service";
import type { NewsCategory, NewsService } from "@modules/news/services/news.service";
import type { ProductSearchService } from "@modules/product-search/product-search.service";
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

function formatReminderDate(date: Date): string {
  return date.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function extractRateLimitWait(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const err = error as Record<string, unknown>;

  // Try parsing from error message (GROQ includes "try again in Xh Ym Zs")
  const msg = typeof err.message === "string" ? err.message : "";
  const match = msg.match(/try again in\s+((?:\d+h)?(?:\d+m)?(?:\d+(?:\.\d+)?s)?)/i);

  if (match?.[1]) {
    const timeStr = match[1];
    const h = timeStr.match(/(\d+)h/);
    const m = timeStr.match(/(\d+)m/);
    const s = timeStr.match(/(\d+)/); // fallback to any number

    const hours = h ? parseInt(h[1]) : 0;
    const minutes = m ? parseInt(m[1]) : 0;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} hora${hours > 1 ? "s" : ""}`);
    if (minutes > 0) parts.push(`${minutes} minuto${minutes > 1 ? "s" : ""}`);
    if (parts.length === 0 && s) parts.push(`${parseInt(s[1])} segundos`);
    if (parts.length > 0) return parts.join(" y ");
  }

  // Fallback: try Retry-After header (seconds)
  const headers = err.headers as Record<string, string> | undefined;
  const retryAfter = headers?.["retry-after"];
  if (retryAfter) {
    const totalSeconds = Math.ceil(Number(retryAfter));
    if (!isNaN(totalSeconds) && totalSeconds > 0) {
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const parts: string[] = [];
      if (h > 0) parts.push(`${h} hora${h > 1 ? "s" : ""}`);
      if (m > 0) parts.push(`${m} minuto${m > 1 ? "s" : ""}`);
      if (parts.length === 0) parts.push(`${totalSeconds} segundos`);
      return parts.join(" y ");
    }
  }

  return null;
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

interface PendingTransfer {
  userId: string;
  recipient: string;
  amount: number;
  description?: string;
  scheduledAt?: Date;
}

export class MessageHandler {
  private readonly logger = createLogger("message-handler");
  private readonly pendingReplies = new Map<string, PendingReply>();
  private readonly lastViewedEmail = new Map<string, ViewedEmail>();
  private readonly pendingSearchReply = new Set<string>();
  private readonly pendingReplyInstruction = new Set<string>();
  private readonly pendingModifyTask = new Map<string, number>();
  private readonly pendingTransfers = new Map<string, PendingTransfer>();
  private readonly scheduledTransfers = new Map<string, ReturnType<typeof setTimeout>>();
  // Stores the last location shared by the user (expires after 30 minutes)
  private readonly userLocations = new Map<string, { coords: Coordinates; savedAt: Date }>();

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
    private readonly processedEmailRepository?: ProcessedEmailRepository,
    private readonly productSearchService?: ProductSearchService,
    private readonly meliAuthService?: MeliAuthService,
    private readonly meliApiService?: MeliApiService,
    private readonly expenseService?: ExpenseService,
    private readonly financialAdviceService?: FinancialAdviceService,
    private readonly expenseSummaryService?: ExpenseSummaryService,
    private readonly dollarService?: DollarService,
    private readonly cryptoService?: CryptoService,
    private readonly newsService?: NewsService,
    private readonly mapsService?: MapsService,
    private readonly meliTransferService?: MeliTransferService
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

    // Handle interactive responses (button taps, list selections)
    if (message.type === "buttonResponse" || message.type === "listResponse") {
      await this.handleInteractiveResponse(message);
      return;
    }

    // Handle location messages
    if (message.type === "location") {
      await this.handleLocationMessage(message);
      return;
    }

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
            `Llegué al límite de consultas 😬 Vas a tener que esperar ${wait} para volver a usarme.`
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

    // Check for pending modify task (from list interaction)
    if (this.pendingModifyTask.has(message.chatId)) {
      await this.handlePendingModifyTaskResponse(message.chatId, text);
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

    // Check for pending transfer confirmation
    if (this.pendingTransfers.has(message.chatId)) {
      await this.handlePendingTransferResponse(message.chatId, text);
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
          await this.handleSearchEmail(
            message.chatId,
            intent.emailSearchQuery,
            intent.emailExtractionQuery
          );
          break;

        case "search_product":
          await this.handleSearchProduct(message.chatId, intent.productSearchQuery);
          break;

        case "link_mercadolibre":
          await this.handleLinkMercadoLibre(message.chatId);
          break;

        case "unlink_mercadolibre":
          await this.handleUnlinkMercadoLibre(message.chatId);
          break;

        case "track_order":
          await this.handleTrackOrder(message.chatId);
          break;

        case "enable_digest":
          await this.handleEnableDigest(message.chatId, intent.digestHour);
          break;

        case "disable_digest":
          await this.handleDisableDigest(message.chatId);
          break;

        case "check_expenses":
          await this.handleCheckExpenses(message.chatId, intent.expensePeriod ?? "month");
          break;

        case "financial_advice":
          await this.handleFinancialAdvice(message.chatId);
          break;

        case "check_dollar":
          await this.handleCheckDollar(message.chatId);
          break;

        case "get_news":
          await this.handleGetNews(message.chatId, intent.newsQuery, intent.newsCategory);
          break;

        case "check_crypto":
          await this.handleCheckCrypto(message.chatId, intent.coins);
          break;

        case "get_directions":
          await this.handleGetDirections(
            message.chatId,
            intent.directionsOrigin,
            intent.directionsDestination,
            intent.travelMode as TravelMode | undefined
          );
          break;

        case "send_money":
          await this.handleSendMoney(
            message.chatId,
            intent.transferRecipient,
            intent.transferAmount,
            intent.transferDescription,
            intent.transferScheduledAt
          );
          break;

        default:
          await this.whatsappClient.sendMessage(
            message.chatId,
            "No entendí bien 😅 Puedo ayudarte con:\n" +
              "• Recordatorios: 'recuerdame mañana a las 3 llamar a mamá'\n" +
              "• Recordatorios recurrentes: 'recuerdame todos los días a las 8 tomar la pastilla'\n" +
              "• Ver tareas: 'qué tareas tengo'\n" +
              "• Cancelar: 'cancela la tarea 2'\n" +
              "• Cambiar hora: 'cambia la tarea 1 a las 5pm'\n" +
              "• Conectar email: 'conecta mi email'\n" +
              "• Responder email: 'respondele al mail diciendo que acepto'\n" +
              "• Buscar email: 'buscá el mail de Juan sobre el presupuesto'\n" +
              "• Buscar productos: 'buscame auriculares bluetooth'\n" +
              "• Conectar MercadoLibre: 'conecta mi mercado libre'\n" +
              "• Rastrear pedido: 'dónde está mi paquete'\n" +
              "• Resumen diario: 'activar resumen diario' / 'desactivar resumen diario'\n" +
              "• Ver gastos: 'cuánto gasté este mes'\n" +
              "• Consejos financieros: 'dame consejos de ahorro'\n" +
              "• Dólar: '¿a cuánto está el dólar?'\n" +
              "• Noticias: '¿qué noticias hay hoy?'\n" +
              "• Cripto: '¿a cuánto está el bitcoin?'\n" +
              "• Cómo llegar: 'cómo llego de Palermo a Recoleta'\n" +
              "• Vincular con la web: /connect"
          );
      }
    } catch (error) {
      this.logger.error("Failed to process message", error);
      if (isRateLimitError(error)) {
        const wait = extractRateLimitWait(error) || "unos minutos";
        await this.whatsappClient.sendMessage(
          message.chatId,
          `Llegué al límite de consultas 😬 Vas a tener que esperar ${wait} para volver a usarme.`
        );
      } else {
        await this.whatsappClient.sendMessage(
          message.chatId,
          "Hubo un error procesando tu mensaje. Intentá de nuevo más tarde."
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
        `Anotado! Pero necesito saber *cuándo* querés que te recuerde "${description}" 📅\n\n` +
          "Por ejemplo:\n" +
          "• 'mañana a las 3'\n" +
          "• 'el viernes a las 10'\n" +
          "• 'todos los días a las 8'\n" +
          "• 'todos los lunes a las 9'"
      );
      return;
    }

    if (!intent.reminderDetails || intent.reminderDetails.length === 0) {
      await this.whatsappClient.sendMessage(
        chatId,
        "No entendí bien qué querés recordar 😅 Contame de nuevo: ¿qué y cuándo?"
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
        reminderText: detail.description,
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
      let message = `✅ Listo! Te creé ${createdReminders.length} recordatorios:\n\n`;
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
      return `✅ Listo! Todos los días a las ${timeStr} te recuerdo "${r.description}" 🔁`;
    }

    if (r.recurrence === "WEEKLY" && r.recurrenceDay !== null) {
      const dayName = DAYS_OF_WEEK[r.recurrenceDay];
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `✅ Listo! Todos los ${dayName} a las ${timeStr} te recuerdo "${r.description}" 🔁`;
    }

    if (r.recurrence === "MONTHLY" && r.recurrenceDay !== null) {
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `✅ Listo! El día ${r.recurrenceDay} de cada mes a las ${timeStr} te recuerdo "${r.description}" 🔁`;
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
    return `✅ Listo! El ${confirmationTime} te recuerdo "${r.description}" 🗓️`;
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
      return `"${r.description}" — todos los días a las ${timeStr} 🔁`;
    }

    if (r.recurrence === "WEEKLY" && r.recurrenceDay !== null) {
      const dayName = DAYS_OF_WEEK[r.recurrenceDay];
      const timeStr = r.dateTime?.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });
      return `"${r.description}" — todos los ${dayName} a las ${timeStr} 🔁`;
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
          dateStr = `Todos los días ${timeStr}`;
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

    response += `_Para cancelar: "cancela la tarea 2" • Para cambiar hora: "cambia la tarea 1 a las 5pm"_`;
    await this.whatsappClient.sendMessage(chatId, response);
  }

  private async handleCancelTask(chatId: string, taskNumber?: number): Promise<void> {
    if (!taskNumber) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime el número de tarea a cancelar. Ej: 'cancela la tarea 2'"
      );
      return;
    }

    const reminders = await this.reminderService.getPendingRemindersOrdered(chatId);

    if (taskNumber < 1 || taskNumber > reminders.length) {
      await this.whatsappClient.sendMessage(
        chatId,
        `No existe la tarea ${taskNumber} 🤔 Tenés ${reminders.length} tarea(s) pendiente(s).`
      );
      return;
    }

    const reminder = reminders[taskNumber - 1];
    const wasRecurring = reminder.recurrence !== "NONE";
    await this.reminderService.cancelReminder(reminder.id);

    const cancelMsg = wasRecurring
      ? `Listo! Cancelé la tarea ${taskNumber}: "${reminder.reminderText}" ❌\n_(Ya no se va a repetir)_`
      : `Listo! Cancelé la tarea ${taskNumber}: "${reminder.reminderText}" ❌`;

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
        "Decime el número de tarea a modificar. Ej: 'cambia la tarea 2 a las 5pm'"
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
        `No existe la tarea ${taskNumber} 🤔 Tenés ${reminders.length} tarea(s) pendiente(s).`
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
      `✅ Listo! Moví la tarea ${taskNumber} para el ${newTimeStr}`
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
        "Hubo un error generando el link. Intentá de nuevo más tarde."
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
        "Hubo un error desconectando el email. Intentá de nuevo más tarde."
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
        "Hubo un error generando el codigo. Intentá de nuevo más tarde."
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
          `_Respondé "enviar" para enviar o "cancelar" para descartar._`
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
        "Hubo un error preparando la respuesta. Intentá de nuevo más tarde."
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
          "Hubo un error enviando el email. Intentá de nuevo más tarde."
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

  private async handleSearchEmail(
    chatId: string,
    searchQuery?: string,
    extractionQuery?: string
  ): Promise<void> {
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

      // If extraction requested, fetch full body and extract specific info
      if (extractionQuery && this.emailReplyService && this.gmailService) {
        try {
          const fullEmail = await this.gmailService.getMessage(user.id, foundEmail.gmailMessageId);

          const extracted = await this.emailReplyService.extractInfo({
            emailBody: fullEmail.body,
            from: foundEmail.from,
            subject: foundEmail.subject,
            date: foundEmail.date,
            extractionQuery
          });

          await this.whatsappClient.sendMessage(chatId, `🔍 *${extractionQuery}:*\n\n${extracted}`);
        } catch (extractError) {
          this.logger.error("Failed to extract info from email", extractError);
          // Fall through to show normal email preview
        }
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
        message += `\n${contentPreview}`;
      }

      message += `\n\n_¿Querés responder? Decime "si" o "no"._`;
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
        "Hubo un error buscando emails. Intentá de nuevo más tarde."
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
          `_Respondé "enviar" para enviar o "cancelar" para descartar._`
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
        "Hubo un error preparando la respuesta. Intentá de nuevo más tarde."
      );
      this.lastViewedEmail.delete(chatId);
    }
  }

  private async handleSearchProduct(chatId: string, query?: string): Promise<void> {
    if (!this.productSearchService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de busqueda de productos no esta disponible en este momento."
      );
      return;
    }

    if (!query) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime que producto buscas. Ej: 'buscame auriculares bluetooth'"
      );
      return;
    }

    try {
      await this.whatsappClient.sendMessage(chatId, "Buscando productos... 🔍");

      // Try to get ML access token for authenticated search
      let mlAccessToken: string | undefined;
      if (this.meliAuthService && this.userService) {
        try {
          const user = await this.userService.getUserByChatId(chatId);
          if (user && (await this.meliAuthService.isAuthenticated(user.id))) {
            const { accessToken } = await this.meliAuthService.getAccessToken(user.id);
            mlAccessToken = accessToken;
          }
        } catch {
          // Proceed without ML token
        }
      }

      const results = await this.productSearchService.search(query, mlAccessToken);

      if (results.length === 0) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No encontre resultados para tu busqueda. Intenta con otros terminos."
        );
        return;
      }

      let message = `🛒 *Mejores precios para "${query}":*\n\n`;

      results.forEach((product, index) => {
        const priceStr = this.formatPrice(product.price, product.currency);
        const bestTag = index === 0 ? " 🏷️ *Mejor precio!*" : "";

        message += `*${index + 1}.* ${product.title}\n`;
        message += `   💰 ${priceStr}${bestTag}\n`;
        message += `   🏪 ${product.seller} (${product.source})\n`;
        message += `   🔗 ${product.link}\n\n`;
      });

      message += `_Mostrando ${results.length} resultado${results.length > 1 ? "s" : ""} ordenados por precio._`;

      await this.whatsappClient.sendMessage(chatId, message);

      this.logger.info(`Product search results sent for "${query}" to ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to search products for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error buscando productos. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleLinkMercadoLibre(chatId: string): Promise<void> {
    if (!this.userService || !this.meliAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de MercadoLibre no esta disponible en este momento."
      );
      return;
    }

    try {
      const user = await this.userService.getOrCreateUser(chatId);

      const isLinked = await this.meliAuthService.isAuthenticated(user.id);
      if (isLinked) {
        await this.whatsappClient.sendMessage(
          chatId,
          "Ya tenes tu MercadoLibre conectado! 🛒\n\n" +
            "Puedo buscar productos y rastrear tus pedidos.\n\n" +
            "Si queres desconectarlo, decime 'desconecta mercado libre'."
        );
        return;
      }

      const hostUrl = env().HOST_URL;
      const authUrl = `${hostUrl}/auth/mercadolibre?userId=${user.id}`;

      await this.whatsappClient.sendMessage(
        chatId,
        `🛒 *Conectar MercadoLibre*\n\n` +
          `Para vincular tu cuenta, hace click en este link:\n\n` +
          `${authUrl}\n\n` +
          `Una vez que autorices, voy a poder:\n` +
          `🔍 Buscar productos con tu cuenta\n` +
          `📦 Rastrear tus pedidos y envios\n\n` +
          `_Tu privacidad es importante: solo accedo a tus compras y busquedas._`
      );

      this.logger.info(`MercadoLibre link URL sent to ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to handle link MercadoLibre for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error generando el link. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleUnlinkMercadoLibre(chatId: string): Promise<void> {
    if (!this.userService || !this.meliAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de MercadoLibre no esta disponible en este momento."
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);

      if (!user) {
        await this.whatsappClient.sendMessage(chatId, "No tenes MercadoLibre conectado.");
        return;
      }

      const isLinked = await this.meliAuthService.isAuthenticated(user.id);

      if (!isLinked) {
        await this.whatsappClient.sendMessage(chatId, "No tenes MercadoLibre conectado.");
        return;
      }

      await this.meliAuthService.revokeAccess(user.id);

      await this.whatsappClient.sendMessage(
        chatId,
        "MercadoLibre desconectado exitosamente. ✅\n\n" +
          "Ya no voy a poder rastrear tus pedidos.\n" +
          "Si queres volver a conectarlo, decime 'conecta mi mercado libre'."
      );

      this.logger.info(`MercadoLibre unlinked for ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to unlink MercadoLibre for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error desconectando MercadoLibre. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleTrackOrder(chatId: string): Promise<void> {
    if (!this.userService || !this.meliAuthService || !this.meliApiService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de rastreo de pedidos no esta disponible en este momento."
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);

      if (!user) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenes cuenta vinculada. Decime 'conecta mi mercado libre' para empezar."
        );
        return;
      }

      const isLinked = await this.meliAuthService.isAuthenticated(user.id);

      if (!isLinked) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenes MercadoLibre conectado. Decime 'conecta mi mercado libre' para vincularlo."
        );
        return;
      }

      await this.whatsappClient.sendMessage(chatId, "Buscando tus pedidos recientes... 📦");

      const orders = await this.meliApiService.getRecentOrders(user.id, 5);

      if (orders.length === 0) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No encontre pedidos recientes en tu cuenta de MercadoLibre."
        );
        return;
      }

      let message = "📦 *Tus pedidos recientes:*\n\n";

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const itemNames = order.order_items.map((oi) => oi.item.title).join(", ");
        const dateStr = new Date(order.date_created).toLocaleDateString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          day: "numeric",
          month: "short"
        });

        message += `*${i + 1}.* ${itemNames}\n`;
        message += `   💰 $${order.total_amount.toLocaleString("es-AR")} ${order.currency_id}\n`;
        message += `   📅 ${dateStr}\n`;

        // Get shipment info if available
        if (order.shipping?.id) {
          const shipment = await this.meliApiService.getShipment(user.id, order.shipping.id);
          if (shipment) {
            const statusText = this.translateShipmentStatus(shipment.status);
            message += `   🚚 ${statusText}`;
            if (shipment.tracking_number) {
              message += ` (${shipment.tracking_number})`;
            }
            message += "\n";
          }
        }

        message += "\n";
      }

      await this.whatsappClient.sendMessage(chatId, message);

      this.logger.info(`Order tracking results sent to ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to track orders for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error consultando tus pedidos. Intentá de nuevo más tarde."
      );
    }
  }

  private translateShipmentStatus(status: string): string {
    const statusMap: Record<string, string> = {
      pending: "Pendiente",
      handling: "En preparacion",
      ready_to_ship: "Listo para enviar",
      shipped: "En camino 🚚",
      delivered: "Entregado ✅",
      not_delivered: "No entregado ❌",
      cancelled: "Cancelado"
    };
    return statusMap[status] || status;
  }

  private formatPrice(price: number, currency: string): string {
    if (currency === "ARS") {
      return `$${price.toLocaleString("es-AR")} ARS`;
    }
    if (currency === "USD") {
      return `US$${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    }
    return `${price.toLocaleString()} ${currency}`;
  }

  private async handleEnableDigest(chatId: string, hour?: number | null): Promise<void> {
    if (!this.userService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de resumen diario no esta disponible en este momento."
      );
      return;
    }

    const digestHour = hour ?? 8;

    try {
      await this.userService.updateDigestSettings(chatId, true, digestHour);
      const hourStr = String(digestHour).padStart(2, "0");
      await this.whatsappClient.sendMessage(
        chatId,
        `✅ Resumen diario activado a las ${hourStr}:00 hs.\n\nCada mañana te voy a mandar un resumen con tus recordatorios del dia.`
      );
      this.logger.info(`Digest enabled for ${chatId} at hour ${digestHour}`);
    } catch (error) {
      this.logger.error(`Failed to enable digest for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error activando el resumen diario. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleDisableDigest(chatId: string): Promise<void> {
    if (!this.userService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de resumen diario no esta disponible en este momento."
      );
      return;
    }

    try {
      await this.userService.updateDigestSettings(chatId, false);
      await this.whatsappClient.sendMessage(
        chatId,
        "✅ Resumen diario desactivado.\n\nYa no voy a mandarte el resumen matutino. Podes volver a activarlo cuando quieras."
      );
      this.logger.info(`Digest disabled for ${chatId}`);
    } catch (error) {
      this.logger.error(`Failed to disable digest for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error desactivando el resumen diario. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleInteractiveResponse(message: MessageContent): Promise<void> {
    const chatId = message.chatId;
    // polls and buttons share selectedButtonId; lists use selectedRowId
    const selectedId = message.selectedButtonId ?? message.selectedRowId ?? "";

    // Email flows: pending reply confirmation (enviar / cancelar)
    if (this.pendingReplies.has(chatId)) {
      await this.handlePendingReplyResponse(chatId, selectedId);
      return;
    }

    // Email flows: pending search reply (si / no)
    if (this.pendingSearchReply.has(chatId)) {
      await this.handlePendingSearchReplyResponse(chatId, selectedId);
      return;
    }

    // Task actions from polls/lists (cancel_N, modify_N)
    if (selectedId.startsWith("cancel_") && selectedId !== "cancel_none") {
      const idx = parseInt(selectedId.replace("cancel_", ""), 10);
      await this.handleCancelTask(chatId, idx + 1);
      return;
    }

    if (selectedId.startsWith("modify_") && selectedId !== "modify_none") {
      const idx = parseInt(selectedId.replace("modify_", ""), 10);
      this.pendingModifyTask.set(chatId, idx + 1);
      await this.whatsappClient.sendMessage(
        chatId,
        "¿A qué hora querés cambiar la tarea? Ej: 'mañana a las 5pm'"
      );
    }
  }

  private async handlePendingModifyTaskResponse(chatId: string, text: string): Promise<void> {
    const taskNumber = this.pendingModifyTask.get(chatId)!;
    this.pendingModifyTask.delete(chatId);

    try {
      const syntheticText = `cambia la tarea ${taskNumber} a ${text}`;
      const intent = await this.intentService.parseIntent(syntheticText);

      if (intent.type === "modify_task" && intent.newDateTime) {
        await this.handleModifyTask(chatId, taskNumber, intent.newDateTime);
      } else {
        await this.whatsappClient.sendMessage(
          chatId,
          "No pude entender el horario. Intentá de nuevo con 'cambia la tarea N a las Xpm'."
        );
      }
    } catch (error) {
      this.logger.error("Failed to parse modify time from pending task", error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error procesando el horario. Intentá de nuevo."
      );
    }
  }

  private async handleCheckExpenses(
    chatId: string,
    period: "day" | "week" | "month"
  ): Promise<void> {
    if (!this.expenseService || !this.userService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de gastos no esta disponible en este momento."
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);
      if (!user) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenes cuenta vinculada. Usa /connect para vincularla."
        );
        return;
      }

      let summary;
      let periodLabel: string;

      const now = new Date();
      if (period === "day") {
        const from = new Date(now);
        from.setHours(0, 0, 0, 0);
        const to = new Date(now);
        to.setHours(23, 59, 59, 999);
        summary = await this.expenseService.getSummaryForDateRange(user.id, from, to);
        periodLabel = now.toLocaleDateString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          weekday: "long",
          day: "numeric",
          month: "long"
        });
      } else if (period === "week") {
        // Start of this week (Monday)
        const weekStart = new Date(now);
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);
        weekStart.setHours(0, 0, 0, 0);
        summary = await this.expenseService.getWeeklySummary(user.id, weekStart);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const startStr = weekStart.toLocaleDateString("es-AR", {
          day: "numeric",
          month: "short"
        });
        const endStr = weekEnd.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
        periodLabel = `semana del ${startStr} al ${endStr}`;
      } else {
        summary = await this.expenseService.getCurrentMonthSummary(user.id);
        periodLabel = now.toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          month: "long",
          year: "numeric"
        });
      }

      if (summary.transactionCount === 0) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No encontre gastos registrados para este periodo.\n\n" +
            "Conecto tu Gmail para que pueda analizar tus compras: decime 'conecta mi email'."
        );
        return;
      }

      if (!this.expenseSummaryService) {
        await this.whatsappClient.sendMessage(
          chatId,
          "La funcion de resumen de gastos no esta disponible."
        );
        return;
      }

      const message = await this.expenseSummaryService.formatSummaryMessage(
        summary,
        periodLabel,
        false
      );

      await this.whatsappClient.sendMessage(chatId, message);
      await this.whatsappClient.sendMessage(
        chatId,
        "Queres consejos personalizados basados en tus gastos? Decime *dame consejos de ahorro*."
      );
    } catch (error) {
      this.logger.error(`Failed to check expenses for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error consultando tus gastos. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleFinancialAdvice(chatId: string): Promise<void> {
    if (!this.financialAdviceService || !this.expenseService || !this.userService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de consejos financieros no esta disponible en este momento."
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);
      if (!user) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenes cuenta vinculada. Usa /connect para vincularla."
        );
        return;
      }

      // Use last month for advice (more complete data)
      const summary = await this.expenseService.getLastMonthSummary(user.id);

      if (summary.transactionCount === 0) {
        // Try current month as fallback
        const currentSummary = await this.expenseService.getCurrentMonthSummary(user.id);
        if (currentSummary.transactionCount === 0) {
          await this.whatsappClient.sendMessage(
            chatId,
            "No tengo suficientes datos de gastos para generar consejos personalizados.\n\n" +
              "Conecta tu Gmail para que pueda analizar tus compras: decime 'conecta mi email'."
          );
          return;
        }

        const now = new Date();
        const periodLabel = now.toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          month: "long",
          year: "numeric"
        });
        const advice = await this.financialAdviceService.generateAdvice(
          currentSummary,
          periodLabel
        );
        await this.whatsappClient.sendMessage(chatId, `💡 *Consejos financieros:*\n\n${advice}`);
        return;
      }

      const now = new Date();
      let year = now.getFullYear();
      let month = now.getMonth();
      if (month === 0) {
        month = 12;
        year--;
      }
      const periodLabel = new Date(year, month - 1, 1).toLocaleString("es-AR", {
        month: "long",
        year: "numeric"
      });

      await this.whatsappClient.sendMessage(chatId, "Analizando tus gastos... 📊");
      const advice = await this.financialAdviceService.generateAdvice(summary, periodLabel);
      await this.whatsappClient.sendMessage(chatId, `💡 *Consejos financieros:*\n\n${advice}`);
    } catch (error) {
      this.logger.error(`Failed to generate financial advice for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error generando los consejos. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleCheckDollar(chatId: string): Promise<void> {
    if (!this.dollarService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de cotizacion no esta disponible en este momento."
      );
      return;
    }

    try {
      await this.whatsappClient.sendMessage(chatId, "Consultando cotizacion... 💵");
      const rates = await this.dollarService.getRates();
      await this.whatsappClient.sendMessage(chatId, this.dollarService.formatMessage(rates));
    } catch (error) {
      this.logger.error(`Failed to fetch dollar rates for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "No pude obtener la cotizacion en este momento. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleGetNews(chatId: string, query?: string, category?: string): Promise<void> {
    if (!this.newsService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de noticias no esta configurada. Se necesita una NEWS_API_KEY."
      );
      return;
    }

    try {
      await this.whatsappClient.sendMessage(chatId, "Buscando noticias... 📰");
      const articles = await this.newsService.getTopHeadlines({
        query: query || undefined,
        category: (category as NewsCategory) || undefined
      });
      await this.whatsappClient.sendMessage(
        chatId,
        this.newsService.formatMessage(articles, query || undefined)
      );
    } catch (error) {
      this.logger.error(`Failed to fetch news for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "No pude obtener las noticias en este momento. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleCheckCrypto(chatId: string, coins?: string[]): Promise<void> {
    if (!this.cryptoService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de cripto no esta disponible en este momento."
      );
      return;
    }

    try {
      await this.whatsappClient.sendMessage(chatId, "Consultando precios cripto... 🪙");
      const prices = await this.cryptoService.getPrices(coins);
      await this.whatsappClient.sendMessage(chatId, this.cryptoService.formatMessage(prices));
    } catch (error) {
      this.logger.error(`Failed to fetch crypto prices for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "No pude obtener los precios en este momento. Intentá de nuevo más tarde."
      );
    }
  }

  private async handleGetDirections(
    chatId: string,
    origin?: string,
    destination?: string,
    mode?: TravelMode
  ): Promise<void> {
    if (!this.mapsService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de mapas no esta configurada. Se necesita una ORS_API_KEY (openrouteservice.org)."
      );
      return;
    }

    if (!destination) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime adonde querés ir. Ej: 'cómo llego a Recoleta'"
      );
      return;
    }

    try {
      await this.whatsappClient.sendMessage(chatId, "Buscando la ruta... 🗺️");

      let route;
      const savedLocation = this.getSavedLocation(chatId);

      if (!origin && savedLocation) {
        route = await this.mapsService.getDirectionsFromCoords(
          savedLocation,
          destination,
          mode ?? "transit"
        );
      } else if (origin) {
        route = await this.mapsService.getDirections(origin, destination, mode ?? "transit");
      } else {
        await this.whatsappClient.sendMessage(
          chatId,
          "Decime de dónde salís o compartí tu ubicación 📍 y luego pedime las indicaciones."
        );
        return;
      }

      await this.whatsappClient.sendMessage(chatId, this.mapsService.formatMessage(route));
    } catch (error) {
      this.logger.error(`Failed to get directions for ${chatId}`, error);
      const msg =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: string }).message)
          : "";
      if (msg.includes("No se encontró ruta") || msg.includes("No se encontró la dirección")) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No encontré una ruta entre esos puntos. Verificá las ubicaciones e intentalo de nuevo."
        );
      } else {
        await this.whatsappClient.sendMessage(
          chatId,
          "No pude obtener las indicaciones en este momento. Intentá de nuevo más tarde."
        );
      }
    }
  }

  private async handleSendMoney(
    chatId: string,
    recipient?: string | null,
    amount?: number | null,
    description?: string | null,
    scheduledAt?: string | null
  ): Promise<void> {
    if (!this.meliTransferService || !this.userService || !this.meliAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La función de transferencias no está disponible. Necesitás conectar tu cuenta de Mercado Pago."
      );
      return;
    }

    if (!amount || amount <= 0) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime el monto a transferir. Ej: _'pagale 5000 pesos al alias gonzalez.mp'_"
      );
      return;
    }

    if (!recipient) {
      await this.whatsappClient.sendMessage(
        chatId,
        "Decime el alias, CVU o CBU del destinatario. Ej: _'pagale 5000 a gonzalez.mp'_"
      );
      return;
    }

    try {
      const user = await this.userService.getUserByChatId(chatId);
      if (!user) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenés cuenta vinculada. Usá /connect para vincularla."
        );
        return;
      }

      const isLinked = await this.meliAuthService.isAuthenticated(user.id);
      if (!isLinked) {
        await this.whatsappClient.sendMessage(
          chatId,
          "No tenés Mercado Pago conectado. Decime _'conecta mi mercado libre'_ para vincularlo."
        );
        return;
      }

      // Parse scheduled date if provided
      let scheduledDate: Date | undefined;
      if (scheduledAt) {
        scheduledDate = new Date(scheduledAt);
        if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
          scheduledDate = undefined;
        }
      }

      const amountStr = amount.toLocaleString("es-AR", { minimumFractionDigits: 2 });
      const descLine = description ? `\n📝 *Descripción:* ${description}` : "";

      let confirmMsg =
        `💸 *Confirmación de transferencia*\n\n` +
        `💰 *Monto:* $${amountStr}\n` +
        `👤 *Destinatario:* ${recipient}${descLine}`;

      if (scheduledDate) {
        const dateStr = scheduledDate.toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit"
        });
        confirmMsg += `\n🕐 *Programada para:* ${dateStr}`;
      }

      confirmMsg += `\n\n_Respondé *confirmar* para ejecutar o *cancelar* para descartar._`;

      await this.whatsappClient.sendMessage(chatId, confirmMsg);

      this.pendingTransfers.set(chatId, {
        userId: user.id,
        recipient,
        amount,
        description: description ?? undefined,
        scheduledAt: scheduledDate
      });
    } catch (error) {
      this.logger.error(`Failed to prepare transfer for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error preparando la transferencia. Intentá de nuevo más tarde."
      );
    }
  }

  private async handlePendingTransferResponse(chatId: string, text: string): Promise<void> {
    const pending = this.pendingTransfers.get(chatId);
    if (!pending) return;

    const normalized = text.trim().toLowerCase();

    if (!["confirmar", "confirm", "si", "sí", "yes"].includes(normalized)) {
      this.pendingTransfers.delete(chatId);
      await this.whatsappClient.sendMessage(chatId, "Transferencia cancelada. ❌");
      return;
    }

    this.pendingTransfers.delete(chatId);

    // Scheduled transfer
    if (pending.scheduledAt && pending.scheduledAt > new Date()) {
      const delay = pending.scheduledAt.getTime() - Date.now();
      const dateStr = pending.scheduledAt.toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit"
      });

      const timer = setTimeout(async () => {
        this.scheduledTransfers.delete(chatId);
        await this.executeTransfer(chatId, pending);
      }, delay);

      this.scheduledTransfers.set(chatId, timer);

      await this.whatsappClient.sendMessage(
        chatId,
        `✅ *Transferencia programada*\n\n` +
          `Se va a ejecutar el ${dateStr}.\n` +
          `Monto: $${pending.amount.toLocaleString("es-AR")} → ${pending.recipient}`
      );
      return;
    }

    // Immediate transfer
    await this.executeTransfer(chatId, pending);
  }

  private async executeTransfer(chatId: string, pending: PendingTransfer): Promise<void> {
    if (!this.meliTransferService) return;

    await this.whatsappClient.sendMessage(chatId, "Procesando transferencia... ⏳");

    try {
      const result = await this.meliTransferService.sendTransfer(pending.userId, {
        recipient: pending.recipient,
        amount: pending.amount,
        description: pending.description
      });

      if (result.success) {
        const amountStr = pending.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 });
        await this.whatsappClient.sendMessage(
          chatId,
          `✅ *Transferencia exitosa!*\n\n` +
            `💰 $${amountStr} enviados a *${pending.recipient}*\n` +
            (result.transactionId ? `🔖 ID: ${result.transactionId}` : "")
        );
      } else {
        await this.whatsappClient.sendMessage(
          chatId,
          `❌ *Error en la transferencia*\n\n${result.message}\n\n` +
            `Verificá que tenés saldo suficiente y que el alias/CVU es correcto.`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to execute transfer for ${chatId}`, error);
      await this.whatsappClient.sendMessage(
        chatId,
        "Hubo un error ejecutando la transferencia. Verificá tu saldo e intentá de nuevo."
      );
    }
  }

  private async handleLocationMessage(message: MessageContent): Promise<void> {
    const { chatId, latitude, longitude, locationName } = message;

    if (latitude == null || longitude == null) return;

    const coords: Coordinates = {
      lat: latitude,
      lon: longitude,
      label: locationName ?? "Tu ubicación"
    };
    this.userLocations.set(chatId, { coords, savedAt: new Date() });

    this.logger.info(`Location saved for ${chatId}: ${latitude},${longitude}`);

    await this.whatsappClient.sendMessage(
      chatId,
      `📍 *Ubicación guardada!*\n\n` +
        (locationName ? `*Lugar:* ${locationName}\n\n` : "") +
        `Ahora podés pedirme indicaciones sin especificar el origen. Ej:\n` +
        `_"¿Cómo llego a Recoleta?"_\n` +
        `_"¿Cuánto tarda a Constitución caminando?"_\n\n` +
        `⏳ La ubicación se recuerda por 30 minutos.`
    );
  }

  private getSavedLocation(chatId: string): Coordinates | null {
    const entry = this.userLocations.get(chatId);
    if (!entry) return null;

    const ageMs = Date.now() - entry.savedAt.getTime();
    if (ageMs > 30 * 60 * 1000) {
      this.userLocations.delete(chatId);
      return null;
    }

    return entry.coords;
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
        "Hubo un error verificando el estado. Intentá de nuevo más tarde."
      );
    }
  }
}
