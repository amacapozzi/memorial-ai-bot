import type { Expense, ExpenseCategory } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

import type { ExpenseRepository } from "./expense.repository";

export interface ExpenseSummary {
  totals: { currency: string; amount: number }[];
  categoryBreakdown: { category: string; currency: string; amount: number }[];
  transactionCount: number;
  topMerchants: { merchant: string; amount: number; currency: string }[];
}

interface ProcessedEmailData {
  id: string;
  userId: string;
  receivedAt: Date;
  extractedData: unknown;
}

interface StoredExpenseData {
  merchant?: string | null;
  amount?: number | null;
  currency?: string | null;
  category?: string | null;
}

export class ExpenseService {
  private readonly logger = createLogger("expense-service");

  constructor(private readonly expenseRepository: ExpenseRepository) {}

  async createFromEmail(processedEmail: ProcessedEmailData): Promise<Expense | null> {
    // Avoid creating duplicate expenses
    const exists = await this.expenseRepository.existsByProcessedEmailId(processedEmail.id);
    if (exists) {
      this.logger.debug(`Expense already exists for processedEmail ${processedEmail.id}`);
      return null;
    }

    const data = processedEmail.extractedData as Record<string, unknown> | null;
    if (!data) {
      this.logger.debug(`No extractedData for processedEmail ${processedEmail.id}`);
      return null;
    }

    const expenseData = data.expenseData as StoredExpenseData | undefined;
    if (!expenseData) {
      this.logger.debug(`No expenseData in extractedData for processedEmail ${processedEmail.id}`);
      return null;
    }

    const amount = expenseData.amount;
    const currency = expenseData.currency;

    if (!amount || amount <= 0 || !currency) {
      this.logger.debug(
        `Invalid expense data (amount=${amount}, currency=${currency}) for ${processedEmail.id}`
      );
      return null;
    }

    const category = this.mapCategory(expenseData.category ?? "OTHER");

    try {
      const expense = await this.expenseRepository.create({
        userId: processedEmail.userId,
        processedEmailId: processedEmail.id,
        merchant: expenseData.merchant ?? null,
        amount,
        currency,
        category,
        date: processedEmail.receivedAt
      });

      this.logger.info(
        `Created expense ${expense.id}: ${amount} ${currency} @ ${expenseData.merchant ?? "unknown"}`
      );

      return expense;
    } catch (error) {
      this.logger.error(`Failed to create expense for processedEmail ${processedEmail.id}`, error);
      return null;
    }
  }

  async getMonthlySummary(userId: string, year: number, month: number): Promise<ExpenseSummary> {
    const { from, to } = this.getMonthRange(year, month);
    return this.getSummaryForRange(userId, from, to);
  }

  async getWeeklySummary(userId: string, weekStart: Date): Promise<ExpenseSummary> {
    const from = new Date(weekStart);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 6);
    to.setHours(23, 59, 59, 999);
    return this.getSummaryForRange(userId, from, to);
  }

  async getSummaryForDateRange(userId: string, from: Date, to: Date): Promise<ExpenseSummary> {
    return this.getSummaryForRange(userId, from, to);
  }

  async getCurrentMonthSummary(userId: string): Promise<ExpenseSummary> {
    const now = new Date();
    return this.getMonthlySummary(userId, now.getFullYear(), now.getMonth() + 1);
  }

  async getLastMonthSummary(userId: string): Promise<ExpenseSummary> {
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed, so this is last month
    if (month === 0) {
      month = 12;
      year--;
    }
    return this.getMonthlySummary(userId, year, month);
  }

  private async getSummaryForRange(userId: string, from: Date, to: Date): Promise<ExpenseSummary> {
    const [totals, categoryBreakdown, topMerchants, transactionCount] = await Promise.all([
      this.expenseRepository.getTotalsByCurrencyAndPeriod(userId, from, to),
      this.expenseRepository.getCategoryBreakdown(userId, from, to),
      this.expenseRepository.getTopMerchants(userId, from, to),
      this.expenseRepository.countByUserAndDateRange(userId, from, to)
    ]);

    return {
      totals: totals.map((t) => ({ currency: t.currency, amount: t.total })),
      categoryBreakdown: categoryBreakdown.map((c) => ({
        category: c.category,
        currency: c.currency,
        amount: c.total
      })),
      transactionCount,
      topMerchants: topMerchants.map((m) => ({
        merchant: m.merchant,
        amount: m.total,
        currency: m.currency
      }))
    };
  }

  private getMonthRange(year: number, month: number): { from: Date; to: Date } {
    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999);
    return { from, to };
  }

  private mapCategory(raw: string): ExpenseCategory {
    const valid = [
      "FOOD",
      "TRANSPORT",
      "SHOPPING",
      "UTILITIES",
      "ENTERTAINMENT",
      "HEALTH",
      "EDUCATION",
      "TRAVEL",
      "SERVICES",
      "OTHER"
    ];
    const upper = raw.toUpperCase();
    return (valid.includes(upper) ? upper : "OTHER") as ExpenseCategory;
  }
}
