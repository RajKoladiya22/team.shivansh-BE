-- CreateEnum
CREATE TYPE "DailyStatusSection" AS ENUM ('WORKED_ON', 'IN_PROGRESS', 'QUERY', 'LEARNING');

-- CreateEnum
CREATE TYPE "DailyStatusEntityType" AS ENUM ('LEAD', 'SUPPORT', 'TASK', 'CALL', 'PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "DailyStatusState" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');

-- CreateTable
CREATE TABLE "DailyStatusReport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "state" "DailyStatusState" NOT NULL DEFAULT 'SUBMITTED',
    "summary" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStatusReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStatusItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "section" "DailyStatusSection" NOT NULL,
    "entityType" "DailyStatusEntityType",
    "entityId" TEXT,
    "title" TEXT,
    "note" TEXT NOT NULL,
    "raisedToAccountId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "timeSpentMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStatusItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyStatusReport_accountId_idx" ON "DailyStatusReport"("accountId");

-- CreateIndex
CREATE INDEX "DailyStatusReport_reportDate_idx" ON "DailyStatusReport"("reportDate");

-- CreateIndex
CREATE INDEX "DailyStatusReport_state_idx" ON "DailyStatusReport"("state");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStatusReport_accountId_reportDate_key" ON "DailyStatusReport"("accountId", "reportDate");

-- CreateIndex
CREATE INDEX "DailyStatusItem_reportId_idx" ON "DailyStatusItem"("reportId");

-- CreateIndex
CREATE INDEX "DailyStatusItem_section_idx" ON "DailyStatusItem"("section");

-- CreateIndex
CREATE INDEX "DailyStatusItem_entityType_entityId_idx" ON "DailyStatusItem"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "DailyStatusReport" ADD CONSTRAINT "DailyStatusReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStatusItem" ADD CONSTRAINT "DailyStatusItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyStatusReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
