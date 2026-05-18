# Package Updates + Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all safe dependencies to latest patch/minor versions and fix 3 confirmed bugs in reminder limit logic, scheduler deduplication, and WhatsApp reconnect error handling.

**Architecture:** Sequential — update packages first (external changes only), regenerate the Prisma client, then apply the 3 code fixes with TDD for the most unit-testable bug. One commit per logical unit.

**Tech Stack:** Bun 1.3, TypeScript 5.9, Prisma 7 (`prisma.config.ts`), Elysia 1.4, `@whiskeysockets/baileys` 7 RC, `bun:test` (built-in test runner)

---

## File Map

| File                                                          | Action       | Purpose                                  |
| ------------------------------------------------------------- | ------------ | ---------------------------------------- |
| `package.json`                                                | Modify       | Update dependency versions + test script |
| `bun.lock`                                                    | Auto-updated | Lockfile, updated by bun                 |
| `src/prisma/generated/*`                                      | Regenerated  | Prisma client after version bump         |
| `src/modules/reminders/reminder.repository.ts`                | Modify       | Fix `canCreateReminder` null check       |
| `src/modules/reminders/scheduler/scheduler.service.ts`        | Modify       | Add weekly/monthly dedup guards          |
| `src/modules/whatsapp/client/whatsapp.client.ts`              | Modify       | Add `.catch()` on logout reconnect       |
| `src/modules/reminders/__tests__/reminder.repository.test.ts` | Create       | Unit tests for `canCreateReminder`       |

---

### Task 1: Update all packages + regenerate Prisma client

**Files:**

- Modify: `package.json` (bun handles version bump)
- Auto-update: `bun.lock`
- Regenerate: `src/prisma/generated/*`

- [ ] **Step 1: Update runtime dependencies**

```bash
bun add prisma@7.8.0 "@prisma/client@7.8.0" "@prisma/adapter-pg@7.8.0" elysia@1.4.28 pg@8.21.0 "@whiskeysockets/baileys@7.0.0-rc.11" googleapis@171.4.0 zod@4.4.3
```

Expected: packages updated in `package.json` and `bun.lock`, no errors.

- [ ] **Step 2: Update dev dependencies**

```bash
bun add -d "@typescript-eslint/eslint-plugin@8.59.4" "@typescript-eslint/parser@8.59.4" "@types/node@25.9.0" "@types/pg@8.20.0" "bun-types@1.3.14" "prettier@3.8.3" "eslint@9.39.4" "eslint-plugin-unused-imports@4.4.1"
```

Expected: dev packages updated, no errors.

- [ ] **Step 3: Regenerate Prisma client**

```bash
bun --bun run prisma generate
```

Expected: output ends with `✔ Generated Prisma Client` and no errors.

- [ ] **Step 4: Run typecheck**

```bash
bun typecheck
```

Expected: exits 0. If type errors appear, they are regressions from the package updates — investigate before proceeding.

- [ ] **Step 5: Run lint**

```bash
bun lint
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/prisma/generated/
git commit -m "chore: update runtime and dev dependencies to latest safe versions"
```

---

### Task 2: Set up bun:test + write failing test for canCreateReminder bug

**Files:**

- Modify: `package.json` (test script)
- Create: `src/modules/reminders/__tests__/reminder.repository.test.ts`

The project has no test infrastructure (`"test": "echo \"Error: no test specified\""` in `package.json`). Bun includes a built-in test runner — no additional packages needed.

**The bug:** In `reminder.repository.ts`, `canCreateReminder()` coerces `null` to `5` via `?? 5` before checking for null, making the unlimited-plan branch dead code. Users on plans with `maxReminders: null` (unlimited) are incorrectly capped at 5 reminders.

- [ ] **Step 1: Update the test script in `package.json`**

In `package.json`, change:

```json
"test": "echo \"Error: no test specified\" && exit 1",
```

to:

```json
"test": "bun test",
```

- [ ] **Step 2: Create the test file**

Create `src/modules/reminders/__tests__/reminder.repository.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test — confirm the first test FAILS (proving the bug exists)**

```bash
bun test src/modules/reminders/__tests__/reminder.repository.test.ts
```

Expected: first test (`unlimited plan`) fails. Example output:

```
✗ canCreateReminder > returns true when plan has maxReminders: null (unlimited)
  expect(received).toBe(expected)
  Received: false
  Expected: true
