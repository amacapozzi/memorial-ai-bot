-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "recurrence" "RecurrenceType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "recurrence_day" INTEGER,
ADD COLUMN     "recurrence_time" TEXT;

-- CreateIndex
CREATE INDEX "reminders_chat_id_recurrence_idx" ON "reminders"("chat_id", "recurrence");
