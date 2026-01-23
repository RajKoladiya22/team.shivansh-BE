-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'MULTI_DAY');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SalaryMonthStatus" AS ENUM ('PENDING', 'GENERATED', 'CREDITED', 'HOLD');

-- CreateEnum
CREATE TYPE "SalaryNoticeStatus" AS ENUM ('SENT', 'VIEWED', 'ACKNOWLEDGED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "isBusy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isJdAccept" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "hraPercent" DECIMAL(5,2),
    "allowance" DECIMAL(12,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "previousSalary" DECIMAL(12,2) NOT NULL,
    "revisedSalary" DECIMAL(12,2) NOT NULL,
    "applicableFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "revisedBy" TEXT NOT NULL,
    "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlySalary" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL,
    "hra" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "status" "SalaryMonthStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "generatedAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "MonthlySalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStatement" (
    "id" TEXT NOT NULL,
    "monthlySalaryId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfUrl" TEXT,

    CONSTRAINT "SalaryStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryNotice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "revisionId" TEXT,
    "monthlySalaryId" TEXT,
    "message" TEXT,
    "status" "SalaryNoticeStatus" NOT NULL DEFAULT 'SENT',
    "sentBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "SalaryNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDetail" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "day" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "isSunday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusyActivityLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fromBusy" BOOLEAN NOT NULL,
    "toBusy" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusyActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_accountId_key" ON "SalaryStructure"("accountId");

-- CreateIndex
CREATE INDEX "SalaryStructure_effectiveFrom_idx" ON "SalaryStructure"("effectiveFrom");

-- CreateIndex
CREATE INDEX "SalaryRevision_salaryStructureId_idx" ON "SalaryRevision"("salaryStructureId");

-- CreateIndex
CREATE INDEX "SalaryRevision_applicableFrom_idx" ON "SalaryRevision"("applicableFrom");

-- CreateIndex
CREATE INDEX "MonthlySalary_status_idx" ON "MonthlySalary"("status");

-- CreateIndex
CREATE INDEX "MonthlySalary_year_month_idx" ON "MonthlySalary"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySalary_accountId_month_year_key" ON "MonthlySalary"("accountId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStatement_monthlySalaryId_key" ON "SalaryStatement"("monthlySalaryId");

-- CreateIndex
CREATE INDEX "SalaryNotice_accountId_idx" ON "SalaryNotice"("accountId");

-- CreateIndex
CREATE INDEX "SalaryNotice_sentAt_idx" ON "SalaryNotice"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankDetail_accountId_key" ON "BankDetail"("accountId");

-- CreateIndex
CREATE INDEX "AttendanceLog_date_idx" ON "AttendanceLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_accountId_date_key" ON "AttendanceLog"("accountId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequest_accountId_idx" ON "LeaveRequest"("accountId");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "BusyActivityLog_accountId_idx" ON "BusyActivityLog"("accountId");

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlySalary" ADD CONSTRAINT "MonthlySalary_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlySalary" ADD CONSTRAINT "MonthlySalary_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStatement" ADD CONSTRAINT "SalaryStatement_monthlySalaryId_fkey" FOREIGN KEY ("monthlySalaryId") REFERENCES "MonthlySalary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryNotice" ADD CONSTRAINT "SalaryNotice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryNotice" ADD CONSTRAINT "SalaryNotice_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "SalaryRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryNotice" ADD CONSTRAINT "SalaryNotice_monthlySalaryId_fkey" FOREIGN KEY ("monthlySalaryId") REFERENCES "MonthlySalary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetail" ADD CONSTRAINT "BankDetail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusyActivityLog" ADD CONSTRAINT "BusyActivityLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
