-- CreateEnum
CREATE TYPE "ExpertiseLevel" AS ENUM ('EXPERT', 'CAN_DEMO', 'LEARNING', 'GUIDANCE_NEEDED', 'NONE');

-- CreateTable
CREATE TABLE "UserProductExpertise" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productCatalogId" TEXT NOT NULL,
    "expertiseLevel" "ExpertiseLevel" NOT NULL DEFAULT 'NONE',
    "yearsOfExperience" INTEGER,
    "completedProjects" INTEGER NOT NULL DEFAULT 0,
    "leadsConverted" INTEGER NOT NULL DEFAULT 0,
    "demoCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "certifications" JSONB,
    "skills" JSONB,
    "notes" TEXT,
    "lastDemoAt" TIMESTAMP(3),
    "lastLeadAt" TIMESTAMP(3),
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProductExpertise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserProductExpertise_userId_idx" ON "UserProductExpertise"("userId");

-- CreateIndex
CREATE INDEX "UserProductExpertise_productCatalogId_idx" ON "UserProductExpertise"("productCatalogId");

-- CreateIndex
CREATE INDEX "UserProductExpertise_expertiseLevel_idx" ON "UserProductExpertise"("expertiseLevel");

-- CreateIndex
CREATE INDEX "UserProductExpertise_successRate_idx" ON "UserProductExpertise"("successRate");

-- CreateIndex
CREATE INDEX "UserProductExpertise_leadsConverted_idx" ON "UserProductExpertise"("leadsConverted");

-- CreateIndex
CREATE UNIQUE INDEX "UserProductExpertise_userId_productCatalogId_key" ON "UserProductExpertise"("userId", "productCatalogId");

-- AddForeignKey
ALTER TABLE "UserProductExpertise" ADD CONSTRAINT "UserProductExpertise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProductExpertise" ADD CONSTRAINT "UserProductExpertise_productCatalogId_fkey" FOREIGN KEY ("productCatalogId") REFERENCES "ProductCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
