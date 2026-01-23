// src/controller/user/task.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

// POST /task/self
export async function createSelfTask(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { title, description, priority = 1, startDate, dueDate } = req.body;

    if (!title || title.trim().length === 0) {
      return sendErrorResponse(res, 400, "Title is required");
    }

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
          createdBy: accountId,
          isSelfTask: true,
        },
      });

      await tx.taskAssignment.create({
        data: {
          taskId: newTask.id,
          type: "ACCOUNT",
          accountId,
          assignedBy: accountId,
          assignedAt: new Date(),
        },
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: newTask.id,
          action: "SELF_CREATED",
          performedBy: accountId,
          meta: { title, priority },
        },
      });

      return newTask;
    });

    return sendSuccessResponse(
      res,
      201,
      "Personal task created successfully",
      task,
    );
  } catch (err) {
    console.error("Create self-task error:", err);
    return sendErrorResponse(res, 500, "Failed to create personal task");
  }
}

// GET /task/my
// export async function getMyTasks(req: Request, res: Response) {
//   try {
//     const accountId = req.user?.id;
//     if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

//     const {
//       status,
//       priority,
//       search,
//       limit = 20,
//       page = 1,
//       sortBy = "dueDate",
//       sortOrder = "asc",
//     } = req.query;

//     const where: any = {
//       deletedAt: null,
//       OR: [
//         {
//           assignments: {
//             some: {
//               accountId,
//               type: "ACCOUNT",
//             },
//           },
//         },
//         {
//           assignments: {
//             some: {
//               team: {
//                 members: {
//                   some: { accountId },
//                 },
//               },
//             },
//           },
//         },
//       ],
//     };

//     if (status) where.status = status;
//     if (priority) where.priority = priority;
//     if (search) {
//       where.OR = [
//         { title: { contains: String(search), mode: "insensitive" } },
//         { description: { contains: String(search), mode: "insensitive" } },
//       ];
//     }

//     console.log("\n\n\nwhere\n", where);

//     const [tasks, total] = await Promise.all([
//       prisma.task.findMany({
//         where,
//         include: {
//           assignments: {
//             include: {
//               account: {
//                 select: { id: true, firstName: true, contactEmail: true },
//               },
//               team: {
//                 select: { id: true, name: true },
//               },
//             },
//           },
//           //   createdBy: {
//           //     select: { id: true, firstName: true, contactEmail: true }
//           //   }
//         },
//         take: Math.min(Number(limit), 100), // Cap at 100
//         skip: (Number(page) - 1) * Number(limit),
//         orderBy: { [String(sortBy)]: sortOrder === "desc" ? "desc" : "asc" },
//       }),
//       prisma.task.count({ where }),
//     ]);

//     // return sendSuccessResponse(res, 200, "My tasks fetched", tasks);
//     return sendSuccessResponse(res, 200, "Tasks fetched successfully", {
//       tasks,
//       pagination: {
//         total,
//         page: Number(page),
//         limit: Number(limit),
//         totalPages: Math.ceil(total / Number(limit)),
//         hasMore: Number(page) * Number(limit) < total,
//       },
//     });
//   } catch {
//     return sendErrorResponse(res, 500, "Failed to fetch tasks");
//   }
// }
export async function getMyTasks(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      status,
      priority,
      search,
      limit = 20,
      page = 1,
      sortBy = "dueDate",
      sortOrder = "asc",
    } = req.query;

    // MAIN VISIBILITY FILTER — must never be overwritten
    const visibilityFilter = {
      OR: [
        {
          assignments: {
            some: {
              accountId,
              type: "ACCOUNT",
            },
          },
        },
        {
          assignments: {
            some: {
              team: {
                members: {
                  some: { accountId },
                },
              },
            },
          },
        },
      ],
    };

    // FINAL WHERE CLAUSE WITH PRESERVED LOGIC
    const where: any = {
      deletedAt: null,
      AND: [visibilityFilter],
    };

    if (status) {
      where.AND.push({ status });
    }

    if (priority) {
      where.AND.push({ priority });
    }

    if (search) {
      where.AND.push({
        OR: [
          { title: { contains: String(search), mode: "insensitive" } },
          { description: { contains: String(search), mode: "insensitive" } },
        ],
      });
    }

    console.log("\n\n\nFINAL WHERE\n", JSON.stringify(where, null, 2));

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          assignments: {
            include: {
              account: {
                select: { id: true, firstName: true, contactEmail: true },
              },
              team: {
                select: { id: true, name: true },
              },
            },
          },
        },
        take: Math.min(Number(limit), 100),
        skip: (Number(page) - 1) * Number(limit),
        orderBy: { [String(sortBy)]: sortOrder === "desc" ? "desc" : "asc" },
      }),
      prisma.task.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Tasks fetched successfully", {
      tasks,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
        hasMore: Number(page) * Number(limit) < total,
      },
    });
  } catch (error) {
    console.error(error);
    return sendErrorResponse(res, 500, "Failed to fetch tasks");
  }
}

