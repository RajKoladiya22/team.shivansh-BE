/*
  Warnings:

  - You are about to drop the column `lineItems` on the `Quotation` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaxType" ADD VALUE 'CGST';
ALTER TYPE "TaxType" ADD VALUE 'SGST';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "productCatalogId" TEXT;

-- AlterTable
ALTER TABLE "Quotation" DROP COLUMN "lineItems";

-- CreateTable
CREATE TABLE "CustomerProduct" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productCatalogId" TEXT,
    "productTitle" TEXT NOT NULL,
    "tallySerial" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "licenseKey" TEXT,
    "notes" TEXT,
    "meta" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLineItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productCatalogId" TEXT,
    "position" INTEGER NOT NULL,
    "productSlug" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsn" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "basePrice" DECIMAL(14,2) NOT NULL,
    "discountType" "DiscountType",
    "discountValue" DECIMAL(10,2),
    "discountedPrice" DECIMAL(14,2),
    "taxType" "TaxType" DEFAULT 'GST',
    "taxPercent" DECIMAL(5,2),
    "taxAmount" DECIMAL(14,2),
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "QuotationLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerProduct_customerId_idx" ON "CustomerProduct"("customerId");

-- CreateIndex
CREATE INDEX "CustomerProduct_productCatalogId_idx" ON "CustomerProduct"("productCatalogId");

-- CreateIndex
CREATE INDEX "QuotationLineItem_quotationId_idx" ON "QuotationLineItem"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationLineItem_productCatalogId_idx" ON "QuotationLineItem"("productCatalogId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_productCatalogId_fkey" FOREIGN KEY ("productCatalogId") REFERENCES "ProductCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_productCatalogId_fkey" FOREIGN KEY ("productCatalogId") REFERENCES "ProductCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLineItem" ADD CONSTRAINT "QuotationLineItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLineItem" ADD CONSTRAINT "QuotationLineItem_productCatalogId_fkey" FOREIGN KEY ("productCatalogId") REFERENCES "ProductCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
