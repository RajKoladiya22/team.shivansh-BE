-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'WAITING_FOR_CUSTOMER', 'SUPPORT_DONE', 'NOT_DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupportType" AS ENUM ('TECHNICAL_ISSUE', 'PRODUCT_TRAINING', 'FEATURE_EXPLANATION', 'NEW_SETUP', 'INSTALLATION', 'CONFIGURATION', 'BUG_REPORT', 'MAINTENANCE', 'FOLLOW_UP', 'CONSULTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportActivityAction" AS ENUM ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'EXPERT_ADDED', 'TIME_LOGGED', 'REMARK_ADDED', 'PRODUCT_CHANGED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SupportHelperRole" AS ENUM ('EXPORT', 'SUPPORT', 'CONSULT');

-- CreateTable
CREATE TABLE "Support" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "type" "SupportType" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportPriority" NOT NULL DEFAULT 'MEDIUM',
    "customerId" TEXT NOT NULL,
    "product" JSONB,
    "productCatalogId" TEXT,
    "isWorking" BOOLEAN NOT NULL DEFAULT false,
    "expert" TEXT,
    "remarks" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "totalWorkSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Support_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAssignment" (
    "id" TEXT NOT NULL,
    "supportId" TEXT NOT NULL,
    "accountId" TEXT,
    "teamId" TEXT,
    "type" "AssignmentType",
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SupportAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportActivityLog" (
    "id" TEXT NOT NULL,
    "supportId" TEXT NOT NULL,
    "action" "SupportActivityAction" NOT NULL,
    "meta" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTimeLog" (
    "id" TEXT NOT NULL,
    "supportId" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "remark" TEXT,
    "loggedBy" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportHelper" (
    "id" TEXT NOT NULL,
    "supportId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "SupportHelperRole" NOT NULL DEFAULT 'EXPORT',
    "addedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SupportHelper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductCatalogToSupport" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductCatalogToSupport_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Support_status_idx" ON "Support"("status");

-- CreateIndex
CREATE INDEX "Support_customerId_idx" ON "Support"("customerId");

-- CreateIndex
CREATE INDEX "Support_createdAt_idx" ON "Support"("createdAt");

-- CreateIndex
CREATE INDEX "SupportAssignment_supportId_idx" ON "SupportAssignment"("supportId");

-- CreateIndex
CREATE INDEX "SupportAssignment_accountId_idx" ON "SupportAssignment"("accountId");

-- CreateIndex
CREATE INDEX "SupportActivityLog_supportId_idx" ON "SupportActivityLog"("supportId");

-- CreateIndex
CREATE INDEX "SupportActivityLog_createdAt_idx" ON "SupportActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTimeLog_supportId_idx" ON "SupportTimeLog"("supportId");

-- CreateIndex
CREATE INDEX "SupportTimeLog_loggedAt_idx" ON "SupportTimeLog"("loggedAt");

-- CreateIndex
CREATE INDEX "SupportHelper_supportId_idx" ON "SupportHelper"("supportId");

-- CreateIndex
CREATE INDEX "SupportHelper_accountId_idx" ON "SupportHelper"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportHelper_supportId_accountId_key" ON "SupportHelper"("supportId", "accountId");

-- CreateIndex
CREATE INDEX "_ProductCatalogToSupport_B_index" ON "_ProductCatalogToSupport"("B");

-- AddForeignKey
ALTER TABLE "Support" ADD CONSTRAINT "Support_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Support" ADD CONSTRAINT "Support_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignment" ADD CONSTRAINT "SupportAssignment_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "Support"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignment" ADD CONSTRAINT "SupportAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignment" ADD CONSTRAINT "SupportAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssignment" ADD CONSTRAINT "SupportAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportActivityLog" ADD CONSTRAINT "SupportActivityLog_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "Support"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportActivityLog" ADD CONSTRAINT "SupportActivityLog_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTimeLog" ADD CONSTRAINT "SupportTimeLog_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "Support"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTimeLog" ADD CONSTRAINT "SupportTimeLog_loggedBy_fkey" FOREIGN KEY ("loggedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportHelper" ADD CONSTRAINT "SupportHelper_supportId_fkey" FOREIGN KEY ("supportId") REFERENCES "Support"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportHelper" ADD CONSTRAINT "SupportHelper_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportHelper" ADD CONSTRAINT "SupportHelper_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCatalogToSupport" ADD CONSTRAINT "_ProductCatalogToSupport_A_fkey" FOREIGN KEY ("A") REFERENCES "ProductCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCatalogToSupport" ADD CONSTRAINT "_ProductCatalogToSupport_B_fkey" FOREIGN KEY ("B") REFERENCES "Support"("id") ON DELETE CASCADE ON UPDATE CASCADE;
