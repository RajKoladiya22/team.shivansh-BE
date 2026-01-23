// src/controller/admin/task.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";


// POST /task/admin/create
export async function createTaskAdmin(req: Request, res: Response) {
  try {
    const creatorId = req.user?.id;
    if (!creatorId) return sendErrorResponse(res, 401, "Unauthorized");

    // Check if user has admin role
    const isAdmin = req.user?.roles?.includes("ADMIN");
    if (!isAdmin) return sendErrorResponse(res, 403, "Admin access required");

    const {
      title,
      description,
      priority = 1,
      startDate,
      dueDate,
      isRecurring,
      recurrenceType,
      recurrenceRule,
      accountIds,
      teamIds,
      projectId,
      stepId,
      parentTaskId,
    } = req.body;

    if (!title || title.trim().length === 0) {
      return sendErrorResponse(
        res,
        400,
        "Title is required and cannot be empty"
      );
    }
    if (!accountIds?.length && !teamIds?.length)
      return sendErrorResponse(
        res,
        400,
        "Assign to at least one employee or team"
      );

    // Validate assigned teams exist
    if (teamIds?.length) {
      const existingTeams = await prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true },
      });

      if (existingTeams.length !== teamIds.length) {
        return sendErrorResponse(
          res,
          400,
          "One or more assigned teams do not exist"
        );
      }
    }

    // Validate due date
    if (dueDate && new Date(dueDate) < new Date()) {
      return sendErrorResponse(res, 400, "Due date cannot be in the past");
    }

    const task = await prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          title,
          description,
          priority,
          startDate: startDate ? new Date(startDate) : undefined,
          dueDate: dueDate ? new Date(dueDate) : undefined,

          isRecurring: Boolean(isRecurring),
          recurrenceType,
          recurrenceRule,

          projectId,
          stepId,
          parentTaskId,

          createdBy: creatorId,
        },
      });

      const assignmentData = [
        ...(accountIds?.map((accId: string) => ({
          taskId: newTask.id,
          type: "ACCOUNT" as const,
          accountId: accId,
          assignedBy: creatorId,
          assignedAt: new Date(),
        })) || []),
        ...(teamIds?.map((tmId: string) => ({
          taskId: newTask.id,
          type: "TEAM",
          teamId: tmId,
          assignedBy: creatorId,
          assignedAt: new Date(),
        })) || []),
      ];

      if (assignmentData.length) {
        await tx.taskAssignment.createMany({
          data: assignmentData,
        });
      }

      //   if (accountIds?.length) {
      //     await tx.notification.createMany({
      //       data: accountIds.map((accountId) => ({
      //         accountId,
      //         title: "New Task Assigned",
      //         message: `You have been assigned a new task: ${title}`,
      //         type: "TASK_ASSIGNED",
      //         referenceId: newTask.id,
      //         referenceType: "TASK",
      //       })),
      //     });
      //   }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: newTask.id,
          action: "CREATED",
          performedBy: creatorId,
          meta: {
            title,
            priority,
            assignments: assignmentData.length,
          },
        },
      });

      return newTask;
    });

    return sendSuccessResponse(
      res,
      201,
      "Task created and assigned successfully",
      task
    );
  } catch (err) {
    console.error("Create task error:", err);
    return sendErrorResponse(res, 500, "Failed to create task");
  }
}

// PATCH /task/admin/update/:id
export async function updateTaskAdmin(req: Request, res: Response) {
  try {
    const adminId = req.user?.id;
    if (!adminId) return sendErrorResponse(res, 401, "Unauthorized");

    // Check admin role
    const isAdmin = req.user?.roles?.includes("ADMIN");
    if (!isAdmin) return sendErrorResponse(res, 403, "Admin access required");
    const { id } = req.params;

    const data: any = {};
    const allowedFields = [
      "title",
      "description",
      "priority",
      "startDate",
      "dueDate",
      "status",
    ];

    allowedFields.forEach((f) => {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    });

    // Validate task exists and not deleted
    const existingTask = await prisma.task.findUnique({
      where: { id, deletedAt: null },
    });

    if (!existingTask) {
      return sendErrorResponse(res, 404, "Task not found");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id },
        data: data,
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: id,
          action: "ADMIN_UPDATED",
          meta: data,
          performedBy: adminId,
          fromState: existingTask,
          toState: updatedTask,
        },
      });

      return updatedTask;
    });

    return sendSuccessResponse(res, 200, "Task updated", updated);
  } catch (err: any) {
    if (err.code === "P2025")
      return sendErrorResponse(res, 404, "Task not found");
    return sendErrorResponse(res, 500, "Failed to update task");
  }
}

// DELETE /task/admin/delete/:id
export async function deleteTask(req: Request, res: Response) {
  try {
    const { id } = req.params;

    await prisma.task.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "CANCELLED",
      },
    });

    return sendSuccessResponse(res, 200, "Task removed");
  } catch {
    return sendErrorResponse(res, 500, "Failed to delete task");
  }
}
