-- CreateTable
CREATE TABLE "CustomerPortalToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT DEFAULT 'Primary Access Link',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPortalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalAuditLog" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPortalAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalToken_tokenHash_key" ON "CustomerPortalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerPortalToken_customerId_idx" ON "CustomerPortalToken"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPortalToken_tokenHash_idx" ON "CustomerPortalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerPortalToken_isActive_idx" ON "CustomerPortalToken"("isActive");

-- CreateIndex
CREATE INDEX "CustomerPortalAuditLog_customerId_idx" ON "CustomerPortalAuditLog"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPortalAuditLog_action_idx" ON "CustomerPortalAuditLog"("action");

-- CreateIndex
CREATE INDEX "CustomerPortalAuditLog_createdAt_idx" ON "CustomerPortalAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "CustomerPortalToken" ADD CONSTRAINT "CustomerPortalToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPortalAuditLog" ADD CONSTRAINT "CustomerPortalAuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
