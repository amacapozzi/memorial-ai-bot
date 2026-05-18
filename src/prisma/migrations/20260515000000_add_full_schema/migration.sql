-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FOOD', 'TRANSPORT', 'SHOPPING', 'UTILITIES', 'ENTERTAINMENT', 'HEALTH', 'EDUCATION', 'TRAVEL', 'SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "ScheduledPaymentStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'COMPLETED');

-- AlterEnum: add missing values to EmailType
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'SECURITY';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'APPOINTMENT';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'MEETING';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'FLIGHT';

-- AlterTable: add missing columns to users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "email_verified" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "image" TEXT,
  ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS "digest_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "digest_hour" INTEGER NOT NULL DEFAULT 8;

-- Make chat_id optional on users (it was NOT NULL before)
ALTER TABLE "users" ALTER COLUMN "chat_id" DROP NOT NULL;

-- Add unique constraint on email
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- AlterTable: add user_id FK to reminders
ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "user_id" TEXT;

-- CreateTable: accounts (Auth.js)
CREATE TABLE IF NOT EXISTS "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sessions (Auth.js)
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: verification_tokens (Auth.js)
CREATE TABLE IF NOT EXISTS "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable: plans
CREATE TABLE IF NOT EXISTS "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_monthly" INTEGER NOT NULL,
    "price_yearly" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "mp_plan_id_monthly" TEXT,
    "mp_plan_id_yearly" TEXT,
    "features" JSONB NOT NULL DEFAULT '[]',
    "max_reminders" INTEGER,
    "max_email_accounts" INTEGER,
    "has_calendar_sync" BOOLEAN NOT NULL DEFAULT false,
    "has_email_sync" BOOLEAN NOT NULL DEFAULT false,
    "has_email_reply" BOOLEAN NOT NULL DEFAULT false,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable: subscriptions
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billing_cycle" "BillingCycle" NOT NULL,
    "mp_subscription_id" TEXT,
    "mp_payer_id" TEXT,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: payments
CREATE TABLE IF NOT EXISTS "payments" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "status" "PaymentStatus" NOT NULL,
    "mp_payment_id" TEXT,
    "mp_status" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mercadolibre_tokens
CREATE TABLE IF NOT EXISTS "mercadolibre_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "token_type" TEXT NOT NULL DEFAULT 'Bearer',
    "ml_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mercadolibre_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable: expenses
CREATE TABLE IF NOT EXISTS "expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "processed_email_id" TEXT,
    "merchant" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: scheduled_payments
CREATE TABLE IF NOT EXISTS "scheduled_payments" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "recurrence" "RecurrenceType" NOT NULL DEFAULT 'NONE',
    "recurrence_day" INTEGER,
    "recurrence_time" TEXT,
    "next_payment_at" TIMESTAMP(3) NOT NULL,
    "total_payments" INTEGER,
    "paid_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ScheduledPaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: commits
CREATE TABLE IF NOT EXISTS "commits" (
    "id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable: linking_codes
CREATE TABLE IF NOT EXISTS "linking_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linking_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_session_token_key" ON "sessions"("session_token");
CREATE UNIQUE INDEX IF NOT EXISTS "verification_tokens_token_key" ON "verification_tokens"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");
CREATE UNIQUE INDEX IF NOT EXISTS "plans_mp_plan_id_monthly_key" ON "plans"("mp_plan_id_monthly");
CREATE UNIQUE INDEX IF NOT EXISTS "plans_mp_plan_id_yearly_key" ON "plans"("mp_plan_id_yearly");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_user_id_key" ON "subscriptions"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_mp_subscription_id_key" ON "subscriptions"("mp_subscription_id");
CREATE INDEX IF NOT EXISTS "payments_subscription_id_created_at_idx" ON "payments"("subscription_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_mp_payment_id_key" ON "payments"("mp_payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mercadolibre_tokens_user_id_key" ON "mercadolibre_tokens"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_processed_email_id_key" ON "expenses"("processed_email_id");
CREATE INDEX IF NOT EXISTS "expenses_user_id_date_idx" ON "expenses"("user_id", "date");
CREATE INDEX IF NOT EXISTS "expenses_user_id_currency_date_idx" ON "expenses"("user_id", "currency", "date");
CREATE INDEX IF NOT EXISTS "scheduled_payments_status_next_payment_at_idx" ON "scheduled_payments"("status", "next_payment_at");
CREATE INDEX IF NOT EXISTS "scheduled_payments_chat_id_status_idx" ON "scheduled_payments"("chat_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "commits_sha_key" ON "commits"("sha");
CREATE INDEX IF NOT EXISTS "commits_repository_timestamp_idx" ON "commits"("repository", "timestamp");
CREATE UNIQUE INDEX IF NOT EXISTS "linking_codes_code_key" ON "linking_codes"("code");
CREATE INDEX IF NOT EXISTS "linking_codes_code_expires_at_idx" ON "linking_codes"("code", "expires_at");
CREATE INDEX IF NOT EXISTS "reminders_user_id_status_idx" ON "reminders"("user_id", "status");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mercadolibre_tokens" ADD CONSTRAINT "mercadolibre_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_processed_email_id_fkey" FOREIGN KEY ("processed_email_id") REFERENCES "processed_emails"("id") ON UPDATE CASCADE;
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
