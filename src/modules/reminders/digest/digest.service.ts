import type { WhatsAppClient } from "@modules/whatsapp";
import type { Reminder } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { UserRepository } from "../../email/user/user.repository";
import type { ReminderRepository } from "../reminder.repository";

const CLOCK_ICONS: Record<number, string> = {
  0: "🕛",
  1: "🕐",
  2: "🕑",
  3: "🕒",
  4: "🕓",
  5: "🕔",
  6: "🕕",
  7: "🕖",
  8: "🕗",
  9: "🕘",
  10: "🕙",
  11: "🕚",
  12: "🕛",
  13: "🕐",
  14: "🕑",
  15: "🕒",
  16: "🕓",
  17: "🕔",
  18: "🕕",
  19: "🕖",
  20: "🕗",
  21: "🕘",
  22: "🕙",
  23: "🕚"
};

export class DigestService {
  private readonly logger = createLogger("digest");
  private readonly sentToday = new Map<string, string>();

  constructor(
    private readonly reminderRepository: ReminderRepository,
    private readonly userRepository: UserRepository,
    private readonly whatsappClient: WhatsAppClient
  ) {}

  async sendDailyDigests(currentHourBsAs: number): Promise<void> {
    const users = await this.userRepository.findUsersForDigest(currentHourBsAs);

    if (users.length === 0) return;

    const now = new Date();
    const { startOfDay, endOfDay } = this.getTodayRange(now);
    const dateKey = this.getDateKey(now);

    for (const user of users) {
      const chatId = user.chatId!;
      const dedupKey = `${chatId}:${dateKey}`;

      if (this.sentToday.get(chatId) === dateKey) {
        this.logger.debug(`Digest already sent to ${chatId} today, skipping`);
        continue;
      }

      try {
        const reminders = await this.reminderRepository.findTodayByChat(
          chatId,
          startOfDay,
          endOfDay
        );
        const message = this.formatDigest(reminders, now);

        await this.whatsappClient.sendMessage(chatId, message);
        this.sentToday.set(chatId, dateKey);
        this.logger.info(`Daily digest sent to ${chatId} (${reminders.length} reminders)`);
      } catch (error) {
        this.logger.error(`Failed to send digest to ${chatId}`, error);
      }

      // Silence unused variable warning
      void dedupKey;
    }
  }

  private formatDigest(reminders: Reminder[], now: Date): string {
    const dateStr = now.toLocaleDateString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      weekday: "long",
      day: "numeric",
      month: "long"
    });

    if (reminders.length === 0) {
      return `🌅 *Buenos días!*\n\nNo tenés recordatorios para hoy. ¡Que tengas un excelente día! ✨`;
    }

    let message = `🌅 *Buenos días!*\n\nTus recordatorios para hoy, ${dateStr}:\n\n`;

    reminders.forEach((reminder, index) => {
      const hour = reminder.scheduledAt.getUTCHours();
      // Convert UTC to Buenos Aires (UTC-3)
      const bsAsHour = (hour - 3 + 24) % 24;
      const clockIcon = CLOCK_ICONS[bsAsHour] ?? "🕐";

      const timeStr = reminder.scheduledAt.toLocaleTimeString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        hour: "2-digit",
        minute: "2-digit"
      });

      message += `${index + 1}. ${clockIcon} ${timeStr} - ${reminder.reminderText}\n`;
    });

    const count = reminders.length;
    message += `\nTenés ${count} recordatorio${count > 1 ? "s" : ""} hoy. ¡A darle con todo! 💪`;

    return message;
  }

  private getTodayRange(now: Date): { startOfDay: Date; endOfDay: Date } {
    // Get today's date in Buenos Aires time (UTC-3)
    const bsAsOffset = -3 * 60 * 60 * 1000;
    const bsAsNow = new Date(now.getTime() + bsAsOffset);

    const year = bsAsNow.getUTCFullYear();
    const month = bsAsNow.getUTCMonth();
    const day = bsAsNow.getUTCDate();

    // Start of day in BsAs = midnight BsAs = 03:00 UTC
    const startOfDay = new Date(Date.UTC(year, month, day, 3, 0, 0, 0));
    // End of day in BsAs = 23:59:59 BsAs = 02:59:59 next day UTC
    const endOfDay = new Date(Date.UTC(year, month, day + 1, 2, 59, 59, 999));

    return { startOfDay, endOfDay };
  }

  private getDateKey(now: Date): string {
    const bsAsOffset = -3 * 60 * 60 * 1000;
    const bsAsNow = new Date(now.getTime() + bsAsOffset);
    const year = bsAsNow.getUTCFullYear();
    const month = String(bsAsNow.getUTCMonth() + 1).padStart(2, "0");
    const day = String(bsAsNow.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