```

Tests 2, 3, 4 should pass. If test 1 passes already, the bug may have been fixed — proceed anyway.

- [ ] **Step 4: Commit the failing test**

```bash
git add package.json src/modules/reminders/__tests__/reminder.repository.test.ts
git commit -m "test: add failing test for canCreateReminder unlimited plan bug"
```

---

### Task 3: Fix canCreateReminder — unlimited plan never returns true

**Files:**

- Modify: `src/modules/reminders/reminder.repository.ts` (method `canCreateReminder`, ~lines 168–181)

- [ ] **Step 1: Replace the method body**

In `src/modules/reminders/reminder.repository.ts`, find `canCreateReminder` and replace its body:

**Before:**

```typescript
async canCreateReminder(chatId: string): Promise<boolean> {
  const limits = await this.getUserPlanLimits(chatId);

  // No subscription or no limit = free tier (5 reminders)
  const maxReminders = limits?.maxReminders ?? 5;

  // null means unlimited
  if (maxReminders === null) {
    return true;
  }

  const currentCount = await this.countByChat(chatId);
  return currentCount < maxReminders;
}
```

**After:**

```typescript
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
```

- [ ] **Step 2: Run tests — all 4 must pass**

```bash
bun test src/modules/reminders/__tests__/reminder.repository.test.ts
```

Expected:

```
✓ canCreateReminder > returns true when plan has maxReminders: null (unlimited)
✓ canCreateReminder > returns false when free tier user is at the 5-reminder cap
✓ canCreateReminder > returns true when free tier user has fewer than 5 reminders
✓ canCreateReminder > returns false when paid plan limit is reached
4 pass, 0 fail
```

- [ ] **Step 3: Run typecheck**

```bash
bun typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/reminders/reminder.repository.ts
git commit -m "fix: correct canCreateReminder to allow unlimited reminders on null-limit plans"
```

---

### Task 4: Fix scheduler — weekly/monthly summaries fire up to 60× per hour

**Files:**

- Modify: `src/modules/reminders/scheduler/scheduler.service.ts`

**The bug:** The scheduler ticks every 60 s. Conditions like `dayOfWeek === 1 && hourBsAs === 8` remain true for the entire hour (60 ticks), so `sendWeeklySummaries` and `sendMonthlySummaries` fire up to 60 times.

- [ ] **Step 1: Add deduplication guard fields to the class**

In `src/modules/reminders/scheduler/scheduler.service.ts`, add two private fields immediately after `private isRunning = false;`:

```typescript
private isRunning = false;
private lastWeeklyDate: string | null = null;
private lastMonthlyDate: string | null = null;
```

- [ ] **Step 2: Add todayStr and guard checks in tick()**

In the `tick()` method, after the existing line:

```typescript
const dayOfMonth = nowBsAs.getDate();
```

Add:

```typescript
const todayStr = `${nowBsAs.getFullYear()}-${String(nowBsAs.getMonth() + 1).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
```

Then replace the weekly summary block:

**Before:**

```typescript
// Weekly expense summary (Monday at digest hour 8)
if (this.expenseSummaryService && dayOfWeek === 1 && hourBsAs === 8) {
  await this.expenseSummaryService.sendWeeklySummaries().catch((error) => {
    this.logger.error("Error sending weekly expense summaries", error);
  });
}
```

**After:**

```typescript
if (
  this.expenseSummaryService &&
  dayOfWeek === 1 &&
  hourBsAs === 8 &&
  this.lastWeeklyDate !== todayStr
) {
  this.lastWeeklyDate = todayStr;
  await this.expenseSummaryService.sendWeeklySummaries().catch((error) => {
    this.logger.error("Error sending weekly expense summaries", error);
  });
}
```

Then replace the monthly summary block:

**Before:**

```typescript
// Monthly expense summary (1st of month at digest hour 8)
if (this.expenseSummaryService && dayOfMonth === 1 && hourBsAs === 8) {
  await this.expenseSummaryService.sendMonthlySummaries().catch((error) => {
    this.logger.error("Error sending monthly expense summaries", error);
  });
}
```

**After:**

```typescript
if (
  this.expenseSummaryService &&
  dayOfMonth === 1 &&
  hourBsAs === 8 &&
  this.lastMonthlyDate !== todayStr
) {
  this.lastMonthlyDate = todayStr;
  await this.expenseSummaryService.sendMonthlySummaries().catch((error) => {
    this.logger.error("Error sending monthly expense summaries", error);
  });
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/reminders/scheduler/scheduler.service.ts
git commit -m "fix: prevent weekly/monthly expense summaries from firing multiple times per hour"
```

---

### Task 5: Fix WhatsApp logout — reconnect errors silently swallowed

**Files:**

- Modify: `src/modules/whatsapp/client/whatsapp.client.ts` (~lines 166–173)

**The bug:** `this.connect()` is called fire-and-forget with no error handling. If the reconnect throws (e.g. network issue right after logout), the error is silently lost.

- [ ] **Step 1: Add .catch() to the logout reconnect**

In `src/modules/whatsapp/client/whatsapp.client.ts`, find the `loggedOut` handler:

**Before:**

```typescript
if (reason === DisconnectReason.loggedOut) {
  this.logger.warn("Logged out from WhatsApp. Please scan QR code again.");
  this.sessionService.clearSession();
  this.reconnectAttempts = 0;
  this.reconnecting = false;
  this.connect();
  return;
}
```

**After:**

```typescript
if (reason === DisconnectReason.loggedOut) {
  this.logger.warn("Logged out from WhatsApp. Please scan QR code again.");
  this.sessionService.clearSession();
  this.reconnectAttempts = 0;
  this.reconnecting = false;
  this.connect().catch((err) => {
    this.logger.error("Failed to reconnect after logout", err);
  });
  return;
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/whatsapp/client/whatsapp.client.ts
git commit -m "fix: log errors on WhatsApp reconnect after logout"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all 4 tests pass.

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run lint**

```bash
bun lint
```

Expected: exits 0.
