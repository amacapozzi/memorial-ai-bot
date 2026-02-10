import { Elysia } from "elysia";

import type { WhatsAppClient } from "@modules/whatsapp";
import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

const logger = createLogger("linking-module");

interface GeoLocation {
  city?: string;
  regionName?: string;
  country?: string;
}

async function resolveLocation(ip: string): Promise<string> {
  try {
    // Skip geolocation for localhost/private IPs
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
      return "Red local";
    }

    const response = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`);
    if (!response.ok) return "Desconocida";

    const data = (await response.json()) as GeoLocation;
    const parts = [data.city, data.regionName, data.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "Desconocida";
  } catch {
    return "Desconocida";
  }
}

export function createLinkingModule(whatsappClient: WhatsAppClient) {
  const { WEBHOOK_SECRET } = env();

  return new Elysia({ prefix: "/webhook" }).post("/linked", async ({ body, headers }) => {
    // Validate shared secret
    const authHeader = headers["x-webhook-secret"];
    if (authHeader !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { chatId, username, ip } = body as {
      chatId: string;
      username: string;
      ip: string;
    };

    if (!chatId || !username) {
      return { ok: false, error: "Missing chatId or username" };
    }

    const location = await resolveLocation(ip || "unknown");

    const message =
      `✅ *Cuenta vinculada exitosamente*\n\n` +
      `Tu WhatsApp se ha vinculado con la cuenta:\n\n` +
      `👤 *Usuario:* ${username}\n` +
      `🌐 *IP:* ${ip || "Desconocida"}\n` +
      `📍 *Ubicación:* ${location}\n\n` +
      `Si no fuiste tú, desvincula tu cuenta desde la web inmediatamente.`;

    try {
      await whatsappClient.sendMessage(chatId, message);
      logger.info(`Linking notification sent to ${chatId} (user: ${username})`);
      return { ok: true };
    } catch (error) {
      logger.error("Failed to send linking notification", error);
      return { ok: false, error: "Failed to send WhatsApp message" };
    }
  });
}
