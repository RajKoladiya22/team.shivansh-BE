-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('DESKTOP', 'MOBILE', 'TABLET', 'BOT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('CLICK', 'FORM', 'MEDIA', 'NAVIGATION', 'SCROLL', 'CONVERSION', 'ERROR', 'CUSTOM');

-- CreateTable
CREATE TABLE "AnalyticsVisitor" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "cookieId" TEXT,
    "accountId" TEXT,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "pageViewCount" INTEGER NOT NULL DEFAULT 0,
    "isReturning" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "country" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "initialReferrer" TEXT,
    "initialReferrerHost" TEXT,
    "initialUtmSource" TEXT,
    "initialUtmMedium" TEXT,
    "initialUtmCampaign" TEXT,

    CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "entryPage" TEXT,
    "exitPage" TEXT,
    "referrer" TEXT,
    "referrerHost" TEXT,
    "referrerType" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "browser" TEXT,
    "browserVersion" TEXT,
    "os" TEXT,
    "osVersion" TEXT,
    "deviceBrand" TEXT,
    "deviceModel" TEXT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "viewportWidth" INTEGER,
    "viewportHeight" INTEGER,
    "ip" TEXT,
    "ipHashed" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT,
    "language" TEXT,
    "pageViewCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "bounced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsPageView" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" TEXT,
    "hash" TEXT,
    "host" TEXT,
    "title" TEXT,
    "referrer" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeOnPageSec" INTEGER,
    "maxScrollPct" INTEGER,
    "isSpa" BOOLEAN NOT NULL DEFAULT false,
    "lcp" DOUBLE PRECISION,
    "fid" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "fcp" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,

    CONSTRAINT "AnalyticsPageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pageViewId" TEXT,
    "visitorId" TEXT NOT NULL,
    "category" "EventCategory" NOT NULL DEFAULT 'CUSTOM',
    "name" TEXT NOT NULL,
    "label" TEXT,
    "value" DOUBLE PRECISION,
    "elementTag" TEXT,
    "elementId" TEXT,
    "elementClass" TEXT,
    "elementText" TEXT,
    "elementHref" TEXT,
    "pagePath" TEXT,
    "meta" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

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

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsVisitor_fingerprint_key" ON "AnalyticsVisitor"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsVisitor_cookieId_key" ON "AnalyticsVisitor"("cookieId");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_accountId_idx" ON "AnalyticsVisitor"("accountId");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_isReturning_idx" ON "AnalyticsVisitor"("isReturning");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_firstSeenAt_idx" ON "AnalyticsVisitor"("firstSeenAt");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_lastSeenAt_idx" ON "AnalyticsVisitor"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_country_idx" ON "AnalyticsVisitor"("country");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_initialUtmSource_idx" ON "AnalyticsVisitor"("initialUtmSource");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_initialUtmCampaign_idx" ON "AnalyticsVisitor"("initialUtmCampaign");

-- CreateIndex
CREATE INDEX "AnalyticsSession_visitorId_idx" ON "AnalyticsSession"("visitorId");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_idx" ON "AnalyticsSession"("startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_endedAt_idx" ON "AnalyticsSession"("endedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_country_idx" ON "AnalyticsSession"("country");

-- CreateIndex
CREATE INDEX "AnalyticsSession_countryCode_idx" ON "AnalyticsSession"("countryCode");

-- CreateIndex
CREATE INDEX "AnalyticsSession_deviceType_idx" ON "AnalyticsSession"("deviceType");

-- CreateIndex
CREATE INDEX "AnalyticsSession_referrerType_idx" ON "AnalyticsSession"("referrerType");

-- CreateIndex
CREATE INDEX "AnalyticsSession_utmSource_idx" ON "AnalyticsSession"("utmSource");

-- CreateIndex
CREATE INDEX "AnalyticsSession_utmCampaign_idx" ON "AnalyticsSession"("utmCampaign");

-- CreateIndex
CREATE INDEX "AnalyticsSession_bounced_idx" ON "AnalyticsSession"("bounced");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_country_idx" ON "AnalyticsSession"("startedAt", "country");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_deviceType_idx" ON "AnalyticsSession"("startedAt", "deviceType");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_referrerType_idx" ON "AnalyticsSession"("startedAt", "referrerType");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_utmCampaign_idx" ON "AnalyticsSession"("startedAt", "utmCampaign");

-- CreateIndex
CREATE INDEX "AnalyticsSession_visitorId_startedAt_idx" ON "AnalyticsSession"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_countryCode_startedAt_idx" ON "AnalyticsSession"("countryCode", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_sessionId_idx" ON "AnalyticsPageView"("sessionId");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_visitorId_idx" ON "AnalyticsPageView"("visitorId");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_path_idx" ON "AnalyticsPageView"("path");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_viewedAt_idx" ON "AnalyticsPageView"("viewedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_host_idx" ON "AnalyticsPageView"("host");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_path_viewedAt_idx" ON "AnalyticsPageView"("path", "viewedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_host_path_idx" ON "AnalyticsPageView"("host", "path");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_visitorId_viewedAt_idx" ON "AnalyticsPageView"("visitorId", "viewedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_sessionId_viewedAt_idx" ON "AnalyticsPageView"("sessionId", "viewedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_path_lcp_idx" ON "AnalyticsPageView"("path", "lcp");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_path_cls_idx" ON "AnalyticsPageView"("path", "cls");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent"("sessionId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_visitorId_idx" ON "AnalyticsEvent"("visitorId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_pageViewId_idx" ON "AnalyticsEvent"("pageViewId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_idx" ON "AnalyticsEvent"("name");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_category_idx" ON "AnalyticsEvent"("category");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_category_occurredAt_idx" ON "AnalyticsEvent"("category", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_category_name_idx" ON "AnalyticsEvent"("category", "name");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_pagePath_name_idx" ON "AnalyticsEvent"("pagePath", "name");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_visitorId_occurredAt_idx" ON "AnalyticsEvent"("visitorId", "occurredAt");

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

-- AddForeignKey
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AnalyticsVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsPageView" ADD CONSTRAINT "AnalyticsPageView_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_pageViewId_fkey" FOREIGN KEY ("pageViewId") REFERENCES "AnalyticsPageView"("id") ON DELETE SET NULL ON UPDATE CASCADE;
