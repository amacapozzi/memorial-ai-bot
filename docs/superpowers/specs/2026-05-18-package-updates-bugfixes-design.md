# Package Updates + Bug Fixes — Design Spec

**Date:** 2026-05-18  
**Scope:** Safe dependency updates (no major breaking changes) + 3 code bug fixes

---

## 1. Package Updates

### Runtime dependencies

| Package                   | From       | To          | Notes                                                                        |
| ------------------------- | ---------- | ----------- | ---------------------------------------------------------------------------- |
| `prisma`                  | 7.3.0      | 7.8.0       | Same major, safe. Project already uses `prisma.config.ts` (Prisma 7 native). |
| `@prisma/client`          | 7.3.0      | 7.8.0       | Paired with prisma.                                                          |
| `@prisma/adapter-pg`      | 7.3.0      | 7.8.0       | Paired with prisma.                                                          |
| `elysia`                  | 1.4.19     | 1.4.28      | Patch.                                                                       |
| `pg`                      | 8.17.2     | 8.21.0      | Patch.                                                                       |
| `@whiskeysockets/baileys` | 7.0.0-rc.9 | 7.0.0-rc.11 | RC patch, likely contains connection fixes.                                  |
| `googleapis`              | 170.1.0    | 171.4.0     | Minor update.                                                                |
| `zod`                     | 4.3.6      | 4.4.3       | Minor patch.                                                                 |

### Dev dependencies

| Package                            | From   | To                             |
| ---------------------------------- | ------ | ------------------------------ |
| `@typescript-eslint/eslint-plugin` | 8.51.0 | 8.59.4                         |
| `@typescript-eslint/parser`        | 8.51.0 | 8.59.4                         |
| `@types/node`                      | 25.0.3 | 25.9.0                         |
| `@types/pg`                        | 8.16.0 | 8.20.0                         |
| `bun-types`                        | 1.3.6  | 1.3.14                         |
| `prettier`                         | 3.7.4  | 3.8.3                          |
| `eslint`                           | 9.39.2 | 9.39.4 (patch only — NOT 10.x) |
| `eslint-plugin-unused-imports`     | 4.3.0  | 4.4.1                          |

**Excluded intentionally:** `groq-sdk` (0.37→1.2 major), `typescript` (5.9→6.0 major), `eslint` major (9→10), `lint-staged` major (16→17), `@commitlint` major (20→21).

### Post-update step

After updating Prisma packages, regenerate the client:

```bash
bun --bun run prisma generate
```

---

## 2. Bug Fix: `canCreateReminder()` dead-code null check

**File:** `src/modules/reminders/reminder.repository.ts`  
**Lines:** 168–181

### Problem

```typescript
const maxReminders = limits?.maxReminders ?? 5; // null is coerced to 5 here
if (maxReminders === null) {
  // this can NEVER be true
  return true;
}
```

`limits?.maxReminders` returns `null | number | undefined`. The `?? 5` replaces both `null` and `undefined` with `5`, so `maxReminders` is always a `number` by the time the null check runs. Users on paid plans with `maxReminders: null` (unlimited) get incorrectly capped at 5.

### Fix

Check `null` (unlimited) before applying the free-tier fallback:

```typescript
// null from plan = explicitly unlimited (paid plan)
if (limits?.maxReminders === null) {
  return true;
}
// undefined limits = no subscription = free tier cap of 5
const maxReminders = limits?.maxReminders ?? 5;
const currentCount = await this.countByChat(chatId);
return currentCount < maxReminders;
```

---

## 3. Bug Fix: Scheduler weekly/monthly summaries fire multiple times per hour

**File:** `src/modules/reminders/scheduler/scheduler.service.ts`  
**Lines:** 126–136

### Problem

The scheduler ticks every 60 seconds. The weekly summary condition is `dayOfWeek === 1 && hourBsAs === 8` — this is true for the entire hour, meaning it fires up to 60 times (once per tick) every Monday at 8am.

### Fix

Track last-run date with private instance fields. Skip if already ran within the same calendar day for weeklies/monthlies.

```typescript
private lastWeeklyDate: string | null = null;   // "YYYY-MM-DD"
private lastMonthlyDate: string | null = null;  // "YYYY-MM-DD"
```

In `tick()`, before firing summaries, check and update the guard:

```typescript
const todayStr = nowBsAs.toISOString().slice(0, 10);

if (this.expenseSummaryService && dayOfWeek === 1 && hourBsAs === 8 && this.lastWeeklyDate !== todayStr) {
  this.lastWeeklyDate = todayStr;
  await this.expenseSummaryService.sendWeeklySummaries().catch(...);
}

if (this.expenseSummaryService && dayOfMonth === 1 && hourBsAs === 8 && this.lastMonthlyDate !== todayStr) {
  this.lastMonthlyDate = todayStr;
  await this.expenseSummaryService.sendMonthlySummaries().catch(...);
}
```

---

## 4. Bug Fix: `loggedOut` reconnect silences errors

**File:** `src/modules/whatsapp/client/whatsapp.client.ts`  
**Lines:** 166–173

### Problem

```typescript
this.connect(); // Promise not handled — errors are silently swallowed
```

### Fix

```typescript
this.connect().catch((err) => {
  this.logger.error("Failed to reconnect after logout", err);
});
```

---

## Verification Steps

1. `bun --bun run prisma generate` — no generation errors
2. `bun typecheck` — no type errors
3. `bun lint` — no lint errors
4. Manual smoke test: start bot, confirm WhatsApp connects
