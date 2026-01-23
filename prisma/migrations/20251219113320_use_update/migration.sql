/*
  Warnings:

  - You are about to drop the column `refreshToken` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "avatar" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "refreshToken";
