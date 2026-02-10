import { Elysia } from "elysia";

import type { WhatsAppClient } from "@modules/whatsapp";
import type { PrismaClient } from "@prisma-module/generated/client";
import { env } from "@shared/env/env";
import { createLogger } from "@shared/logger/logger";

import { buildSubscriptionMessage } from "./notification.messages";

const logger = createLogger("notification-module");

export function createNotificationModule(whatsappClient: WhatsAppClient, prisma: PrismaClient) {
  const { WEBHOOK_SECRET } = env();

  return new Elysia({ prefix: "/webhook" }).post(
    "/subscription-activated",
    async ({ body, headers }) => {
      const authHeader = headers["x-webhook-secret"];
      if (authHeader !== WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }

      const { userId } = body as { userId: string };

      if (!userId) {
        return { ok: false, error: "Missing userId" };
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { chatId: true, locale: true }
      });

      if (!user) {
        return { ok: false, error: "User not found" };
      }

      if (!user.chatId) {
        logger.info(`User ${userId} has no chatId, skipping notification`);
        return { ok: true, skipped: true };
      }

      const subscription = await prisma.subscription.findUnique({
        where: { userId },
        include: { plan: true }
      });

      if (!subscription) {
        return { ok: false, error: "Subscription not found" };
      }

      const features = Array.isArray(subscription.plan.features)
        ? (subscription.plan.features as string[])
        : [];

      const message = buildSubscriptionMessage(user.locale, {
        planName: subscription.plan.name,
        features,
        expirationDate: subscription.currentPeriodEnd,
        maxReminders: subscription.plan.maxReminders,
        hasCalendarSync: subscription.plan.hasCalendarSync,
        hasEmailSync: subscription.plan.hasEmailSync
      });

      try {
        await whatsappClient.sendMessage(user.chatId, message);
        logger.info(`Subscription notification sent to ${user.chatId}`);
        return { ok: true };
      } catch (error) {
        logger.error("Failed to send subscription notification", error);
        return { ok: false, error: "Failed to send WhatsApp message" };
      }
    }
  );
}
