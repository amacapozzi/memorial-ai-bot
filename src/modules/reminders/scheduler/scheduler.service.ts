import type { WhatsAppClient } from "@modules/whatsapp";
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
        await this.sendReminder(reminder.id, reminder.chatId, reminder.reminderText);
      }
    } catch (error) {
      this.logger.error("Error in scheduler tick", error);
    } finally {
      this.isRunning = false;
    }
  }

  private async sendReminder(id: string, chatId: string, message: string): Promise<void> {
    this.logger.info(`Sending reminder ${id} to ${chatId}`);

    try {
      await this.whatsappClient.sendMessage(chatId, message);
      await this.reminderService.markAsSent(id);
      this.logger.info(`Reminder ${id} sent successfully`);
    } catch (error) {
      this.logger.error(`Failed to send reminder ${id}`, error);
      await this.reminderService.markAsFailed(id);
    }
  }
}
