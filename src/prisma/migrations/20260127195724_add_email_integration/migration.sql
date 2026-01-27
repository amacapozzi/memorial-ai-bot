-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('PURCHASE', 'DELIVERY', 'APPOINTMENT', 'MEETING', 'FLIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcessedEmailStatus" AS ENUM ('PROCESSED', 'REMINDER_CREATED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "token_type" TEXT NOT NULL DEFAULT 'Bearer',
    "history_id" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_emails" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gmail_message_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "subject" TEXT,
    "sender" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_type" "EmailType" NOT NULL,
    "extracted_data" JSONB,
    "reminder_id" TEXT,
    "status" "ProcessedEmailStatus" NOT NULL DEFAULT 'PROCESSED',

    CONSTRAINT "processed_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_chat_id_key" ON "users"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_user_id_key" ON "email_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_emails_reminder_id_key" ON "processed_emails"("reminder_id");

-- CreateIndex
CREATE INDEX "processed_emails_user_id_processed_at_idx" ON "processed_emails"("user_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "processed_emails_user_id_gmail_message_id_key" ON "processed_emails"("user_id", "gmail_message_id");

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_emails" ADD CONSTRAINT "processed_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
