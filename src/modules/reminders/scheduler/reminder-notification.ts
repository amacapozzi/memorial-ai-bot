/**
 * Generates varied, fun notification messages for reminders.
 * Each call returns a different template so recurring reminders
 * never feel repetitive.
 */

type Template = (description: string) => string;

const TEMPLATES: Template[] = [
  (d) => `⏰ Ey! No te olvidés: *${d}*`,
  (d) => `🔔 Che, acordate que tenés que: *${d}*`,
  (d) => `📌 *Recordatorio:*\n${d}`,
  (d) => `🎯 Es la hora de: *${d}*`,
  (d) => `💬 Psst! No se te pase: *${d}*`,
  (d) => `⌚ *${cap(d)}* — ¡es ahora!`,
  (d) => `🚀 Anotaste esto y llegó el momento:\n*${d}*`,
  (d) => `💡 Tenés pendiente: *${d}*`,
  (d) => `🎉 Opa! Esto no se puede olvidar: *${d}*`,
  (d) => `⚡ Pa! Acordate:\n*${d}*`,
  (d) => `📢 *${cap(d)}* ← lo anotaste vos 😏`,
  (d) => `🔮 Tu vos del pasado te manda saludos:\n*${d}*`,
  (d) => `👋 Ey, yo de antes: *no te olvidés de ${d}*`,
  (d) => `🗓️ Agendaste esto y ya llegó:\n*${d}*`,
  (d) => `💭 Sí, sí... *${d}*. Ese recordatorio que pusiste.`,
  (d) => `🔔 Momento! Tenías algo pendiente:\n*${d}*`,
  (d) => `😤 Dale, que podés: *${d}*`,
  (d) => `🪄 ¡Pum! Te recuerdo: *${d}*`
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
    /^[⏰🔔📌🎯💬🚀💡🎉🗓️⚡📢🔮👋💭😤🪄🔮]/.test(text) ||
    /^(Te |Ey!|Che!|Opa!|Hola!|Pa!|Psst|Acordate)/i.test(text)
  );
}
