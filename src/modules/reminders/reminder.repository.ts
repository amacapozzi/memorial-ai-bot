import type { PrismaClient, Reminder, ReminderStatus } from "@prisma-module/generated/client";

export interface CreateReminderData {
  originalText: string;
  reminderText: string;
  scheduledAt: Date;
  chatId: string;
  calendarEventId?: string;
}

export class ReminderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateReminderData): Promise<Reminder> {
    return this.prisma.reminder.create({
      data: {
        originalText: data.originalText,
        reminderText: data.reminderText,
        scheduledAt: data.scheduledAt,
        chatId: data.chatId,
        calendarEventId: data.calendarEventId
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
}
