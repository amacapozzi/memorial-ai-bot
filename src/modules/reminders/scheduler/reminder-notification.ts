/**
 * Generates varied notification messages for reminders.
 * Each call returns a different template so recurring reminders
 * never feel repetitive.
 */

type Template = (description: string) => string;

const TEMPLATES: Template[] = [
  (d) => `⏰ *Recordatorio:* ${d}`,
  (d) => `🔔 Es momento de: *${d}*`,
  (d) => `📌 *Recordatorio programado:*\n${d}`,
  (d) => `🎯 Ha llegado la hora de: *${d}*`,
  (d) => `💬 Tiene pendiente: *${d}*`,
  (d) => `⌚ *${cap(d)}* — es ahora`,
  (d) => `🗓️ Recordatorio agendado:\n*${d}*`,
  (d) => `💡 Pendiente: *${d}*`,
  (d) => `📢 *${cap(d)}* — recordatorio activo`,
  (d) => `🔔 Aviso: tiene un recordatorio pendiente:\n*${d}*`,
  (d) => `📅 Llegó el momento para: *${d}*`,
  (d) => `✅ *Recordatorio:*\n${d}`
];

function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Returns a varied notification message.
 * If `text` looks like a plain description (user-created reminder),
 * applies a random template. Otherwise returns the text as-is
 * (email-generated reminders already have a full message).
 */
export function buildReminderNotification(text: string): string {
  if (isFullMessage(text)) {
    return text;
  }
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return template(text);
}

/**
 * Heuristic: a "full message" already has an opener/emoji and shouldn't be re-wrapped.
 * A plain description is just a noun phrase like "llamar a mamá" or "tomar la pastilla".
 */
function isFullMessage(text: string): boolean {
  return (
    /^[⏰🔔📌🎯💬🚀💡🎉🗓️⚡📢🔮👋💭😤🪄✅]/.test(text) ||
    /^(Recordatorio|Aviso|Es momento|Ha llegado|Pendiente|Llegó el momento)/i.test(text)
  );
}
