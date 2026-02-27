// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import {
//   sendErrorResponse,
//   sendSuccessResponse,
// } from "../../core/utils/httpResponse";

// export async function createAndAssignTask(req: Request, res: Response) {
//   try {
//     const userId = (req as any).user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     if (!user) return sendErrorResponse(res, 404, "User not found");

//     const {
//       projectId,
//       stepId,
//       title,
//       description,
//       status,
//       priority,
//       startDate,
//       dueDate,
//       isRecurring,
//       recurrenceType,
//       recurrenceRule,
//       assignUsers,
//       assignTeams,
//       parentTaskId,
//     } = req.body;

//     if (!title) return sendErrorResponse(res, 400, "title is required");

//     const taskData: any = {
//       title,
//       description,
//       status: status ?? "PENDING",
//       priority: priority ?? 1,
//       startDate: startDate ? new Date(startDate) : null,
//       dueDate: dueDate ? new Date(dueDate) : null,
//       isRecurring: !!isRecurring,
//       recurrenceType,
//       recurrenceRule,
//       createdBy: user.accountId,
//       parentTaskId,
//       projectId: projectId ?? null,
//       stepId: stepId ?? null,
//     };

//     const task = await prisma.task.create({ data: taskData });

//     await prisma.activityLog.create({
//       data: {
//         entityType: "TASK",
//         entityId: task.id,
//         action: "CREATED",
//         performedBy: user.accountId,
//         meta: { taskTitle: title },
//       },
//     });

//     const assignments: any[] = [];
//     if (Array.isArray(assignUsers)) {
//       for (const accountId of assignUsers) {
//         assignments.push({
//           taskId: task.id,
//           type: "ACCOUNT",
//           accountId,
//         });
//       }
//     }
//     if (Array.isArray(assignTeams)) {
//       for (const teamId of assignTeams) {
//         assignments.push({
//           taskId: task.id,
//           type: "TEAM",
//           teamId,
//         });
//       }
//     }

//     if (assignments.length) {
//       await prisma.taskAssignment.createMany({ data: assignments });

//       for (const a of assignments) {
//         await prisma.activityLog.create({
//           data: {
//             entityType: "TASK",
//             entityId: task.id,
//             action: "ASSIGNED",
//             performedBy: user.accountId,
//             meta: { accountId: a.accountId, teamId: a.teamId },
//           },
//         });
//       }
//     }

//     const created = await prisma.task.findUnique({
//       where: { id: task.id },
//       include: {
//         assignments: {
//           include: {
//             account: { select: { id: true, firstName: true, lastName: true } },
//             team: { select: { id: true, name: true } },
//           },
//         },
//       },
//     });

//     return sendSuccessResponse(res, 201, "Task created and assigned", {
//       task: created,
//     });
//   } catch (err) {
//     console.error(err);
//     return sendErrorResponse(res, 500, "Failed to create and assign task");
//   }
// }

// export async function getMyTasks(req: Request, res: Response) {
//   try {
//     const userId = (req as any).user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     if (!user) return sendErrorResponse(res, 404, "User not found");

//     const accountId = user.accountId;
//     const {
//       status,
//       startDateAfter,
//       startDateBefore,
//       dueDateAfter,
//       dueDateBefore,
//       priority,
//       projectId,
//       isRecurring,
//       page = 1,
//       limit = 20,
//     } = req.query;

//     const filters: any = {};
//     if (status) filters.status = status;
//     if (priority) filters.priority = Number(priority);
//     if (projectId) filters.projectId = projectId;
//     if (isRecurring !== undefined) filters.isRecurring = isRecurring === "true";

//     if (startDateAfter || startDateBefore) {
//       filters.startDate = {};
//       if (startDateAfter)
//         filters.startDate.gte = new Date(startDateAfter as string);
//       if (startDateBefore)
//         filters.startDate.lte = new Date(startDateBefore as string);
//     }
//     if (dueDateAfter || dueDateBefore) {
//       filters.dueDate = {};
//       if (dueDateAfter) filters.dueDate.gte = new Date(dueDateAfter as string);
//       if (dueDateBefore)
//         filters.dueDate.lte = new Date(dueDateBefore as string);
//     }

//     const isAdmin = userId.includes("ADMIN");

//     // console.log("\n\nisAdmin--------->\n", isAdmin);

//     let whereClause: any = {};

//     if (isAdmin) {
//       whereClause = { AND: filters };
//     } else {
//       const assignedToUser = await prisma.taskAssignment.findMany({
//         where: { accountId },
//         select: { taskId: true },
//       });
//       const taskIds = assignedToUser.map((a) => a.taskId);
//       if (!taskIds.length)
//         return sendSuccessResponse(res, 200, "No tasks", {
//           tasks: [],
//           total: 0,
//           page: Number(page),
//           limit: Number(limit),
//         });
//       whereClause = { id: { in: taskIds }, AND: filters };
//     }

