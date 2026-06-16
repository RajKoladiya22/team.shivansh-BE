-- AnalyticsSession
ALTER TABLE "AnalyticsSession"
ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AnalyticsPageView
ALTER TABLE "AnalyticsPageView"
ADD COLUMN IF NOT EXISTS "engagementTimeSec" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AnalyticsPageView"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS
"AnalyticsPageView_idempotencyKey_key"
ON "AnalyticsPageView"("idempotencyKey");

-- AnalyticsEvent
ALTER TABLE "AnalyticsEvent"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS
"AnalyticsEvent_idempotencyKey_key"
ON "AnalyticsEvent"("idempotencyKey");

DO $$
BEGIN
    ALTER TYPE "CloudServiceActivityAction"
    ADD VALUE 'RENEWAL_CANCELLED';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;