// PATCH /task/update-status
export async function updateTaskStatus(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    const { taskId, status, note } = req.body;

    if (!taskId || !status)
      return sendErrorResponse(res, 400, "taskId and status are required");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      include: {
        assignments: true,
      },
    });

    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const isAssignee = task.assignments.some((a) => a.accountId === accountId);
    const isAdmin = req.user?.roles?.includes("ADMIN");
    if (!isAssignee && !isAdmin)
      return sendErrorResponse(res, 403, "Not authorized");

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          status,
          ...(status === "COMPLETED" && { completedAt: new Date() }),
        },
      });

      if (isAssignee) {
        await tx.taskAssignment.updateMany({
          where: { taskId, accountId },
          data: { status, note, updatedAt: new Date() },
        });
      }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "STATUS_UPDATED",
          performedBy: accountId,
          meta: {
            status,
            note,
            isAdminUpdate: isAdmin && !isAssignee,
          },
          fromState: { status: task.status },
          toState: { status },
        },
      });

      //   if (status === "COMPLETED" && task.createdBy !== accountId) {
      //     await tx.notification.create({
      //       data: {
      //         accountId: task.createdBy,
      //         title: "Task Completed",
      //         message: `Task "${task.title}" has been marked as completed`,
      //         type: "TASK_COMPLETED",
      //         referenceId: taskId,
      //         referenceType: "TASK",
      //       },
      //     });
      //   }

      return updatedTask;
    });

    return sendSuccessResponse(
      res,
      200,
      "Task status updated successfully",
      updated,
    );
  } catch {
    return sendErrorResponse(res, 500, "Failed to update status");
  }
}

// GET /task/kanban
export async function getKanbanTasks(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    const isAdmin = req.user?.roles?.includes("ADMIN");

    const where: any = { deletedAt: null };

    if (!isAdmin) {
      where.assignments = {
        some: { accountId },
      };
    }

    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const grouped: Record<string, (typeof tasks)[number][]> = {
      PENDING: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      COMPLETED: [],
      CANCELLED: [],
    };

    tasks.forEach((t) => grouped[t.status].push(t));

    return sendSuccessResponse(res, 200, "Kanban data", grouped);
  } catch {
    return sendErrorResponse(res, 500, "Failed to load kanban board");
  }
}

// GET /task/history/:id
export async function getTaskHistory(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const logs = await prisma.activityLog.findMany({
      where: { entityType: "TASK", entityId: id },
      orderBy: { createdAt: "asc" },
    });

    return sendSuccessResponse(res, 200, "Task history fetched", logs);
  } catch {
    return sendErrorResponse(res, 500, "Failed to fetch task history");
  }
}

export async function getTaskDetails(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    const { id } = req.params;

    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      include: {
        assignments: {
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                contactEmail: true,
                avatar: true,
              },
            },
            team: {
              select: {
                id: true,
                name: true,
                members: { select: { accountId: true } },
              },
            },
          },
        },
        // createdByUser: {
        //   select: { id: true, name: true, email: true }
        // },
        project: {
          select: { id: true, name: true },
        },
        parentTask: {
          select: { id: true, title: true },
        },
        subTasks: {
          where: { deletedAt: null },
          select: { id: true, title: true, status: true },
        },
      },
    });

    if (!task) return sendErrorResponse(res, 404, "Task not found");

    // Check permission
    const isAssignee = task.assignments.some(
      (a) =>
        a.accountId === accountId ||
        a.team?.members?.some((m) => m.accountId === accountId),
    );
    const isCreator = task.createdBy === accountId;
    const isAdmin = req.user?.roles?.includes("ADMIN");

    if (!isAssignee && !isCreator && !isAdmin) {
      return sendErrorResponse(res, 403, "Not authorized to view this task");
    }

    return sendSuccessResponse(res, 200, "Task details fetched", task);
  } catch (err: any) {
    console.error("Get task details error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch task details");
  }
}
