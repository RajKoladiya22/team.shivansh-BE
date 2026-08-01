-- AlterTable
ALTER TABLE "NotificationSubscription" ADD COLUMN     "customerId" TEXT,
ALTER COLUMN "accountId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "NotificationSubscription_customerId_idx" ON "NotificationSubscription"("customerId");

-- AddForeignKey
ALTER TABLE "NotificationSubscription" ADD CONSTRAINT "NotificationSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
