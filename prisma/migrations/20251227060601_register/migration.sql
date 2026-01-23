/*
  Warnings:

  - A unique constraint covering the columns `[contactEmail]` on the table `RegistrationRequest` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contactPhone]` on the table `RegistrationRequest` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "RegistrationRequest_accountId_idx";

-- AlterTable
ALTER TABLE "RegistrationRequest" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationRequest_contactEmail_key" ON "RegistrationRequest"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationRequest_contactPhone_key" ON "RegistrationRequest"("contactPhone");
