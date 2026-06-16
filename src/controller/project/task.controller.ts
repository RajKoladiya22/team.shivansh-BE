import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

async function verifyWipLimit(stepId: string | null, projectId: string | null, excludeTaskId?: string): Promise<string | null> {
  if (!stepId) return null;
  const step = await prisma.pipelineStep.findUnique({
    where: { id: stepId },
    select: { id: true, wipLimit: true, name: true },
  });
  if (!step || step.wipLimit <= 0) return null;

  const count = await prisma.task.count({
    where: {
      stepId: step.id,
      deletedAt: null,
      NOT: excludeTaskId ? { id: excludeTaskId } : undefined,
    },
  });

  if (count >= step.wipLimit) {
    return `WIP limit of ${step.wipLimit} reached for step "${step.name}".`;
  }
  return null;
}

/* =========================================================
   CREATE CUSTOM TASK IN PROJECT
========================================================= */
export async function createProjectTask(req: Request, res: Response) {
  try {
    const { projectId } = req.params;
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const {
      stepId,
      title,
      description,
      priority = "NONE",
      dueDate,
      assignments = [],
    } = req.body;

    if (!title?.trim()) {
      return sendErrorResponse(res, 400, "Task title is required");
    }

    // Enforce WIP limit
    if (stepId) {
      const wipError = await verifyWipLimit(stepId, projectId);
      if (wipError) return sendErrorResponse(res, 400, wipError);
    }

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          projectId,
          stepId: stepId || null,
          title: title.trim(),
          description: description || null,
          priority: priority,
          dueDate: dueDate ? new Date(dueDate) : null,
          createdBy: accountId,
        },
      });

      if (Array.isArray(assignments) && assignments.length > 0) {
        await tx.taskAssignment.createMany({
          data: assignments.map((a: any) => ({
            taskId: created.id,
            type: a.type,
            accountId: a.type === "ACCOUNT" ? a.accountId : null,
            teamId: a.type === "TEAM" ? a.teamId : null,
          })),
        });
      }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: created.id,
          action: "CREATED",
          performedBy: accountId,
          projectId,
          taskId: created.id,
        },
      });

      return created;
    });

    return sendSuccessResponse(res, 201, "Task created", task);
  } catch (error: any) {
    console.error("[createProjectTask]", error);
    return sendErrorResponse(res, 500, error.message || "Failed to create task");
  }
}

/* =========================================================
   ASSIGN / REASSIGN TASK
========================================================= */
export async function assignTask(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const { assignments } = req.body;
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return sendErrorResponse(res, 400, "Assignments are required");
    }

    await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task) throw new Error("Task not found");

      await tx.taskAssignment.deleteMany({ where: { taskId } });

      await tx.taskAssignment.createMany({
        data: assignments.map((a: any) => ({
          taskId,
          type: a.type,
          accountId: a.type === "ACCOUNT" ? a.accountId : null,
          teamId: a.type === "TEAM" ? a.teamId : null,
        })),
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "ASSIGNED",
          performedBy: accountId,
          projectId: task.projectId,
          taskId,
          toState: { assignments },
        },
      });
    });

    return sendSuccessResponse(res, 200, "Task assigned successfully");
  } catch (error: any) {
    console.error("[assignTask]", error);
    return sendErrorResponse(res, 500, error.message || "Failed to assign task");
  }
}
