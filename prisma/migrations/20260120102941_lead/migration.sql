-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MANUAL', 'WHATSAPP', 'INQUIRY_FORM');

-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('LEAD', 'SUPPORT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'CLOSED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LeadActivityAction" AS ENUM ('CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'ASSIGN_CHANGED', 'UPDATED', 'CLOSED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "type" "LeadType" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'PENDING',
    "customerName" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "product" JSONB,
    "cost" DECIMAL(12,2),
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "AssignmentType" NOT NULL,
    "accountId" TEXT,
    "teamId" TEXT,
    "remark" JSONB,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivityLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "action" "LeadActivityAction" NOT NULL,
    "meta" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_mobileNumber_idx" ON "Lead"("mobileNumber");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "LeadAssignment_accountId_idx" ON "LeadAssignment"("accountId");

-- CreateIndex
CREATE INDEX "LeadAssignment_teamId_idx" ON "LeadAssignment"("teamId");

-- CreateIndex
CREATE INDEX "LeadActivityLog_leadId_idx" ON "LeadActivityLog"("leadId");

-- CreateIndex
CREATE INDEX "LeadActivityLog_createdAt_idx" ON "LeadActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivityLog" ADD CONSTRAINT "LeadActivityLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
