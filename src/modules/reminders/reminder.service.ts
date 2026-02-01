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
   * Calculate next occurrence for a recurring reminder
   */
  calculateNextOccurrence(reminder: Reminder): Date {
    const now = new Date();
    let nextDate: Date;

    // Parse recurrence time (HH:MM format)
    const [hours, minutes] = (reminder.recurrenceTime || "09:00").split(":").map(Number);

    switch (reminder.recurrence) {
      case "DAILY":
        nextDate = new Date(now);
        nextDate.setHours(hours, minutes, 0, 0);
        // If time already passed today, schedule for tomorrow
        if (nextDate <= now) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        break;

      case "WEEKLY":
        nextDate = new Date(now);
        nextDate.setHours(hours, minutes, 0, 0);
        const targetDay = reminder.recurrenceDay ?? 0;
        const currentDay = nextDate.getDay();
        let daysUntilTarget = targetDay - currentDay;

        if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextDate <= now)) {
          daysUntilTarget += 7;
        }

        nextDate.setDate(nextDate.getDate() + daysUntilTarget);
        break;

      case "MONTHLY":
        nextDate = new Date(now);
        nextDate.setHours(hours, minutes, 0, 0);
        const targetDayOfMonth = reminder.recurrenceDay ?? 1;
        nextDate.setDate(targetDayOfMonth);

        // If the date already passed this month, go to next month
        if (nextDate <= now) {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }
        break;

      default:
        throw new Error(`Unknown recurrence type: ${reminder.recurrence}`);
    }

    return nextDate;
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
