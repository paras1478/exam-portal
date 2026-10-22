-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'STUDENT', 'FACULTY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExamStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ExamStatus" ADD VALUE 'APPROVED';
ALTER TYPE "ExamStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ExamStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorEmail" TEXT,
ADD COLUMN     "actorRole" "Role",
ADD COLUMN     "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS';

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "submittedForApprovalAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT;

-- AlterTable
ALTER TABLE "SubmittedAnswer" ADD COLUMN     "overrideMarks" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ExamStatusChange" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "fromStatus" "ExamStatus" NOT NULL,
    "toStatus" "ExamStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultRevision" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "questionId" TEXT,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "previousMarks" DOUBLE PRECISION,
    "newMarks" DOUBLE PRECISION,
    "previousTotalScore" DOUBLE PRECISION NOT NULL,
    "newTotalScore" DOUBLE PRECISION NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "recipients" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ExamStatusChange_examId_createdAt_idx" ON "ExamStatusChange"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "ResultRevision_resultId_createdAt_idx" ON "ResultRevision"("resultId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamStatusChange" ADD CONSTRAINT "ExamStatusChange_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamStatusChange" ADD CONSTRAINT "ExamStatusChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "Result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit logs are append-only. The only permitted UPDATE is the automatic
-- "ON DELETE SET NULL" of actorId when a user row is removed (the actor
-- snapshot columns keep the trail meaningful).
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."actorId" IS NULL AND OLD."actorId" IS NOT NULL
     AND NEW."id" = OLD."id"
     AND NEW."action" = OLD."action"
     AND NEW."outcome" = OLD."outcome"
     AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" IS NOT DISTINCT FROM OLD."entityId"
     AND NEW."metadata"::text IS NOT DISTINCT FROM OLD."metadata"::text
     AND NEW."actorEmail" IS NOT DISTINCT FROM OLD."actorEmail"
     AND NEW."actorRole" IS NOT DISTINCT FROM OLD."actorRole"
     AND NEW."ipAddress" IS NOT DISTINCT FROM OLD."ipAddress"
     AND NEW."createdAt" = OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Workflow history is immutable too.
CREATE OR REPLACE FUNCTION exam_status_change_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."actorId" IS NULL AND OLD."actorId" IS NOT NULL
     AND ROW(NEW."id", NEW."examId", NEW."fromStatus", NEW."toStatus", NEW."action", NEW."reason", NEW."createdAt")
         IS NOT DISTINCT FROM ROW(OLD."id", OLD."examId", OLD."fromStatus", OLD."toStatus", OLD."action", OLD."reason", OLD."createdAt") THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "Exam" WHERE "id" = OLD."examId") THEN
    RETURN OLD; -- cascade from deleting a (never-attempted) exam
  END IF;
  RAISE EXCEPTION 'ExamStatusChange is immutable (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExamStatusChange_immutable"
  BEFORE UPDATE OR DELETE ON "ExamStatusChange"
  FOR EACH ROW EXECUTE FUNCTION exam_status_change_immutable();
