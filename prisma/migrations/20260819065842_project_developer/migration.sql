-- CreateEnum
CREATE TYPE "ProjectSource" AS ENUM ('INHOUSE', 'OUTSOURCE');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "outsourceDeveloperId" TEXT,
ADD COLUMN     "projectSource" "ProjectSource" NOT NULL DEFAULT 'INHOUSE';

-- CreateTable
CREATE TABLE "OutsourceDeveloper" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "skills" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutsourceDeveloper_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutsourceDeveloper_deletedAt_idx" ON "OutsourceDeveloper"("deletedAt");

-- CreateIndex
CREATE INDEX "OutsourceDeveloper_isActive_idx" ON "OutsourceDeveloper"("isActive");

-- CreateIndex
CREATE INDEX "Project_projectSource_idx" ON "Project"("projectSource");

-- CreateIndex
CREATE INDEX "Project_outsourceDeveloperId_idx" ON "Project"("outsourceDeveloperId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_outsourceDeveloperId_fkey" FOREIGN KEY ("outsourceDeveloperId") REFERENCES "OutsourceDeveloper"("id") ON DELETE SET NULL ON UPDATE CASCADE;
