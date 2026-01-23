-- DropForeignKey
ALTER TABLE "RegistrationRequest" DROP CONSTRAINT "RegistrationRequest_accountId_fkey";

-- AlterTable
ALTER TABLE "RegistrationRequest" ALTER COLUMN "accountId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RegistrationRequest" ADD CONSTRAINT "RegistrationRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
