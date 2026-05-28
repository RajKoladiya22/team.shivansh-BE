-- CreateEnum
CREATE TYPE "CloudServiceType" AS ENUM ('MIRACLE', 'COMHARD');

-- CreateEnum
CREATE TYPE "CloudRenewalType" AS ENUM ('QUARTERLY', 'SIX_MONTHS', 'YEARLY');

-- CreateTable
CREATE TABLE "CloudService" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" "CloudServiceType" NOT NULL,
    "cost" DECIMAL(12,2),
    "renewalType" "CloudRenewalType" NOT NULL,
    "purchaseDate" TIMESTAMP(3),
    "isDriveSetup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adminPassword" TEXT,
    "ipAddress" TEXT,
    "userCount" INTEGER,
    "adminId" TEXT,
    "comhardSubId" TEXT,
    "isOnTrial" BOOLEAN NOT NULL DEFAULT false,
    "trialStartDate" TIMESTAMP(3),
    "trialEndDate" TIMESTAMP(3),
    "trialDoneAt" TIMESTAMP(3),
    "numberOfTally" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudServiceUser" (
    "id" TEXT NOT NULL,
    "cloudServiceId" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "note" TEXT,
    "isAdmin" BOOLEAN,
    "tallyNumber" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudServiceUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudService_comhardSubId_key" ON "CloudService"("comhardSubId");

-- CreateIndex
CREATE INDEX "CloudService_customerId_idx" ON "CloudService"("customerId");

-- CreateIndex
CREATE INDEX "CloudService_type_idx" ON "CloudService"("type");

-- CreateIndex
CREATE INDEX "CloudService_isActive_idx" ON "CloudService"("isActive");

-- CreateIndex
CREATE INDEX "CloudService_renewalType_purchaseDate_idx" ON "CloudService"("renewalType", "purchaseDate");

-- CreateIndex
CREATE INDEX "CloudServiceUser_cloudServiceId_idx" ON "CloudServiceUser"("cloudServiceId");

-- CreateIndex
CREATE INDEX "CloudServiceUser_cloudServiceId_tallyNumber_idx" ON "CloudServiceUser"("cloudServiceId", "tallyNumber");

-- AddForeignKey
ALTER TABLE "CloudService" ADD CONSTRAINT "CloudService_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudService" ADD CONSTRAINT "CloudService_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudService" ADD CONSTRAINT "CloudService_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudServiceUser" ADD CONSTRAINT "CloudServiceUser_cloudServiceId_fkey" FOREIGN KEY ("cloudServiceId") REFERENCES "CloudService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
