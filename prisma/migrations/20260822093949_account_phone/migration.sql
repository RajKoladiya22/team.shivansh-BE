-- DropIndex
DROP INDEX "Account_contactPhone_key";

-- CreateIndex
CREATE INDEX "Account_contactPhone_idx" ON "Account"("contactPhone");
