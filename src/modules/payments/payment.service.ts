import type { RecurrenceType, ScheduledPayment } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { CreateScheduledPaymentData, ScheduledPaymentRepository } from "./payment.repository";

const logger = createLogger("payment-service");

export interface CreatePaymentScheduleInput {
  chatId: string;
  recipient: string;
  amount: number;
  description?: string;
  recurrence: RecurrenceType;
  recurrenceDay?: number;
  recurrenceTime?: string;
  totalPayments?: number;
  firstPaymentAt?: Date;
}

export class ScheduledPaymentService {
  constructor(private readonly repository: ScheduledPaymentRepository) {}

  async createSchedule(input: CreatePaymentScheduleInput): Promise<ScheduledPayment> {
    const nextPaymentAt = input.firstPaymentAt ?? this.calcFirstDate(input);

    const data: CreateScheduledPaymentData = {
      chatId: input.chatId,
      recipient: input.recipient,
      amount: input.amount,
      description: input.description,
      recurrence: input.recurrence,
      recurrenceDay: input.recurrenceDay,
      recurrenceTime: input.recurrenceTime,
      nextPaymentAt,
      totalPayments: input.totalPayments
    };

    const schedule = await this.repository.create(data);
    logger.info(`Created scheduled payment ${schedule.id} for ${input.recipient}`);
    return schedule;
  }

  async getPendingPayments(before: Date): Promise<ScheduledPayment[]> {
    return this.repository.findPendingBefore(before);
  }

  async getActiveSchedules(chatId: string): Promise<ScheduledPayment[]> {
    return this.repository.findByChat(chatId);
  }

  async cancelByIndex(chatId: string, index: number): Promise<ScheduledPayment | null> {
    const schedules = await this.repository.findByChat(chatId);
    const schedule = schedules[index - 1];
    if (!schedule) return null;
    return this.repository.cancel(schedule.id);
  }

  /**
   * Called after sending a payment notification.
   * Reschedules or marks as completed.
   */
  async processPayment(payment: ScheduledPayment): Promise<void> {
    const newPaidCount = payment.paidCount + 1;
    const isDone =
      payment.totalPayments !== null &&
      payment.totalPayments !== undefined &&
      newPaidCount >= payment.totalPayments;

    if (isDone || payment.recurrence === "NONE") {
      await this.repository.updateAfterPayment(payment.id, null, newPaidCount);
      logger.info(`Scheduled payment ${payment.id} completed after ${newPaidCount} payments`);
      return;
    }

    const nextDate = this.calcNextDate(payment);
    await this.repository.updateAfterPayment(payment.id, nextDate, newPaidCount);
    logger.info(`Scheduled payment ${payment.id} rescheduled to ${nextDate.toISOString()}`);
  }

  private calcFirstDate(input: CreatePaymentScheduleInput): Date {
    const [h, m] = (input.recurrenceTime ?? "09:00").split(":").map(Number);
    const now = new Date();

    if (input.recurrence === "DAILY") {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      if (d <= now) d.setDate(d.getDate() + 1);
      return d;
    }

    if (input.recurrence === "WEEKLY") {
      const dayTarget = input.recurrenceDay ?? 1;
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      const diff = (dayTarget - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d;
    }

    if (input.recurrence === "MONTHLY") {
      const dayOfMonth = input.recurrenceDay ?? 1;
      const d = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, h, m, 0);
      if (d <= now) d.setMonth(d.getMonth() + 1);
      return d;
    }

    // NONE — one-time payment 1 minute from now (fallback)
    return new Date(now.getTime() + 60_000);
  }

  private calcNextDate(payment: ScheduledPayment): Date {
    const [h, m] = (payment.recurrenceTime ?? "09:00").split(":").map(Number);
    const base = new Date(payment.nextPaymentAt);

    if (payment.recurrence === "DAILY") {
      base.setDate(base.getDate() + 1);
      base.setHours(h, m, 0, 0);
      return base;
    }

    if (payment.recurrence === "WEEKLY") {
      base.setDate(base.getDate() + 7);
      base.setHours(h, m, 0, 0);
      return base;
    }

    if (payment.recurrence === "MONTHLY") {
      base.setMonth(base.getMonth() + 1);
      base.setHours(h, m, 0, 0);
      return base;
    }

    return base;
  }
}
