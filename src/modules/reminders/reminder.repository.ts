import type {
  PrismaClient,
  Reminder,
  ReminderStatus,
  RecurrenceType
} from "@prisma-module/generated/client";

export interface CreateReminderData {
  originalText: string;
  reminderText: string;
  scheduledAt: Date;
  chatId: string;
  calendarEventId?: string;
  recurrence?: RecurrenceType;
  recurrenceDay?: number;
  recurrenceTime?: string;
}

export class ReminderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async findUserId(chatId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { chatId },
      select: { id: true }
    });
    return user?.id;
  }

  async create(data: CreateReminderData): Promise<Reminder> {
    const userId = await this.findUserId(data.chatId);

    return this.prisma.reminder.create({
      data: {
        originalText: data.originalText,
        reminderText: data.reminderText,
        scheduledAt: data.scheduledAt,
        chatId: data.chatId,
        userId, // Include userId for web compatibility
        calendarEventId: data.calendarEventId,
        recurrence: data.recurrence || "NONE",
        recurrenceDay: data.recurrenceDay,
        recurrenceTime: data.recurrenceTime
      }
    });
  }

  async findById(id: string): Promise<Reminder | null> {
    return this.prisma.reminder.findUnique({ where: { id } });
  }

  async findPendingBefore(beforeTime: Date): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: beforeTime }
      },
      orderBy: { scheduledAt: "asc" }
    });
  }

  async updateStatus(id: string, status: ReminderStatus, sentAt?: Date): Promise<Reminder> {
    return this.prisma.reminder.update({
      where: { id },
      data: {
        status,
        sentAt
      }
    });
  }

  async findByChat(chatId: string, limit: number = 10): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  async findUpcoming(chatId: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        chatId,
        status: "PENDING",
        scheduledAt: { gt: new Date() }
      },
      orderBy: { scheduledAt: "asc" }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.reminder.delete({ where: { id } });
  }

  async updateScheduledAt(id: string, scheduledAt: Date): Promise<Reminder> {
    return this.prisma.reminder.update({
      where: { id },
      data: { scheduledAt }
    });
  }

  async findPendingByChatOrdered(chatId: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        chatId,
        status: "PENDING"
      },
      orderBy: { scheduledAt: "asc" }
    });
  }

  async findRecurringByChat(chatId: string): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        chatId,
        recurrence: { not: "NONE" },
        status: { in: ["PENDING", "SENT"] }
      },
      orderBy: { scheduledAt: "asc" }
    });
  }

  async findTodayByChat(chatId: string, startOfDay: Date, endOfDay: Date): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: {
        chatId,
        status: "PENDING",
        scheduledAt: { gte: startOfDay, lte: endOfDay }
      },
      orderBy: { scheduledAt: "asc" }
    });
  }

  /**
   * Count reminders for a user (by chatId) - useful for subscription limits
   */
  async countByChat(chatId: string): Promise<number> {
    return this.prisma.reminder.count({
      where: { chatId }
    });
  }

  /**
   * Get user's subscription plan limits (if any)
   */
  async getUserPlanLimits(chatId: string): Promise<{ maxReminders: number | null } | null> {
    const user = await this.prisma.user.findUnique({
      where: { chatId },
      include: {
        subscription: {
          include: { plan: true }
        }
      }
    });

    if (!user?.subscription?.plan) {
      return null;
    }

    return {
      maxReminders: user.subscription.plan.maxReminders
    };
  }

  /**
   * Check if user can create more reminders based on their plan
   */
  async canCreateReminder(chatId: string): Promise<boolean> {
    const limits = await this.getUserPlanLimits(chatId);

    // Plan explicitly set to null = unlimited reminders (paid tier)
    if (limits?.maxReminders === null) {
      return true;
    }

    // No subscription = free tier cap of 5
    const maxReminders = limits?.maxReminders ?? 5;
    const currentCount = await this.countByChat(chatId);
    return currentCount < maxReminders;
  }
}
