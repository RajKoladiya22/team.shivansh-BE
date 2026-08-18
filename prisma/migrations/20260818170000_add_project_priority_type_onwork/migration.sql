-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('NEW_PROJECT', 'UPDATES');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "projectType" "ProjectType" NOT NULL DEFAULT 'UPDATES',
ADD COLUMN "onWork" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Project_priority_idx" ON "Project"("priority");

-- CreateIndex
CREATE INDEX "Project_projectType_idx" ON "Project"("projectType");

-- CreateIndex
CREATE INDEX "Project_onWork_idx" ON "Project"("onWork");
