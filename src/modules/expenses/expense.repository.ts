import type { Expense, ExpenseCategory, PrismaClient } from "@prisma-module/generated/client";
import { createLogger } from "@shared/logger/logger";

export interface CreateExpenseData {
  userId: string;
  processedEmailId?: string;
  merchant?: string | null;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  description?: string | null;
  date: Date;
}

export interface ExpenseTotals {
  currency: string;
  total: number;
}

export interface CategoryBreakdown {
  category: string;
  currency: string;
  total: number;
}

export interface UserWithChat {
  userId: string;
  chatId: string;
}

export class ExpenseRepository {
  private readonly logger = createLogger("expense-repository");

  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateExpenseData): Promise<Expense> {
    return this.prisma.expense.create({
      data: {
        userId: data.userId,
        processedEmailId: data.processedEmailId ?? null,
        merchant: data.merchant ?? null,
        amount: data.amount,
        currency: data.currency,
        category: data.category,
        description: data.description ?? null,
        date: data.date
      }
    });
  }

  async findByUserAndDateRange(userId: string, from: Date, to: Date): Promise<Expense[]> {
    return this.prisma.expense.findMany({
      where: {
        userId,
        date: { gte: from, lte: to }
      },
      orderBy: { date: "desc" }
    });
  }

  async getTotalsByCurrencyAndPeriod(
    userId: string,
    from: Date,
    to: Date
  ): Promise<ExpenseTotals[]> {
    const result = await this.prisma.expense.groupBy({
      by: ["currency"],
      where: {
        userId,
        date: { gte: from, lte: to }
      },
      _sum: { amount: true }
    });

    return result.map((r) => ({
      currency: r.currency,
      total: Number(r._sum.amount ?? 0)
    }));
  }

  async getCategoryBreakdown(userId: string, from: Date, to: Date): Promise<CategoryBreakdown[]> {
    const result = await this.prisma.expense.groupBy({
      by: ["category", "currency"],
      where: {
        userId,
        date: { gte: from, lte: to }
      },
      _sum: { amount: true }
    });

    return result.map((r) => ({
      category: r.category,
      currency: r.currency,
      total: Number(r._sum.amount ?? 0)
    }));
  }

  async getTopMerchants(
    userId: string,
    from: Date,
    to: Date,
    limit = 5
  ): Promise<{ merchant: string; currency: string; total: number }[]> {
    const result = await this.prisma.expense.groupBy({
      by: ["merchant", "currency"],
      where: {
        userId,
        date: { gte: from, lte: to },
        merchant: { not: null }
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: limit
    });

    return result
      .filter((r) => r.merchant !== null)
      .map((r) => ({
        merchant: r.merchant!,
        currency: r.currency,
        total: Number(r._sum.amount ?? 0)
      }));
  }

  async countByUserAndDateRange(userId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.expense.count({
      where: {
        userId,
        date: { gte: from, lte: to }
      }
    });
  }

  async findUsersWithExpenses(from: Date, to: Date): Promise<UserWithChat[]> {
    const users = await this.prisma.user.findMany({
      where: {
        chatId: { not: null },
        expenses: {
          some: {
            date: { gte: from, lte: to }
          }
        }
      },
      select: { id: true, chatId: true }
    });

    return users
      .filter((u): u is typeof u & { chatId: string } => u.chatId !== null)
      .map((u) => ({ userId: u.id, chatId: u.chatId }));
  }

  async existsByProcessedEmailId(processedEmailId: string): Promise<boolean> {
    const count = await this.prisma.expense.count({
      where: { processedEmailId }
    });
    return count > 0;
  }
}
