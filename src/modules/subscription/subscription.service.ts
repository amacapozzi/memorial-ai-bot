import type { SubscriptionRepository, UserSubscriptionInfo } from "./subscription.repository";

export type AccessResult =
  | { allowed: true; info: UserSubscriptionInfo }
  | { allowed: false; reason: string; message: string };

export class SubscriptionService {
  constructor(private readonly subscriptionRepository: SubscriptionRepository) {}

  async checkBotAccess(chatId: string): Promise<AccessResult> {
    const info = await this.subscriptionRepository.getUserSubscriptionInfo(chatId);

    if (!info.hasLinkedAccount) {
      return {
        allowed: false,
        reason: "no_linked_account",
        message:
          "Para usar el bot, primero necesitas vincular tu cuenta.\n\n" +
          "1. Registrate en la web\n" +
          "2. Escribi /connect aca para vincular tu WhatsApp\n\n" +
          "Si ya tenes cuenta, escribi /connect para vincularla."
      };
    }

    if (!info.hasActiveSubscription) {
      return {
        allowed: false,
        reason: "no_active_subscription",
        message:
          "No tenes una suscripcion activa.\n\n" +
          "Ingresa a la web para elegir un plan y empezar a usar el bot."
      };
    }

    return { allowed: true, info };
  }

  async checkCanCreateReminder(chatId: string): Promise<AccessResult> {
    const access = await this.checkBotAccess(chatId);
    if (!access.allowed) return access;

    const { info } = access;
    if (info.maxReminders !== null && info.currentReminderCount >= info.maxReminders) {
      return {
        allowed: false,
        reason: "reminder_limit_reached",
        message:
          `Llegaste al limite de ${info.maxReminders} recordatorios de tu plan ${info.planName}.\n\n` +
          "Cancela algun recordatorio o mejora tu plan para crear mas."
      };
    }

    return access;
  }

  async checkEmailReplyAccess(chatId: string): Promise<AccessResult> {
    const access = await this.checkBotAccess(chatId);
    if (!access.allowed) return access;

    const { info } = access;
    if (!info.hasEmailReply) {
      return {
        allowed: false,
        reason: "email_reply_not_included",
        message:
          "Tu plan no incluye respuesta de emails.\n\n" +
          "Mejora tu plan para responder emails desde WhatsApp."
      };
    }

    return access;
  }

  async checkEmailAccess(chatId: string): Promise<AccessResult> {
    const access = await this.checkBotAccess(chatId);
    if (!access.allowed) return access;

    const { info } = access;
    if (!info.hasEmailSync) {
      return {
        allowed: false,
        reason: "email_not_included",
        message:
          `Tu plan ${info.planName} no incluye integracion con email.\n\n` +
          "Mejora a Pro para conectar tu Gmail y recibir notificaciones."
      };
    }

    return access;
  }
}
