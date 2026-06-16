import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { AssignmentType, TaskStatus } from "@prisma/client";

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

async function createFanOutAssignments(
  tx: any,
  taskId: string,
  assignments: Array<{ type: string; accountId?: string | null; teamId?: string | null }>,
  assignedBy?: string | null
) {
  for (const a of assignments) {
    if (a.type === "TEAM" && a.teamId) {
      // 1. Create team assignment
      await tx.taskAssignment.create({
        data: {
          taskId,
          type: AssignmentType.TEAM,
          teamId: a.teamId,
          accountId: null,
          assignedBy: assignedBy ?? null,
          status: TaskStatus.PENDING,
        },
      });

      // 2. Fetch active members
      const members = await tx.teamMember.findMany({
        where: { teamId: a.teamId, isActive: true },
        select: { accountId: true },
      });

      // 3. Create assignments for each active member
      for (const member of members) {
        await tx.taskAssignment.create({
          data: {
            taskId,
            type: AssignmentType.ACCOUNT,
            teamId: a.teamId,
            accountId: member.accountId,
            assignedBy: assignedBy ?? null,
            status: TaskStatus.PENDING,
          },
        });
      }
    } else if (a.type === "ACCOUNT" && a.accountId) {
      await tx.taskAssignment.create({
        data: {
          taskId,
          type: AssignmentType.ACCOUNT,
          teamId: null,
          accountId: a.accountId,
          assignedBy: assignedBy ?? null,
          status: TaskStatus.PENDING,
        },
      });
    }
  }
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
        await createFanOutAssignments(
          tx,
          created.id,
          assignments,
          accountId
        );
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

      await createFanOutAssignments(
        tx,
        taskId,
        assignments,
        accountId
      );

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