//     const tasks = await prisma.task.findMany({
//       where: whereClause,
//       skip: (Number(page) - 1) * Number(limit),
//       take: Number(limit),
//       orderBy: { startDate: "asc" },
//       include: {
//         assignments: {
//           include: {
//             account: { select: { id: true, firstName: true, lastName: true } },
//             team: { select: { id: true, name: true } },
//           },
//         },
//         activity: { orderBy: { createdAt: "desc" } },
//       },
//     });

//     const total = await prisma.task.count({ where: whereClause });

//     return sendSuccessResponse(res, 200, "Tasks fetched", {
//       tasks,
//       total,
//       page: Number(page),
//       limit: Number(limit),
//     });
//   } catch (err) {
//     console.error(err);
//     return sendErrorResponse(res, 500, "Failed to fetch tasks");
//   }
// }

// export async function updateAssignmentStatus(req: Request, res: Response) {
//   try {
//     const userId = (req as any).user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     if (!user) return sendErrorResponse(res, 404, "User not found");

//     const { assignmentId, status, note } = req.body;
//     if (!assignmentId || !status)
//       return sendErrorResponse(res, 400, "assignmentId & status required");

//     const existing = await prisma.taskAssignment.findUnique({
//       where: { id: assignmentId },
//     });
//     if (!existing) return sendErrorResponse(res, 404, "Assignment not found");

//     if (existing.accountId !== user.accountId)
//       return sendErrorResponse(res, 403, "Not authorized");

//     const updated = await prisma.taskAssignment.update({
//       where: { id: assignmentId },
//       data: { status, note: note ?? existing.note },
//     });

//     await prisma.activityLog.create({
//       data: {
//         entityType: "TASK",
//         entityId: existing.taskId,
//         action: "ASSIGNMENT_STATUS_CHANGED",
//         performedBy: user.accountId,
//         meta: { from: existing.status, to: status, note: note ?? null },
//       },
//     });

//     return sendSuccessResponse(res, 200, "Status updated", updated);
//   } catch (err) {
//     console.error(err);
//     return sendErrorResponse(res, 500, "Failed to update status");
//   }
// }

// // Admin assigns a user to a task
// export async function assignTaskToUser(req: Request, res: Response) {
//   try {
//     const adminUserId = (req as any).user?.id;
//     if (!adminUserId) {
//       return sendErrorResponse(res, 401, "Unauthorized");
//     }

//     const { taskId, accountId } = req.body;

//     if (!taskId || !accountId) {
//       return sendErrorResponse(res, 400, "taskId and accountId required");
//     }

//     // Ensure task exists
//     const task = await prisma.task.findUnique({ where: { id: taskId } });
//     if (!task) {
//       return sendErrorResponse(res, 404, "Task not found");
//     }

//     // Ensure user/account exists
//     const account = await prisma.account.findUnique({
//       where: { id: accountId },
//     });
//     if (!account) {
//       return sendErrorResponse(res, 404, "Account (user) not found");
//     }

//     // Upsert assignment: remove existing user assignment & create new
//     await prisma.taskAssignment.deleteMany({
//       where: { taskId, type: "ACCOUNT" },
//     });

//     const assignment = await prisma.taskAssignment.create({
//       data: {
//         taskId,
//         accountId,
//         type: "ACCOUNT",
//       },
//     });

//     return sendSuccessResponse(res, 200, "Task assigned to user", {
//       assignment,
//     });
//   } catch (error) {
//     console.error(error);
//     return sendErrorResponse(res, 500, "Failed to assign task");
//   }
// }

// // Fetch the user assigned to a specific task
// export async function getAssignedUserForTask(req: Request, res: Response) {
//   try {
//     const adminUserId = (req as any).user?.id;
//     if (!adminUserId) {
//       return sendErrorResponse(res, 401, "Unauthorized");
//     }

//     const { taskId } = req.params;
//     if (!taskId) {
//       return sendErrorResponse(res, 400, "taskId required");
//     }

//     const assignment = await prisma.taskAssignment.findFirst({
//       where: {
//         taskId,
//         type: "ACCOUNT",
//       },
//       include: {
//         account: {
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             contactEmail: true,
//             contactPhone: true,
//           },
//         },
//       },
//     });

//     if (!assignment || !assignment.account) {
//       return sendErrorResponse(res, 404, "Assigned user not found");
//     }

//     return sendSuccessResponse(res, 200, "Assigned user fetched", {
//       user: assignment.account,
//     });
//   } catch (error) {
//     console.error(error);
//     return sendErrorResponse(res, 500, "Failed to fetch assigned user");
//   }
// }
