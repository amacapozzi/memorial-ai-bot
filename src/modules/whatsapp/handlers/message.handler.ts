import type { IntentService, ReminderDetail } from "@modules/ai/intent/intent.service";
import type { TranscriptionService } from "@modules/ai/transcription/transcription.service";
import type { GmailAuthService } from "@modules/email/gmail/gmail-auth.service";
import type { UserService } from "@modules/email/user/user.service";
import type { ReminderService } from "@modules/reminders/reminder.service";
import type { RecurrenceType } from "@prisma-module/generated/client";
import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { WhatsAppClient } from "../client/whatsapp.client";
import type { MessageContent } from "../client/whatsapp.types";

const DAYS_OF_WEEK = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

export class MessageHandler {
  private readonly logger = createLogger("message-handler");

  constructor(
    private readonly whatsappClient: WhatsAppClient,
    private readonly transcriptionService: TranscriptionService,
    private readonly intentService: IntentService,
    private readonly reminderService: ReminderService,
    private readonly userService?: UserService,
    private readonly gmailAuthService?: GmailAuthService
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

        default:
          await this.whatsappClient.sendMessage(
            message.chatId,
            "No entendi bien. Puedo ayudarte con:\n" +
              "- Crear recordatorios: 'recuerdame manana a las 3 llamar a mama'\n" +
              "- Recordatorios recurrentes: 'recuerdame todos los dias a las 8 tomar la pastilla'\n" +
              "- Ver tareas: 'que tareas tengo'\n" +
              "- Cancelar: 'cancela la tarea 2'\n" +
              "- Cambiar hora: 'cambia la tarea 1 a las 5pm'\n" +
              "- Conectar email: 'conecta mi email'"
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

  private async handleCreateReminder(
    chatId: string,
    originalText: string,
    intent: {
      reminderDetails?: ReminderDetail[];
      missingDateTime?: boolean;
    }
  ): Promise<void> {
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
      const funMessage = await this.intentService.generateFunReminderMessage(detail.description);

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

      // Generate OAuth URL using userId (clean cuid, no special chars)
      const hostUrl = env().HOST_URL;
      const authUrl = `${hostUrl}/auth/gmail?userId=${user.id}`;

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

_Tu privacidad es importante: solo leo los emails, nunca envio nada._`
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

  private async handleEmailStatus(chatId: string): Promise<void> {
    if (!this.userService || !this.gmailAuthService) {
      await this.whatsappClient.sendMessage(
        chatId,
        "La funcion de email no esta disponible en este momento."
      );
      return;
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
