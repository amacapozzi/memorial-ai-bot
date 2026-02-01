-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailType" ADD VALUE 'LEGAL_HEARING';
ALTER TYPE "EmailType" ADD VALUE 'DEADLINE';
ALTER TYPE "EmailType" ADD VALUE 'COURSE';
ALTER TYPE "EmailType" ADD VALUE 'TASK';
ALTER TYPE "EmailType" ADD VALUE 'LEGAL_INFO';
ALTER TYPE "EmailType" ADD VALUE 'EVENT';
