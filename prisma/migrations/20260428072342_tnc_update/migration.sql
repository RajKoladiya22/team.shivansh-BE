/*
  Warnings:

  - A unique constraint covering the columns `[tncToken]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "isTncAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tncAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "tncToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tncToken_key" ON "Customer"("tncToken");
