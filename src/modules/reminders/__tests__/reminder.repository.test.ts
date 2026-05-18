import { describe, expect, mock, test } from "bun:test";

import type { PrismaClient } from "@prisma-module/generated/client";

import { ReminderRepository } from "../reminder.repository";

function makePrisma(userResult: unknown, countResult: number): PrismaClient {
  return {
    user: { findUnique: mock(() => Promise.resolve(userResult)) },
    reminder: { count: mock(() => Promise.resolve(countResult)) }
  } as unknown as PrismaClient;
}

describe("canCreateReminder", () => {
  test("returns true when plan has maxReminders: null (unlimited)", async () => {
    // null maxReminders = paid plan with no limit
    const prisma = makePrisma({ id: "u1", subscription: { plan: { maxReminders: null } } }, 999);
    const repo = new ReminderRepository(prisma);
    expect(await repo.canCreateReminder("chat-1")).toBe(true);
  });

  test("returns false when free tier user is at the 5-reminder cap", async () => {
    // null user → getUserPlanLimits returns null → free tier, max = 5
    const prisma = makePrisma(null, 5);
    const repo = new ReminderRepository(prisma);
    expect(await repo.canCreateReminder("chat-1")).toBe(false);
  });

  test("returns true when free tier user has fewer than 5 reminders", async () => {
    const prisma = makePrisma(null, 3);
    const repo = new ReminderRepository(prisma);
    expect(await repo.canCreateReminder("chat-1")).toBe(true);
  });

  test("returns false when paid plan limit is reached", async () => {
    const prisma = makePrisma({ id: "u1", subscription: { plan: { maxReminders: 10 } } }, 10);
    const repo = new ReminderRepository(prisma);
    expect(await repo.canCreateReminder("chat-1")).toBe(false);
  });
});
