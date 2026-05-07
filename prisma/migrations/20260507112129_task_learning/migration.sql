-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "isLearning" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Task_deletedAt_status_idx" ON "Task"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "Task_projectId_deletedAt_idx" ON "Task"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_projectId_deletedAt_status_idx" ON "Task"("projectId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Task_dueDate_status_idx" ON "Task"("dueDate", "status");

-- CreateIndex
CREATE INDEX "Task_createdAt_status_idx" ON "Task"("createdAt", "status");
