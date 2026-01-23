-- AddForeignKey
ALTER TABLE "LeadActivityLog" ADD CONSTRAINT "LeadActivityLog_performedBy_fkey" FOREIGN KEY ("performedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
