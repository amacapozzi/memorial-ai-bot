import type { GoogleCalendarService } from "@modules/calendar";
import type { Reminder, RecurrenceType } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { ReminderRepository, CreateReminderData } from "./reminder.repository";

export interface CreateReminderInput {
  originalText: string;
  reminderText: string;
  scheduledAt: Date;
  chatId: string;
  recurrence?: RecurrenceType;
  recurrenceDay?: number;
  recurrenceTime?: string;
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
      calendarEventId,
      recurrence: input.recurrence,
      recurrenceDay: input.recurrenceDay,
      recurrenceTime: input.recurrenceTime
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

  /**
   * Calculate next occurrence for a recurring reminder.
   * All time operations use Argentina timezone (UTC-3) to avoid server-timezone bugs.
   */
  calculateNextOccurrence(reminder: Reminder): Date {
    const now = new Date();
    const [hours, minutes] = (reminder.recurrenceTime || "09:00").split(":").map(Number);

    // Argentina is UTC-3. Shift UTC timestamp so getUTC* fields reflect Argentina local time.
    const ARG_OFFSET_MS = 3 * 60 * 60 * 1000;
    const argNow = new Date(now.getTime() - ARG_OFFSET_MS);

    switch (reminder.recurrence) {
      case "DAILY": {
        const argTarget = new Date(argNow);
        argTarget.setUTCHours(hours, minutes, 0, 0);
        let result = new Date(argTarget.getTime() + ARG_OFFSET_MS);
        if (result <= now) {
          argTarget.setUTCDate(argTarget.getUTCDate() + 1);
          result = new Date(argTarget.getTime() + ARG_OFFSET_MS);
        }
        return result;
      }

      case "WEEKLY": {
        const targetDay = reminder.recurrenceDay ?? 0;
        const argCurrentDay = argNow.getUTCDay();
        let daysUntilTarget = (targetDay - argCurrentDay + 7) % 7;
        if (daysUntilTarget === 0) {
          const argCurrentMins = argNow.getUTCHours() * 60 + argNow.getUTCMinutes();
          const targetMins = hours * 60 + minutes;
          if (targetMins <= argCurrentMins) daysUntilTarget = 7;
        }
        const argTarget = new Date(argNow);
        argTarget.setUTCDate(argTarget.getUTCDate() + daysUntilTarget);
        argTarget.setUTCHours(hours, minutes, 0, 0);
        return new Date(argTarget.getTime() + ARG_OFFSET_MS);
      }

      case "MONTHLY": {
        const targetDayOfMonth = reminder.recurrenceDay ?? 1;
        const argTarget = new Date(argNow);
        argTarget.setUTCDate(targetDayOfMonth);
        argTarget.setUTCHours(hours, minutes, 0, 0);
        let result = new Date(argTarget.getTime() + ARG_OFFSET_MS);
        if (result <= now) {
          argTarget.setUTCMonth(argTarget.getUTCMonth() + 1);
          result = new Date(argTarget.getTime() + ARG_OFFSET_MS);
        }
        return result;
      }

      default:
        throw new Error(`Unknown recurrence type: ${reminder.recurrence}`);
    }
  }

  /**
   * Reschedule a recurring reminder for its next occurrence
   */
  async rescheduleRecurringReminder(reminder: Reminder): Promise<Reminder> {
    if (reminder.recurrence === "NONE") {
      throw new Error("Cannot reschedule non-recurring reminder");
    }

    const nextDate = this.calculateNextOccurrence(reminder);

    this.logger.info(`Rescheduling recurring reminder ${reminder.id} to ${nextDate.toISOString()}`);

    // Create a new reminder for the next occurrence
    const newReminder = await this.repository.create({
      originalText: reminder.originalText,
      reminderText: reminder.reminderText,
      scheduledAt: nextDate,
      chatId: reminder.chatId,
      recurrence: reminder.recurrence,
      recurrenceDay: reminder.recurrenceDay ?? undefined,
      recurrenceTime: reminder.recurrenceTime ?? undefined
    });

    return newReminder;
  }
}
