-- CreateEnum
CREATE TYPE "CloudServiceActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DEACTIVATED', 'REACTIVATED', 'RENEWED', 'RENEWAL_TYPE_CHANGED', 'TRIAL_STARTED', 'TRIAL_EXTENDED', 'TRIAL_CONVERTED', 'TRIAL_ENDED', 'USER_ADDED', 'USER_REMOVED', 'USER_UPDATED', 'DRIVE_SETUP_ENABLED', 'DRIVE_SETUP_DISABLED', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "CloudServiceActivityLog" (
    "id" TEXT NOT NULL,
    "cloudServiceId" TEXT NOT NULL,
    "action" "CloudServiceActivityAction" NOT NULL,
    "meta" JSONB,
    "remark" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudServiceActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudServiceActivityLog_cloudServiceId_idx" ON "CloudServiceActivityLog"("cloudServiceId");

-- CreateIndex
CREATE INDEX "CloudServiceActivityLog_action_idx" ON "CloudServiceActivityLog"("action");

-- CreateIndex
CREATE INDEX "CloudServiceActivityLog_performedBy_idx" ON "CloudServiceActivityLog"("performedBy");

-- CreateIndex
CREATE INDEX "CloudServiceActivityLog_createdAt_idx" ON "CloudServiceActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "CloudServiceActivityLog_cloudServiceId_createdAt_idx" ON "CloudServiceActivityLog"("cloudServiceId", "createdAt");

-- CreateIndex
CREATE INDEX "CloudServiceActivityLog_cloudServiceId_action_idx" ON "CloudServiceActivityLog"("cloudServiceId", "action");

-- AddForeignKey
ALTER TABLE "CloudServiceActivityLog" ADD CONSTRAINT "CloudServiceActivityLog_cloudServiceId_fkey" FOREIGN KEY ("cloudServiceId") REFERENCES "CloudService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudServiceActivityLog" ADD CONSTRAINT "CloudServiceActivityLog_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
