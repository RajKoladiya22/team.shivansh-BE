-- AlterTable
ALTER TABLE "CustomerProduct" ADD COLUMN     "isExpired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPurchase" BOOLEAN NOT NULL DEFAULT false;
