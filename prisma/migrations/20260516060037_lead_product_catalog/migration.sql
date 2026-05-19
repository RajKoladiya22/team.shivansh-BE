-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_productCatalogId_fkey";

-- AlterTable
ALTER TABLE "UserProductExpertise" ADD COLUMN     "leadsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "_LeadToProductCatalog" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LeadToProductCatalog_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_LeadToProductCatalog_B_index" ON "_LeadToProductCatalog"("B");

-- AddForeignKey
ALTER TABLE "_LeadToProductCatalog" ADD CONSTRAINT "_LeadToProductCatalog_A_fkey" FOREIGN KEY ("A") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LeadToProductCatalog" ADD CONSTRAINT "_LeadToProductCatalog_B_fkey" FOREIGN KEY ("B") REFERENCES "ProductCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
