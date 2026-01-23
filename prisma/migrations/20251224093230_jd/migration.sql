-- CreateEnum
CREATE TYPE "JDVisibility" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "designation" TEXT,
    "summary" TEXT,
    "responsibilitiesMust" JSONB NOT NULL,
    "responsibilitiesMay" JSONB NOT NULL,
    "responsibilitiesMustNot" JSONB NOT NULL,
    "companyRules" JSONB NOT NULL,
    "expectations" JSONB,
    "notes" JSONB,
    "visibility" "JDVisibility" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobDescription_accountId_key" ON "JobDescription"("accountId");

-- CreateIndex
CREATE INDEX "JobDescription_designation_idx" ON "JobDescription"("designation");

-- CreateIndex
CREATE INDEX "JobDescription_visibility_idx" ON "JobDescription"("visibility");

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
