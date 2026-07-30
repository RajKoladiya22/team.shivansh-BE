/*
  Warnings:

  - A unique constraint covering the columns `[portalId]` on the table `CustomerPortalToken` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CustomerPortalToken" ADD COLUMN     "pin" TEXT,
ADD COLUMN     "portalId" TEXT,
ADD COLUMN     "rawToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalToken_portalId_key" ON "CustomerPortalToken"("portalId");

-- CreateIndex
CREATE INDEX "CustomerPortalToken_portalId_idx" ON "CustomerPortalToken"("portalId");
