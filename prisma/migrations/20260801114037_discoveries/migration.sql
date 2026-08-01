-- CreateEnum
CREATE TYPE "DiscoveryType" AS ENUM ('NEW_PRODUCT', 'FEATURE_UPDATE', 'WEBINAR', 'NEWS', 'ANNOUNCEMENT', 'YOUTUBE_VIDEO', 'BLOG', 'TUTORIAL', 'CASE_STUDY', 'EVENT', 'MAINTENANCE', 'RELEASE_NOTE', 'TIP', 'PROMOTION', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Discovery" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT,
    "content" TEXT,
    "discoveryType" "DiscoveryType" NOT NULL DEFAULT 'ANNOUNCEMENT',
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "youtubeUrl" TEXT,
    "externalUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "expireAt" TIMESTAMP(3),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryLike" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "discoveryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryComment" (
    "id" TEXT NOT NULL,
    "discoveryId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "parentId" TEXT,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryView" (
    "id" TEXT NOT NULL,
    "discoveryId" TEXT NOT NULL,
    "customerId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Discovery_slug_key" ON "Discovery"("slug");

-- CreateIndex
CREATE INDEX "Discovery_status_isPublished_publishAt_idx" ON "Discovery"("status", "isPublished", "publishAt");

-- CreateIndex
CREATE INDEX "Discovery_slug_idx" ON "Discovery"("slug");

-- CreateIndex
CREATE INDEX "Discovery_discoveryType_idx" ON "Discovery"("discoveryType");

-- CreateIndex
CREATE INDEX "DiscoveryLike_discoveryId_idx" ON "DiscoveryLike"("discoveryId");

-- CreateIndex
CREATE INDEX "DiscoveryLike_customerId_idx" ON "DiscoveryLike"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryLike_customerId_discoveryId_key" ON "DiscoveryLike"("customerId", "discoveryId");

-- CreateIndex
CREATE INDEX "DiscoveryComment_discoveryId_idx" ON "DiscoveryComment"("discoveryId");

-- CreateIndex
CREATE INDEX "DiscoveryComment_customerId_idx" ON "DiscoveryComment"("customerId");

-- CreateIndex
CREATE INDEX "DiscoveryView_discoveryId_idx" ON "DiscoveryView"("discoveryId");

-- AddForeignKey
ALTER TABLE "Discovery" ADD CONSTRAINT "Discovery_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discovery" ADD CONSTRAINT "Discovery_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLike" ADD CONSTRAINT "DiscoveryLike_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryLike" ADD CONSTRAINT "DiscoveryLike_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComment" ADD CONSTRAINT "DiscoveryComment_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComment" ADD CONSTRAINT "DiscoveryComment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryComment" ADD CONSTRAINT "DiscoveryComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DiscoveryComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryView" ADD CONSTRAINT "DiscoveryView_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "Discovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
