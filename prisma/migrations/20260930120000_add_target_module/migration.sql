-- CreateEnum
CREATE TYPE "TargetPeriodType" AS ENUM ('YEARLY', 'QUARTERLY', 'MONTHLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "TargetCategory" AS ENUM ('AMOUNT', 'LEAD');

-- CreateEnum
CREATE TYPE "TargetScope" AS ENUM ('COMPANY', 'TEAM', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'MISSED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "TargetCategory" NOT NULL DEFAULT 'AMOUNT',
    "periodType" "TargetPeriodType" NOT NULL,
    "scope" "TargetScope" NOT NULL DEFAULT 'COMPANY',
    "status" "TargetStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "fiscalYear" TEXT,
    "quarter" INTEGER,
    "month" INTEGER,
    "week" INTEGER,
    "targetAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "manualAchievedAmount" DECIMAL(14,2),
    "autoSyncRevenue" BOOLEAN NOT NULL DEFAULT true,
    "targetLeadsCreated" INTEGER,
    "manualAchievedLeadsCreated" INTEGER,
    "targetLeadsConverted" INTEGER,
    "manualAchievedLeadsConverted" INTEGER,
    "targetOrdersCompleted" INTEGER,
    "manualAchievedOrdersCompleted" INTEGER,
    "targetQuotationsCount" INTEGER,
    "manualAchievedQuotationsCount" INTEGER,
    "teamId" TEXT,
    "accountId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Target_category_idx" ON "Target"("category");

-- CreateIndex
CREATE INDEX "Target_category_periodType_year_idx" ON "Target"("category", "periodType", "year");

-- CreateIndex
CREATE INDEX "Target_periodType_idx" ON "Target"("periodType");

-- CreateIndex
CREATE INDEX "Target_year_idx" ON "Target"("year");

-- CreateIndex
CREATE INDEX "Target_startDate_idx" ON "Target"("startDate");

-- CreateIndex
CREATE INDEX "Target_endDate_idx" ON "Target"("endDate");

-- CreateIndex
CREATE INDEX "Target_status_idx" ON "Target"("status");

-- CreateIndex
CREATE INDEX "Target_teamId_idx" ON "Target"("teamId");

-- CreateIndex
CREATE INDEX "Target_accountId_idx" ON "Target"("accountId");

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
