/*
  Warnings:

  - You are about to drop the column `defaultTasks` on the `PipelineTemplateStep` table. All the data in the column will be lost.
  - You are about to drop the column `templateId` on the `ProjectPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `refId` on the `TaskAssignment` table. All the data in the column will be lost.
  - You are about to drop the column `standaloneTaskId` on the `TaskAssignment` table. All the data in the column will be lost.
  - You are about to drop the `StandaloneTask` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "TemplateAssignmentStrategy" AS ENUM ('SPECIFIC_USER', 'PROJECT_ROLE', 'POOL');

-- DropForeignKey
ALTER TABLE "TaskAssignment" DROP CONSTRAINT "TaskAssignment_standaloneTaskId_fkey";

-- DropIndex
DROP INDEX "TaskAssignment_refId_idx";

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "fromState" JSONB,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "toState" JSONB;

-- AlterTable
ALTER TABLE "PipelineStep" ADD COLUMN     "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "templateStepId" TEXT;

-- AlterTable
ALTER TABLE "PipelineTemplateStep" DROP COLUMN "defaultTasks",
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectPipeline" DROP COLUMN "templateId",
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "sourceTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "recurrenceRule" JSONB,
ADD COLUMN     "recurrenceType" "TaskRecurrenceType" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "templateTaskId" TEXT,
ALTER COLUMN "priority" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "TaskAssignment" DROP COLUMN "refId",
DROP COLUMN "standaloneTaskId",
ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "teamId" TEXT;

-- DropTable
DROP TABLE "StandaloneTask";

-- CreateTable
CREATE TABLE "PipelineTemplateTask" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "offsetDays" INTEGER DEFAULT 0,
    "defaultAssignmentStrategy" "TemplateAssignmentStrategy",
    "defaultRoleId" TEXT,

    CONSTRAINT "PipelineTemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineTemplateTask_stepId_idx" ON "PipelineTemplateTask"("stepId");

-- CreateIndex
CREATE INDEX "Task_stepId_idx" ON "Task"("stepId");

-- CreateIndex
CREATE INDEX "TaskAssignment_accountId_idx" ON "TaskAssignment"("accountId");

-- CreateIndex
CREATE INDEX "TaskAssignment_teamId_idx" ON "TaskAssignment"("teamId");

-- AddForeignKey
ALTER TABLE "PipelineTemplateTask" ADD CONSTRAINT "PipelineTemplateTask_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineTemplateStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
