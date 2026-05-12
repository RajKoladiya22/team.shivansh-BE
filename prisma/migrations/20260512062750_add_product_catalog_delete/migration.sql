/*
  Warnings:

  - You are about to drop the `AnalyticsDailyRollup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductCatalog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductCatalogSyncLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "AnalyticsDailyRollup";

-- DropTable
DROP TABLE "ProductCatalog";

-- DropTable
DROP TABLE "ProductCatalogSyncLog";

-- DropEnum
DROP TYPE "PricingModel";

-- DropEnum
DROP TYPE "ProductStatus";

-- DropEnum
DROP TYPE "SyncStatus";
