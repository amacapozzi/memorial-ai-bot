interface SubscriptionMessageData {
  planName: string;
  features: string[];
  expirationDate: Date;
  maxReminders: number | null;
  hasCalendarSync: boolean;
  hasEmailSync: boolean;
}

function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale === "en" ? "en-US" : "es-AR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

const messages = {
  es: (data: SubscriptionMessageData) => {
    const featuresLines = data.features.map((f) => `✅ ${f}`).join("\n");
    const reminders = data.maxReminders ? `${data.maxReminders}` : "Ilimitados";
    const calendar = data.hasCalendarSync ? "Sí" : "No";
    const email = data.hasEmailSync ? "Sí" : "No";

    return (
      `🎉 *¡Gracias por suscribirte a Memorial!*\n\n` +
      `Tu plan: *${data.planName}*\n` +
      `Vence: ${formatDate(data.expirationDate, "es")}\n\n` +
      `*Incluye:*\n` +
      `${featuresLines}\n` +
      `📅 Sincronización de calendario: ${calendar}\n` +
      `📧 Monitoreo de emails: ${email}\n` +
      `🔔 Recordatorios: ${reminders}\n\n` +
      `*Para aprovechar tu plan al máximo:*\n` +
      `• Conectá tu Google Calendar desde la web\n` +
      `• Configurá el monitoreo de emails\n` +
      `• Enviá un mensaje de voz o texto para crear tu primer recordatorio\n\n` +
      `¡Disfrutá Memorial! 🚀`
    );
  },

  en: (data: SubscriptionMessageData) => {
    const featuresLines = data.features.map((f) => `✅ ${f}`).join("\n");
    const reminders = data.maxReminders ? `${data.maxReminders}` : "Unlimited";
    const calendar = data.hasCalendarSync ? "Yes" : "No";
    const email = data.hasEmailSync ? "Yes" : "No";

    return (
      `🎉 *Thank you for subscribing to Memorial!*\n\n` +
      `Your plan: *${data.planName}*\n` +
      `Expires: ${formatDate(data.expirationDate, "en")}\n\n` +
      `*Includes:*\n` +
      `${featuresLines}\n` +
      `📅 Calendar sync: ${calendar}\n` +
      `📧 Email monitoring: ${email}\n` +
      `🔔 Reminders: ${reminders}\n\n` +
      `*To make the most of your plan:*\n` +
      `• Connect your Google Calendar from the web\n` +
      `• Set up email monitoring\n` +
      `• Send a voice or text message to create your first reminder\n\n` +
      `Enjoy Memorial! 🚀`
    );
  }
};

export function buildSubscriptionMessage(locale: string, data: SubscriptionMessageData): string {
  const builder = locale === "en" ? messages.en : messages.es;
  return builder(data);
}
