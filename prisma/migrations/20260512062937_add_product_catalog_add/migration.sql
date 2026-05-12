-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'ERROR', 'OUTDATED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('PUBLISHED', 'DRAFT', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('ONE_TIME', 'SUBSCRIPTION', 'USAGE', 'CUSTOM');

-- CreateTable
CREATE TABLE "AnalyticsDailyRollup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "path" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "deviceType" TEXT,
    "referrerType" TEXT,
    "utmSource" TEXT,
    "utmCampaign" TEXT,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "newVisitors" INTEGER NOT NULL DEFAULT 0,
    "returningVisitors" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "totalDurationSec" INTEGER NOT NULL DEFAULT 0,
    "avgLcp" DOUBLE PRECISION,
    "avgCls" DOUBLE PRECISION,
    "avgFcp" DOUBLE PRECISION,
    "avgTtfb" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDailyRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCatalog" (
    "id" TEXT NOT NULL,
    "adminProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subtitle" TEXT,
    "shortDesc" TEXT,
    "description" TEXT,
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'ONE_TIME',
    "basePrice" DECIMAL(18,2),
    "discountPercent" DOUBLE PRECISION DEFAULT 0,
    "discountAmount" DECIMAL(18,2),
    "finalPrice" DECIMAL(18,2),
    "introVideoId" TEXT,
    "detailedVideoId" TEXT,
    "demoUrl" TEXT,
    "downloadUrl" TEXT,
    "trialAvailable" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "isTopProduct" BOOLEAN NOT NULL DEFAULT false,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "metadata" JSONB,
    "categorySlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "industrySlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tagSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncHash" TEXT,
    "syncedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastSyncAttempt" TIMESTAMP(3),
    "syncError" TEXT,
    "syncVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "internalNotes" TEXT,
    "salesPriority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCatalogSyncLog" (
    "id" TEXT NOT NULL,
    "adminProductId" TEXT NOT NULL,
    "productCatalogId" TEXT,
    "action" TEXT NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL,
    "error" TEXT,
    "changedFields" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCatalogSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_date_idx" ON "AnalyticsDailyRollup"("date");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_date_path_idx" ON "AnalyticsDailyRollup"("date", "path");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_date_country_idx" ON "AnalyticsDailyRollup"("date", "country");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_date_deviceType_idx" ON "AnalyticsDailyRollup"("date", "deviceType");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_date_utmCampaign_idx" ON "AnalyticsDailyRollup"("date", "utmCampaign");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_date_referrerType_idx" ON "AnalyticsDailyRollup"("date", "referrerType");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailyRollup_date_path_country_deviceType_referrerT_key" ON "AnalyticsDailyRollup"("date", "path", "country", "deviceType", "referrerType", "utmSource", "utmCampaign");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCatalog_adminProductId_key" ON "ProductCatalog"("adminProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCatalog_slug_key" ON "ProductCatalog"("slug");

-- CreateIndex
CREATE INDEX "ProductCatalog_adminProductId_idx" ON "ProductCatalog"("adminProductId");

-- CreateIndex
CREATE INDEX "ProductCatalog_slug_idx" ON "ProductCatalog"("slug");

-- CreateIndex
CREATE INDEX "ProductCatalog_syncStatus_idx" ON "ProductCatalog"("syncStatus");

-- CreateIndex
CREATE INDEX "ProductCatalog_status_idx" ON "ProductCatalog"("status");

-- CreateIndex
CREATE INDEX "ProductCatalog_syncedAt_idx" ON "ProductCatalog"("syncedAt");

-- CreateIndex
CREATE INDEX "ProductCatalog_sourceUpdatedAt_idx" ON "ProductCatalog"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "ProductCatalogSyncLog_adminProductId_idx" ON "ProductCatalogSyncLog"("adminProductId");

-- CreateIndex
CREATE INDEX "ProductCatalogSyncLog_syncStatus_idx" ON "ProductCatalogSyncLog"("syncStatus");

-- CreateIndex
CREATE INDEX "ProductCatalogSyncLog_createdAt_idx" ON "ProductCatalogSyncLog"("createdAt");
