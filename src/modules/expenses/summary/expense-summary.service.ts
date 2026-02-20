import type { WhatsAppClient } from "@modules/whatsapp/client/whatsapp.client";
import { createLogger } from "@shared/logger/logger";

import type { FinancialAdviceService } from "../advice/financial-advice.service";
import type { ExpenseRepository } from "../expense.repository";
import type { ExpenseService, ExpenseSummary } from "../expense.service";

const CATEGORY_EMOJI: Record<string, string> = {
  FOOD: "🍕",
  TRANSPORT: "🚗",
  SHOPPING: "🛒",
  UTILITIES: "💡",
  ENTERTAINMENT: "🎬",
  HEALTH: "💊",
  EDUCATION: "📚",
  TRAVEL: "✈️",
  SERVICES: "🔧",
  OTHER: "📦"
};

const CATEGORY_LABELS: Record<string, string> = {
  FOOD: "Comida",
  TRANSPORT: "Transporte",
  SHOPPING: "Compras",
  UTILITIES: "Servicios",
  ENTERTAINMENT: "Entretenimiento",
  HEALTH: "Salud",
  EDUCATION: "Educacion",
  TRAVEL: "Viajes",
  SERVICES: "Servicios prof.",
  OTHER: "Otros"
};

export class ExpenseSummaryService {
  private readonly logger = createLogger("expense-summary");
  private readonly sentThisWeek = new Map<string, string>(); // chatId → weekKey
  private readonly sentThisMonth = new Map<string, string>(); // chatId → monthKey

  constructor(
    private readonly expenseService: ExpenseService,
    private readonly expenseRepository: ExpenseRepository,
    private readonly financialAdviceService: FinancialAdviceService,
    private readonly whatsappClient: WhatsAppClient
  ) {}

  async sendWeeklySummaries(): Promise<void> {
    const now = new Date();
    const bsAsNow = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })
    );

    // Find the start of the current week (Monday)
    const weekStart = new Date(bsAsNow);
    const dayOfWeek = weekStart.getDay(); // 0=Sun, 1=Mon
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    weekStart.setDate(weekStart.getDate() - daysToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekKey = this.getWeekKey(weekStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const users = await this.expenseRepository.findUsersWithExpenses(weekStart, weekEnd);

    for (const user of users) {
      if (this.sentThisWeek.get(user.chatId) === weekKey) {
        this.logger.debug(`Weekly summary already sent to ${user.chatId} for week ${weekKey}`);
        continue;
      }

      try {
        const summary = await this.expenseService.getWeeklySummary(user.userId, weekStart);

        if (summary.transactionCount === 0) continue;

        const periodLabel = this.formatWeekLabel(weekStart, weekEnd);
        const message = await this.formatSummaryMessage(summary, `Semana del ${periodLabel}`, true);

        await this.whatsappClient.sendMessage(user.chatId, message);
        this.sentThisWeek.set(user.chatId, weekKey);
        this.logger.info(`Weekly expense summary sent to ${user.chatId}`);
      } catch (error) {
        this.logger.error(`Failed to send weekly summary to ${user.chatId}`, error);
      }
    }
  }

  async sendMonthlySummaries(): Promise<void> {
    const now = new Date();
    const bsAsNow = new Date(
      now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" })
    );

    // Last month
    let year = bsAsNow.getFullYear();
    let month = bsAsNow.getMonth(); // 0-indexed → previous month
    if (month === 0) {
      month = 12;
      year--;
    }

    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const users = await this.expenseRepository.findUsersWithExpenses(monthStart, monthEnd);

    for (const user of users) {
      if (this.sentThisMonth.get(user.chatId) === monthKey) {
        this.logger.debug(`Monthly summary already sent to ${user.chatId} for ${monthKey}`);
        continue;
      }

      try {
        const summary = await this.expenseService.getMonthlySummary(user.userId, year, month);

        if (summary.transactionCount === 0) continue;

        const monthName = new Date(year, month - 1, 1).toLocaleString("es-AR", {
          month: "long",
          year: "numeric"
        });
        const message = await this.formatSummaryMessage(summary, this.capitalize(monthName), true);

        await this.whatsappClient.sendMessage(user.chatId, message);
        this.sentThisMonth.set(user.chatId, monthKey);
        this.logger.info(`Monthly expense summary sent to ${user.chatId}`);
      } catch (error) {
        this.logger.error(`Failed to send monthly summary to ${user.chatId}`, error);
      }
    }
  }

  async formatSummaryMessage(
    summary: ExpenseSummary,
    period: string,
    includeAdvice: boolean
  ): Promise<string> {
    let message = `📊 *Resumen de gastos - ${period}*\n\n`;

    if (summary.totals.length > 0) {
      message += `💰 *Total gastado:*\n`;
      for (const t of summary.totals) {
        message += `• ${this.formatAmount(t.amount, t.currency)}\n`;
      }
      message += "\n";
    }

    if (summary.categoryBreakdown.length > 0) {
      message += `📂 *Por categoria:*\n`;
      // Group by currency, show top categories
      const byCurrency = new Map<string, { category: string; amount: number }[]>();
      for (const c of summary.categoryBreakdown) {
        if (!byCurrency.has(c.currency)) byCurrency.set(c.currency, []);
        byCurrency.get(c.currency)!.push({ category: c.category, amount: c.amount });
      }

      for (const [currency, categories] of byCurrency) {
        const sorted = categories.sort((a, b) => b.amount - a.amount).slice(0, 5);
        for (const c of sorted) {
          const emoji = CATEGORY_EMOJI[c.category] ?? "📦";
          const label = CATEGORY_LABELS[c.category] ?? c.category;
          message += `• ${emoji} ${label}: ${this.formatAmount(c.amount, currency)}\n`;
        }
      }
      message += "\n";
    }

    if (summary.topMerchants.length > 0) {
      message += `🏪 *Principales comercios:*\n`;
      for (const m of summary.topMerchants) {
        message += `• ${m.merchant}: ${this.formatAmount(m.amount, m.currency)}\n`;
      }
      message += "\n";
    }

    message += `📈 *${summary.transactionCount} transaccion${summary.transactionCount !== 1 ? "es" : ""} procesada${summary.transactionCount !== 1 ? "s" : ""}*`;

    if (includeAdvice && summary.transactionCount > 0) {
      try {
        const advice = await this.financialAdviceService.generateAdvice(summary, period);
        message += `\n\n💡 *Consejos personalizados:*\n${advice}`;
      } catch (error) {
        this.logger.error("Failed to include advice in summary", error);
      }
    }

    return message;
  }

  private formatAmount(amount: number, currency: string): string {
    if (currency === "ARS") {
      return `$${amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ARS`;
    }
    if (currency === "USD") {
      return `US$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${currency}`;
  }

  private formatWeekLabel(start: Date, end: Date): string {
    const startStr = start.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
    const endStr = end.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
    return `${startStr} al ${endStr}`;
  }

  private getWeekKey(weekStart: Date): string {
    const y = weekStart.getFullYear();
    const m = String(weekStart.getMonth() + 1).padStart(2, "0");
    const d = String(weekStart.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
