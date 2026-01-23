-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'REMOTE', 'CONTRACT', 'FREELANCE', 'PART_TIME', 'INTERNSHIP', 'TEMPORARY');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "jobType" "JobType";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;
