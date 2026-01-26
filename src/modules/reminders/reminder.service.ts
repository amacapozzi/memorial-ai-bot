import type { GoogleCalendarService } from "@modules/calendar";
import type { Reminder } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { ReminderRepository, CreateReminderData } from "./reminder.repository";
export interface CreateReminderInput {
  originalText: string;
  reminderText: string;
  scheduledAt: Date;
  chatId: string;
}

export class ReminderService {
  private readonly logger = createLogger("reminder");

  constructor(
    private readonly repository: ReminderRepository,
    private readonly calendarService: GoogleCalendarService | null
  ) {}

  async createReminder(input: CreateReminderInput): Promise<Reminder> {
    this.logger.info(`Creating reminder for ${input.scheduledAt.toISOString()}`);

    let calendarEventId: string | undefined;

    // Try to create calendar event if calendar service is available
    if (this.calendarService) {
      try {
        calendarEventId = await this.calendarService.createEvent({
          summary: `Recordatorio: ${input.reminderText.substring(0, 50)}`,
          description: input.originalText,
          startTime: input.scheduledAt
        });
        this.logger.info(`Calendar event created: ${calendarEventId}`);
      } catch (error) {
        this.logger.warn("Failed to create calendar event, continuing without it", error);
      }
    }

    const data: CreateReminderData = {
      originalText: input.originalText,
      reminderText: input.reminderText,
      scheduledAt: input.scheduledAt,
      chatId: input.chatId,
      calendarEventId
    };

    const reminder = await this.repository.create(data);
    this.logger.info(`Reminder created: ${reminder.id}`);

    return reminder;
  }

  async markAsSent(id: string): Promise<void> {
    await this.repository.updateStatus(id, "SENT", new Date());
    this.logger.debug(`Reminder ${id} marked as sent`);
  }

  async markAsFailed(id: string): Promise<void> {
    await this.repository.updateStatus(id, "FAILED");
    this.logger.warn(`Reminder ${id} marked as failed`);
  }

  async cancelReminder(id: string): Promise<void> {
    const reminder = await this.repository.findById(id);

    if (!reminder) {
      throw new Error(`Reminder ${id} not found`);
    }

    // Delete calendar event if exists
    if (reminder.calendarEventId && this.calendarService) {
      try {
        await this.calendarService.deleteEvent(reminder.calendarEventId);
      } catch (error) {
        this.logger.warn("Failed to delete calendar event", error);
      }
    }

    await this.repository.updateStatus(id, "CANCELLED");
    this.logger.info(`Reminder ${id} cancelled`);
  }

  async getPendingReminders(beforeTime: Date): Promise<Reminder[]> {
    return this.repository.findPendingBefore(beforeTime);
  }

  async getUpcomingReminders(chatId: string): Promise<Reminder[]> {
    return this.repository.findUpcoming(chatId);
  }

  async getPendingRemindersOrdered(chatId: string): Promise<Reminder[]> {
    return this.repository.findPendingByChatOrdered(chatId);
  }

  async modifyReminderTime(id: string, newScheduledAt: Date): Promise<Reminder> {
    const reminder = await this.repository.findById(id);

    if (!reminder) {
      throw new Error(`Reminder ${id} not found`);
    }

    // Update calendar event if exists
    if (reminder.calendarEventId && this.calendarService) {
      try {
        await this.calendarService.updateEvent(reminder.calendarEventId, {
          startTime: newScheduledAt
        });
      } catch (error) {
        this.logger.warn("Failed to update calendar event", error);
      }
    }

    const updated = await this.repository.updateScheduledAt(id, newScheduledAt);
    this.logger.info(`Reminder ${id} rescheduled to ${newScheduledAt.toISOString()}`);

    return updated;
  }
}
