// src/controllers/project/task.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* =========================================================
   CREATE CUSTOM TASK IN PROJECT
========================================================= */
export async function createProjectTask(req: Request, res: Response) {
  try {
    const { projectId } = req.params;
    const user = (req as any).user;

    const {
      stepId,
      title,
      description,
      priority = 1,
      dueDate,
      assignments = [],
    } = req.body;

    if (!title) {
      return sendErrorResponse(res, 400, "Task title is required");
    }

    const task = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          projectId,
          stepId,
          title,
          description,
          priority,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          createdBy: user.id,
        },
      });

      if (Array.isArray(assignments) && assignments.length > 0) {
        await tx.taskAssignment.createMany({
          data: assignments.map((a: any) => ({
            taskId: task.id,
            type: a.type,
            accountId: a.type === "ACCOUNT" ? a.accountId : null,
            teamId: a.type === "TEAM" ? a.teamId : null,
          })),
        });
      }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: task.id,
          action: "CREATED",
          performedBy: user.id,
          projectId,
          snapshot: task,
        },
      });

      return task;
    });

    sendSuccessResponse(res, 201, "Task created", task);
  } catch (error) {
    console.error(error);
    sendErrorResponse(res, 500, "Failed to create task");
  }
}


/* =========================================================
   ASSIGN / REASSIGN TASK
========================================================= */
export async function assignTask(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const { assignments } = req.body;
    const user = (req as any).user;

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
          performedBy: user.id,
          projectId: task.projectId,
          fromState: { assignments: "cleared" },
          toState: { assignments },
        },
      });
    });

    sendSuccessResponse(res, 200, "Task assigned successfully");
  } catch (error: any) {
    console.error(error);
    sendErrorResponse(res, 500, error.message || "Failed to assign task");
  }
}
