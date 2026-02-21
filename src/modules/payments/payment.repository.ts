import type {
  PrismaClient,
  RecurrenceType,
  ScheduledPayment
} from "@prisma-module/generated/client";

export interface CreateScheduledPaymentData {
  chatId: string;
  recipient: string;
  amount: number;
  description?: string;
  recurrence: RecurrenceType;
  recurrenceDay?: number;
  recurrenceTime?: string;
  nextPaymentAt: Date;
  totalPayments?: number;
}

export class ScheduledPaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateScheduledPaymentData): Promise<ScheduledPayment> {
    return this.prisma.scheduledPayment.create({
      data: {
        chatId: data.chatId,
        recipient: data.recipient,
        amount: data.amount,
        description: data.description,
        recurrence: data.recurrence,
        recurrenceDay: data.recurrenceDay,
        recurrenceTime: data.recurrenceTime,
        nextPaymentAt: data.nextPaymentAt,
        totalPayments: data.totalPayments
      }
    });
  }

  async findPendingBefore(beforeTime: Date): Promise<ScheduledPayment[]> {
    return this.prisma.scheduledPayment.findMany({
      where: {
        status: "ACTIVE",
        nextPaymentAt: { lte: beforeTime }
      },
      orderBy: { nextPaymentAt: "asc" }
    });
  }

  async findByChat(chatId: string): Promise<ScheduledPayment[]> {
    return this.prisma.scheduledPayment.findMany({
      where: { chatId, status: "ACTIVE" },
      orderBy: { nextPaymentAt: "asc" }
    });
  }

  async cancel(id: string): Promise<ScheduledPayment> {
    return this.prisma.scheduledPayment.update({
      where: { id },
      data: { status: "CANCELLED" }
    });
  }

  async updateAfterPayment(
    id: string,
    nextPaymentAt: Date | null,
    paidCount: number
  ): Promise<ScheduledPayment> {
    if (nextPaymentAt === null) {
      return this.prisma.scheduledPayment.update({
        where: { id },
        data: { paidCount, status: "COMPLETED" }
      });
    }
    return this.prisma.scheduledPayment.update({
      where: { id },
      data: { paidCount, nextPaymentAt }
    });
  }
}
