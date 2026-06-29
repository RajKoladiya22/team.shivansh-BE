-- Backfill billingDate based on purchaseDate and renewalType
-- Set billingDate to the 1st day of the month of the calculated expiry date
UPDATE "CloudService"
SET "billingDate" = DATE_TRUNC('month', 
    "purchaseDate" + 
    CASE 
        WHEN "renewalType" = 'QUARTERLY' THEN INTERVAL '3 months'
        WHEN "renewalType" = 'SIX_MONTHS' THEN INTERVAL '6 months'
        WHEN "renewalType" = 'YEARLY' THEN INTERVAL '1 year'
        ELSE INTERVAL '1 year'
    END
)
WHERE "purchaseDate" IS NOT NULL;