-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "productTitle" TEXT;

-- AlterTable
ALTER TABLE "LeadAssignment" ALTER COLUMN "unassignedAt" DROP NOT NULL,
ALTER COLUMN "unassignedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
