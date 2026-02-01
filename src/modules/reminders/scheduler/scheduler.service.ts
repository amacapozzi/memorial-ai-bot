import type { WhatsAppClient } from "@modules/whatsapp";
import type { Reminder } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { ReminderService } from "../reminder.service";

export class SchedulerService {
  private intervalId: Timer | null = null;
  private readonly checkIntervalMs = 60_000; // Check every minute
  private readonly logger = createLogger("scheduler");
  private isRunning = false;

  constructor(
    private readonly reminderService: ReminderService,
    private readonly whatsappClient: WhatsAppClient
  ) {}

  start(): void {
    if (this.intervalId) {
      this.logger.warn("Scheduler already running");
      return;
    }

    this.logger.info(`Scheduler started (checking every ${this.checkIntervalMs / 1000}s)`);

    // Run immediately on start
    this.tick();

    // Then run on interval
    this.intervalId = setInterval(() => this.tick(), this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info("Scheduler stopped");
    }
  }

  private async tick(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug("Scheduler tick skipped (previous tick still running)");
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const pendingReminders = await this.reminderService.getPendingReminders(now);

      if (pendingReminders.length > 0) {
        this.logger.info(`Found ${pendingReminders.length} pending reminder(s)`);
      }

      for (const reminder of pendingReminders) {
        await this.sendReminder(reminder);
      }
    } catch (error) {
      this.logger.error("Error in scheduler tick", error);
    } finally {
      this.isRunning = false;
    }
  }

  private async sendReminder(reminder: Reminder): Promise<void> {
    this.logger.info(`Sending reminder ${reminder.id} to ${reminder.chatId}`);

    try {
      await this.whatsappClient.sendMessage(reminder.chatId, reminder.reminderText);
      await this.reminderService.markAsSent(reminder.id);
      this.logger.info(`Reminder ${reminder.id} sent successfully`);

      // If this is a recurring reminder, schedule the next occurrence
      if (reminder.recurrence !== "NONE") {
        try {
          const nextReminder = await this.reminderService.rescheduleRecurringReminder(reminder);
          this.logger.info(
            `Recurring reminder rescheduled: ${nextReminder.id} for ${nextReminder.scheduledAt.toISOString()}`
          );
        } catch (error) {
          this.logger.error(`Failed to reschedule recurring reminder ${reminder.id}`, error);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send reminder ${reminder.id}`, error);
      await this.reminderService.markAsFailed(reminder.id);
    }
  }
}
