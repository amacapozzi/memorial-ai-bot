import type { IntentService } from "@modules/ai/intent/intent.service";
import type { TranscriptionService } from "@modules/ai/transcription/transcription.service";
import type { GmailAuthService } from "@modules/email/gmail/gmail-auth.service";
import type { UserService } from "@modules/email/user/user.service";
import type { ReminderService } from "@modules/reminders/reminder.service";
import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import type { WhatsAppClient } from "../client/whatsapp.client";
import type { MessageContent } from "../client/whatsapp.types";

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
    intent: { reminderDetails?: Array<{ description: string; dateTime: Date }> }
  ): Promise<void> {
    if (!intent.reminderDetails || intent.reminderDetails.length === 0) {
      await this.whatsappClient.sendMessage(
        chatId,
        "No pude entender los detalles del recordatorio."
      );
      return;
    }

    const createdReminders: Array<{ description: string; dateTime: Date }> = [];

    for (const detail of intent.reminderDetails) {
      const funMessage = await this.intentService.generateFunReminderMessage(detail.description);

      const reminder = await this.reminderService.createReminder({
        originalText,
        reminderText: funMessage,
        scheduledAt: detail.dateTime,
        chatId
      });

      createdReminders.push({
        description: detail.description,
        dateTime: detail.dateTime
      });

      this.logger.info(`Reminder created: ${reminder.id}`);
    }

    // Build confirmation message
    if (createdReminders.length === 1) {
      const r = createdReminders[0];
      const confirmationTime = r.dateTime.toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit"
      });
      await this.whatsappClient.sendMessage(
        chatId,
        `Listo! Te recordare: "${r.description}" el ${confirmationTime}`
      );
    } else {
      let message = `Listo! Te cree ${createdReminders.length} recordatorios:\n\n`;
      createdReminders.forEach((r, index) => {
        const timeStr = r.dateTime.toLocaleString("es-AR", {
          timeZone: "America/Argentina/Buenos_Aires",
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        });
        message += `${index + 1}. "${r.description}" - ${timeStr}\n`;
      });
      await this.whatsappClient.sendMessage(chatId, message);
    }
  }

  private async handleListTasks(chatId: string): Promise<void> {
    const reminders = await this.reminderService.getPendingRemindersOrdered(chatId);

    if (reminders.length === 0) {
      await this.whatsappClient.sendMessage(chatId, "No tenes tareas pendientes! 🎉");
      return;
    }

    let response = "📋 *Tus tareas pendientes:*\n\n";

    reminders.forEach((reminder, index) => {
      const dateStr = reminder.scheduledAt.toLocaleString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
      response += `*${index + 1}.* ${reminder.reminderText}\n   📅 ${dateStr}\n\n`;
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
    await this.reminderService.cancelReminder(reminder.id);

    await this.whatsappClient.sendMessage(
      chatId,
      `Tarea ${taskNumber} cancelada: "${reminder.reminderText}" ❌`
    );

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

      // Generate OAuth URL
      const baseUrl = env().GMAIL_REDIRECT_URI.replace("/auth/gmail/callback", "");
      const authUrl = `${baseUrl}/auth/gmail?chatId=${encodeURIComponent(chatId)}`;

      await this.whatsappClient.sendMessage(
        chatId,
        "📧 *Conectar tu Gmail*\n\n" +
          "Para vincular tu email, hace click en este link:\n\n" +
          `${authUrl}\n\n` +
          "Una vez que autorices, voy a poder avisarte de:\n" +
          "- 📦 Entregas de compras\n" +
          "- 📅 Turnos y citas\n" +
          "- 🗓️ Reuniones\n" +
          "- ✈️ Vuelos\n\n" +
          "_Tu privacidad es importante: solo leo los emails, nunca envio nada._"
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
