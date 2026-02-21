import type { ExpenseSummaryService } from "@modules/expenses/summary/expense-summary.service";
import type { ScheduledPaymentService } from "@modules/payments/payment.service";
import type { WhatsAppClient } from "@modules/whatsapp";
import type { Reminder, ScheduledPayment } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { DigestService } from "../digest/digest.service";
import type { ReminderService } from "../reminder.service";
import { buildReminderNotification } from "./reminder-notification";

export class SchedulerService {
  private intervalId: Timer | null = null;
  private readonly checkIntervalMs = 60_000; // Check every minute
  private readonly logger = createLogger("scheduler");
  private isRunning = false;

  constructor(
    private readonly reminderService: ReminderService,
    private readonly whatsappClient: WhatsAppClient,
    private readonly digestService?: DigestService,
    private readonly expenseSummaryService?: ExpenseSummaryService,
    private readonly scheduledPaymentService?: ScheduledPaymentService
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

      const nowBsAs = new Date(
        now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })
      );
      const hourBsAs = nowBsAs.getHours();
      const dayOfWeek = nowBsAs.getDay(); // 0=Sun, 1=Mon
      const dayOfMonth = nowBsAs.getDate();

      // Send daily digests
      if (this.digestService) {
        await this.digestService.sendDailyDigests(hourBsAs);
      }

      // Weekly expense summary (Monday at digest hour 8)
      if (this.expenseSummaryService && dayOfWeek === 1 && hourBsAs === 8) {
        await this.expenseSummaryService.sendWeeklySummaries().catch((error) => {
          this.logger.error("Error sending weekly expense summaries", error);
        });
      }

      // Monthly expense summary (1st of month at digest hour 8)
      if (this.expenseSummaryService && dayOfMonth === 1 && hourBsAs === 8) {
        await this.expenseSummaryService.sendMonthlySummaries().catch((error) => {
          this.logger.error("Error sending monthly expense summaries", error);
        });
      }

      // Process scheduled payments
      if (this.scheduledPaymentService) {
        const pendingPayments = await this.scheduledPaymentService.getPendingPayments(now);
        if (pendingPayments.length > 0) {
          this.logger.info(`Found ${pendingPayments.length} pending scheduled payment(s)`);
        }
        for (const payment of pendingPayments) {
          await this.sendPaymentReminder(payment);
        }
      }
    } catch (error) {
      this.logger.error("Error in scheduler tick", error);
    } finally {
      this.isRunning = false;
    }
  }

  private async sendPaymentReminder(payment: ScheduledPayment): Promise<void> {
    this.logger.info(`Sending payment reminder ${payment.id} to ${payment.chatId}`);

    try {
      const amount = Number(payment.amount);
      const amountStr = amount.toLocaleString("es-AR", { minimumFractionDigits: 2 });

      // Build MP deep link
      const isAlias = !/^\d{22}$/.test(payment.recipient);
      const mpParam = isAlias ? `alias=${payment.recipient}` : `cbu=${payment.recipient}`;
      const mpLink = `https://www.mercadopago.com.ar/money-transfer/send?${mpParam}&amount=${amount}`;

      let message = `💸 *Recordatorio de pago programado*\n\n`;
      message += `💰 *Monto:* $${amountStr}\n`;
      message += `👤 *Destinatario:* ${payment.recipient}\n`;
      if (payment.description) message += `📝 *Descripción:* ${payment.description}\n`;

      if (payment.totalPayments) {
        const paymentNum = payment.paidCount + 1;
        message += `📊 Pago ${paymentNum} de ${payment.totalPayments}\n`;
      }

      message += `\n🔗 *Pagá con Mercado Pago:*\n${mpLink}\n\n`;
      message += `_Para cancelar: "cancela el pago recurrente 1"_`;

      await this.whatsappClient.sendMessage(payment.chatId, message);
      await this.scheduledPaymentService!.processPayment(payment);

      this.logger.info(`Payment reminder ${payment.id} sent successfully`);
    } catch (error) {
      this.logger.error(`Failed to send payment reminder ${payment.id}`, error);
    }
  }

  private async sendReminder(reminder: Reminder): Promise<void> {
    this.logger.info(`Sending reminder ${reminder.id} to ${reminder.chatId}`);

    try {
      const message = buildReminderNotification(reminder.reminderText);
      await this.whatsappClient.sendMessage(reminder.chatId, message);
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
