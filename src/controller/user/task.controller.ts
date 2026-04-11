// src/controller/task/task.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import { TaskStatus, TaskPriority, AssignmentType, TaskRecurrenceType } from "@prisma/client";
import { triggerTaskNotification } from "../../services/notifications";
import { spawnDueRecurringTasks } from "../../core/job/recurringTask/recurringTask.job";

/* ═══════════════════════════════════════════════════════════════
   SNAPSHOT HELPERS  (mirrors lead.controller.ts pattern)
═══════════════════════════════════════════════════════════════ */

async function resolveAssigneeSnapshot(input: {
  accountId?: string | null;
  teamId?: string | null;
}) {
  if (input.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, firstName: true, lastName: true, designation: true },
    });
    return acc
      ? {
        type: "ACCOUNT" as const,
        id: acc.id,
        name: `${acc.firstName} ${acc.lastName}`,
        designation: acc.designation ?? null,
      }
      : null;
  }

  if (input.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      select: { id: true, name: true },
    });
    return team
      ? { type: "TEAM" as const, id: team.id, name: team.name }
      : null;
  }

  return null;
}

async function resolvePerformerSnapshot(accountId: string) {
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, firstName: true, lastName: true, designation: true },
  });
  if (!acc) return null;
  return {
    id: acc.id,
    name: `${acc.firstName} ${acc.lastName}`,
    designation: acc.designation ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════════
   SOCKET HELPERS
   Rooms:
     tasks:user:{accountId}  ← employee receives their tasks
     tasks:admin             ← admin dashboard receives all task events
   Events:
     task:created  → full task payload on creation
     task:patch    → { id, patch }  partial update, client merges into cache
     task:comment  → { taskId, comment }
═══════════════════════════════════════════════════════════════ */

/**
 * Fan-out: expand TEAM assignments → each active team member's accountId.
 */
async function resolveTaskRecipients(taskId: string): Promise<string[]> {
  const assignments = await prisma.taskAssignment.findMany({
    where: { taskId },
    select: { accountId: true, teamId: true },
  });

  const ids = new Set<string>();

  for (const a of assignments) {
    if (a.accountId) {
      ids.add(a.accountId);
    } else if (a.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: a.teamId, isActive: true },
        select: { accountId: true },
      });
      members.forEach((m) => ids.add(m.accountId));
    }
  }

  return [...ids];
}

function emitTaskCreated(recipients: string[], task: Record<string, unknown>) {
  try {
    const io = getIo();
    recipients.forEach((accountId) => {
      io.to(`tasks:user:${accountId}`).emit("task:created", task);
    });
    io.to("tasks:admin").emit("task:created", task);
  } catch {
    console.warn("[task.controller] Socket emit skipped — io not ready");
  }
}

function emitTaskPatch(
  taskId: string,
  recipients: string[],
  patch: Record<string, unknown>,
) {
  try {
    const io = getIo();
    const payload = { id: taskId, patch };
    recipients.forEach((accountId) => {
      io.to(`tasks:user:${accountId}`).emit("task:patch", payload);
    });
    io.to("tasks:admin").emit("task:patch", payload);
  } catch {
    console.warn("[task.controller] Socket emit skipped — io not ready");
  }
}

/* ═══════════════════════════════════════════════════════════════
   GUARDS
═══════════════════════════════════════════════════════════════ */

function assertAdmin(req: Request, res: Response): boolean {
  if (!req.user?.roles?.includes?.("ADMIN")) {
    sendErrorResponse(res, 403, "Admin access required");
    return false;
  }
  return true;
}

/**
 * True if accountId is directly assigned OR is a member of
 * any team that is assigned to this task.
 */
async function isAssignedToTask(
  taskId: string,
  accountId: string,
): Promise<boolean> {
  const direct = await prisma.taskAssignment.findFirst({
    where: { taskId, accountId },
    select: { id: true },
  });
  if (direct) return true;

  const teamAssignments = await prisma.taskAssignment.findMany({
    where: { taskId, teamId: { not: null } },
    select: { teamId: true },
  });

  for (const { teamId } of teamAssignments) {
    if (!teamId) continue;
    const member = await prisma.teamMember.findFirst({
      where: { teamId, accountId, isActive: true },
      select: { id: true },
    });
    if (member) return true;
  }

  return false;
}

/* ═══════════════════════════════════════════════════════════════
   SELECT SHAPES
   TASK_LIST_SELECT  → kanban card / task list row
   TASK_DETAIL_SELECT → detail drawer / task page
═══════════════════════════════════════════════════════════════ */

const TASK_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  startDate: true,
  startedAt: true,
  completedAt: true,
  isSelfTask: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,

  project: { select: { id: true, name: true, status: true } },
  step: { select: { id: true, name: true, order: true, color: true } },

  assignments: {
    select: {
      id: true,
      type: true,
      status: true,
      note: true,
      assignedAt: true,
      account: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
          designation: true,
        },
      },
      team: { select: { id: true, name: true } },
    },
  },

  checklist: {
    select: { id: true, title: true, status: true, order: true },
    orderBy: { order: "asc" as const },
  },

  labels: {
    select: { label: { select: { id: true, name: true, color: true } } },
  },

  _count: {
    select: { subTasks: true, comments: true, attachments: true },
  },
} as const;

const TASK_DETAIL_SELECT = {
  ...TASK_LIST_SELECT,

  estimatedMinutes: true,
  loggedMinutes: true,
  isRecurring: true,
  recurrenceType: true,

  parentTaskId: true,
  parentTask: { select: { id: true, title: true, status: true } },

  subTasks: {
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
    },
    orderBy: { sortOrder: "asc" as const },
  },

  attachments: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      source: true,
      url: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
  },

  watchers: {
    select: {
      account: {
        select: { id: true, firstName: true, lastName: true, avatar: true },
      },
    },
  },

  dependencies: {
    select: {
      blockingTask: { select: { id: true, title: true, status: true } },
    },
  },

  dependents: {
    select: {
      dependentTask: { select: { id: true, title: true, status: true } },
    },
  },
} as const;

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░░  ADMIN CONTROLLERS  ░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /admin/tasks
   Create a task and immediately assign it to an account or team.
───────────────────────────────────────────────────────────── */
export async function createTaskAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const creatorAccountId = req.user?.accountId;
    if (!creatorAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const {
      title,
      description,
      priority = "NONE",
      projectId,
      stepId,
      dueDate,
      startDate,
      estimatedMinutes,
      isSelfTask = false,
      parentTaskId,
      labels = [],
      checklist = [], // ✅ checklist support
      note,
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
      isRecurring = false,
      recurrenceType = "ONE_TIME",
      recurrenceRule = null,
    } = req.body as Record<string, any>;

    // ── Validation ─────────────────────────────────────────────
    if (!title?.trim())
      return sendErrorResponse(res, 400, "Task title is required");

    if (!assigneeAccountId && !assigneeTeamId && !isSelfTask)
      return sendErrorResponse(
        res,
        400,
        "Assign to an account, a team, or mark as self task",
      );

    if (assigneeAccountId && assigneeTeamId)
      return sendErrorResponse(
        res,
        400,
        "Provide either accountId or teamId, not both",
      );

    if (!Object.values(TaskPriority).includes(priority))
      return sendErrorResponse(
        res,
        400,
        `Invalid priority. Must be one of: ${Object.values(TaskPriority).join(", ")}`,
      );

    // step validation
    if (stepId && projectId) {
      const step = await prisma.pipelineStep.findFirst({
        where: { id: stepId, pipeline: { projectId } },
        select: { id: true },
      });
      if (!step)
        return sendErrorResponse(
          res,
          400,
          "Step does not belong to the specified project",
        );
    }

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
    });

    // ── Transaction ────────────────────────────────────────────
    const { task, recipientIds } = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: title.trim(),
          description: description ?? null,
          priority: priority as TaskPriority,
          projectId: projectId ?? null,
          stepId: stepId ?? null,
          dueDate: dueDate ? new Date(dueDate) : null,
          startDate: startDate ? new Date(startDate) : null,
          estimatedMinutes: estimatedMinutes ?? null,
          isSelfTask: Boolean(isSelfTask),
          parentTaskId: parentTaskId ?? null,
          createdBy: creatorAccountId,
          status: TaskStatus.PENDING,
          isRecurring: Boolean(isRecurring),
          recurrenceType: isRecurring ? recurrenceType : "ONE_TIME",
          recurrenceRule: isRecurring && recurrenceRule ? recurrenceRule : null,
        },
        select: TASK_LIST_SELECT,
      });

      // ── Assignment ──────────────────────────────────────────
      if (assigneeAccountId || assigneeTeamId) {
        await tx.taskAssignment.create({
          data: {
            taskId: created.id,
            type: assigneeAccountId
              ? AssignmentType.ACCOUNT
              : AssignmentType.TEAM,
            accountId: assigneeAccountId ?? null,
            teamId: assigneeTeamId ?? null,
            assignedBy: creatorAccountId,
            note: note ?? null,
            status: TaskStatus.PENDING,
          },
        });
      }

      // ── Labels ─────────────────────────────────────────────
      if (labels.length > 0) {
        await tx.taskLabel.createMany({
          data: labels.map((labelId: string) => ({
            taskId: created.id,
            labelId,
            addedBy: creatorAccountId,
          })),
          skipDuplicates: true,
        });
      }

      // ── Checklist items ────────────────────────────────────
      if (Array.isArray(checklist) && checklist.length > 0) {
        const validItems = checklist.filter(
          (item: any) => item?.title?.trim()
        );

        if (validItems.length > 0) {
          await tx.checklistItem.createMany({
            data: validItems.map(
              (
                item: { title: string; assignedTo?: string; dueDate?: string },
                idx: number
              ) => ({
                taskId: created.id,
                title: item.title.trim(),
                order: idx,
                status: "PENDING" as const,
                assignedTo: item.assignedTo ?? null,
                dueDate: item.dueDate ? new Date(item.dueDate) : null,
                createdBy: creatorAccountId,
              })
            ),
            skipDuplicates: true,
          });
        }
      }

      // ── Activity Log ────────────────────────────────────────
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: created.id,
          action: "CREATED",
          performedBy: creatorAccountId,
          projectId: projectId ?? null,
          taskId: created.id,
          toState: {
            title,
            priority,
            dueDate: dueDate ?? null,
            assignee: initialAssignee,
            checklistCount: Array.isArray(checklist)
              ? checklist.length
              : 0,
          },
          meta: {
            assignedTo: initialAssignee,
            note: note ?? null,
          },
        },
      });

      // ── Recipients ─────────────────────────────────────────
      let recipientIds: string[] = [];

      if (assigneeAccountId) {
        recipientIds = [assigneeAccountId];
      } else if (assigneeTeamId) {
        const members = await tx.teamMember.findMany({
          where: { teamId: assigneeTeamId, isActive: true },
          select: { accountId: true },
        });
        recipientIds = members.map((m) => m.accountId);
      }

      return { task: created, recipientIds };
    });

    // ── Fetch full task ───────────────────────────────────────
    const fullTask = await prisma.task.findUnique({
      where: { id: task.id },
      select: TASK_LIST_SELECT,
    });

    // ── Emit events ──────────────────────────────────────────
    emitTaskCreated(recipientIds, fullTask as Record<string, unknown>);

    await triggerTaskNotification({
      taskId: task.id,
      event: "CREATED",
      performedByAccountId: creatorAccountId,
      recipientAccountIds: recipientIds,
    });

    return sendSuccessResponse(
      res,
      201,
      "Task created successfully",
      fullTask
    );
  } catch (err: any) {
    console.error("[createTaskAdmin]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create task"
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/tasks/:id/assign
   Reassign or add an assignee to an existing task.
   replaceExisting=true  → clear old assignments (default)
   replaceExisting=false → append alongside existing
───────────────────────────────────────────────────────────── */
export async function assignTaskAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id: taskId } = req.params;
    const {
      accountId,
      teamId,
      note,
      replaceExisting = true,
    } = req.body as {
      accountId?: string;
      teamId?: string;
      note?: string;
      replaceExisting?: boolean;
    };

    if (!accountId && !teamId)
      return sendErrorResponse(res, 400, "Provide accountId or teamId");

    if (accountId && teamId)
      return sendErrorResponse(
        res,
        400,
        "Provide either accountId or teamId, not both",
      );

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    // Snapshot previous for activity log
    const previousAssignments = await prisma.taskAssignment.findMany({
      where: { taskId },
      select: {
        accountId: true,
        teamId: true,
        account: { select: { id: true, firstName: true, lastName: true } },
        team: { select: { id: true, name: true } },
      },
    });

    const fromSnapshot = previousAssignments.map((a) =>
      a.account
        ? {
          type: "ACCOUNT",
          id: a.account.id,
          name: `${a.account.firstName} ${a.account.lastName}`,
        }
        : { type: "TEAM", id: a.team!.id, name: a.team!.name },
    );

    const toSnapshot = await resolveAssigneeSnapshot({ accountId, teamId });

    const { recipientIds } = await prisma.$transaction(async (tx) => {
      if (replaceExisting) {
        await tx.taskAssignment.deleteMany({ where: { taskId } });
      } else if (accountId) {
        // Upsert-style: remove same person before re-adding
        await tx.taskAssignment.deleteMany({ where: { taskId, accountId } });
      }

      await tx.taskAssignment.create({
        data: {
          taskId,
          type: accountId ? AssignmentType.ACCOUNT : AssignmentType.TEAM,
          accountId: accountId ?? null,
          teamId: teamId ?? null,
          assignedBy: performerAccountId,
          note: note ?? null,
          status: TaskStatus.PENDING,
        },
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "ASSIGNED",
          performedBy: performerAccountId,
          projectId: task.projectId,
          taskId,
          fromState: { assignees: fromSnapshot },
          toState: { assignee: toSnapshot },
          meta: { note: note ?? null, replaceExisting },
        },
      });

      let newRecipients: string[] = [];
      if (accountId) {
        newRecipients = [accountId];
      } else if (teamId) {
        const members = await tx.teamMember.findMany({
          where: { teamId, isActive: true },
          select: { accountId: true },
        });
        newRecipients = members.map((m) => m.accountId);
      }

      // Also notify previously assigned users so they can remove from their view
      const oldRecipients = previousAssignments
        .filter((a) => a.accountId)
        .map((a) => a.accountId!);

      return {
        recipientIds: [...new Set([...newRecipients, ...oldRecipients])],
      };
    });

    emitTaskPatch(taskId, recipientIds, {
      assignment: toSnapshot,
      updatedAt: new Date(),
    });
    await triggerTaskNotification({
      taskId,
      event: "ASSIGNED",
      performedByAccountId: performerAccountId,
      recipientAccountIds: recipientIds,
    });

    return sendSuccessResponse(res, 200, "Task assigned successfully", {
      taskId,
      assignedTo: toSnapshot,
    });
  } catch (err: any) {
    console.error("[assignTaskAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to assign task");
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/tasks/:id
   Admin can update: title, description, priority, status,
   dueDate, startDate, estimatedMinutes, stepId, sortOrder,
   parentTaskId.
───────────────────────────────────────────────────────────── */
export async function updateTaskAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    if (!adminAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const existing = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        priority: true,
        dueDate: true,
        stepId: true,
        projectId: true,
        startedAt: true,
        completedAt: true,
      },
    });
    if (!existing) return sendErrorResponse(res, 404, "Task not found");

    const ALLOWED_FIELDS = [
      "title",
      "description",
      "priority",
      "status",
      "dueDate",
      "startDate",
      "estimatedMinutes",
      "stepId",
      "sortOrder",
      "parentTaskId",
    ];

    const data: Record<string, any> = {};
    for (const f of ALLOWED_FIELDS) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }

    // Status-driven timestamp fills
    if (data.status === TaskStatus.IN_PROGRESS && !existing.startedAt) {
      data.startedAt = new Date();
    }
    if (data.status === TaskStatus.COMPLETED && !existing.completedAt) {
      data.completedAt = new Date();
    }
    if (data.status === TaskStatus.CANCELLED) {
      data.cancelledAt = new Date();
    }
    // Reopen
    if (
      data.status === TaskStatus.IN_PROGRESS &&
      existing.status === TaskStatus.COMPLETED
    ) {
      data.completedAt = null;
    }

    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    if (data.startDate) data.startDate = new Date(data.startDate);

    const fromState = {
      status: existing.status,
      priority: existing.priority,
      dueDate: existing.dueDate,
      stepId: existing.stepId,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data,
        select: TASK_DETAIL_SELECT,
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: id,
          action: "UPDATED",
          performedBy: adminAccountId,
          projectId: existing.projectId,
          taskId: id,
          fromState,
          toState: data,
          meta: { updatedFields: Object.keys(data) },
        },
      });

      return task;
    });

    const recipients = await resolveTaskRecipients(id);

    emitTaskPatch(id, recipients, {
      status: updated.status,
      priority: updated.priority,
      dueDate: updated.dueDate,
      completedAt: updated.completedAt,
      updatedAt: updated.updatedAt,
    });

    await triggerTaskNotification({
      taskId: id,
      event: "UPDATED",
      performedByAccountId: adminAccountId,
      recipientAccountIds: recipients,
    });

    return sendSuccessResponse(res, 200, "Task updated", updated);
  } catch (err: any) {
    console.error("[updateTaskAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update task");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/tasks/:id  (soft delete)
───────────────────────────────────────────────────────────── */
export async function deleteTaskAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;
    // console.log("\n\n\n\n\n\n\n API CALL HERE");

    const adminAccountId = req.user?.accountId;
    if (!adminAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const recipients = await resolveTaskRecipients(id);

    await prisma.$transaction(async (tx) => {
      // await tx.task.update({
      //   where: { id },
      //   data: { deletedAt: new Date(), deletedBy: adminAccountId },
      // });
      await tx.task.delete({
        where: { id },
      });

      // await tx.activityLog.create({
      //   data: {
      //     entityType: "TASK",
      //     entityId: id,
      //     action: "DELETED",
      //     performedBy: adminAccountId,
      //     projectId: task.projectId,
      //     taskId: id,
      //   },
      // });
    });

    emitTaskPatch(id, recipients, { deletedAt: new Date() });

    return sendSuccessResponse(res, 200, "Task deleted");
  } catch (err: any) {
    console.error("[deleteTaskAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete task");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/tasks  (bulk delete)
───────────────────────────────────────────────────────────── */
export async function deleteTasksBulkAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    if (!adminAccountId) {
      return sendErrorResponse(res, 401, "Invalid session user");
    }

    const { ids } = req.body as { ids: string[] };

    // console.log("\n\n\n\n\n\n\nids", ids);


    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return sendErrorResponse(res, 400, "Task IDs are required");
    }

    // Fetch tasks (only valid ones)
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    if (tasks.length === 0) {
      return sendErrorResponse(res, 404, "No valid tasks found");
    }

    const taskIds = tasks.map((t) => t.id);

    // Resolve recipients for all tasks
    const recipientsMap = await Promise.all(
      taskIds.map(async (id) => ({
        id,
        recipients: await resolveTaskRecipients(id),
      }))
    );

    await prisma.$transaction(async (tx) => {
      // HARD DELETE
      await tx.task.deleteMany({
        where: {
          id: { in: taskIds },
        },
      });

      // OPTIONAL: activity logs
      // await tx.activityLog.createMany({
      //   data: tasks.map((task) => ({
      //     entityType: "TASK",
      //     entityId: task.id,
      //     action: "DELETED",
      //     performedBy: adminAccountId,
      //     projectId: task.projectId,
      //     taskId: task.id,
      //   })),
      // });
    });

    // Emit socket events per task
    for (const item of recipientsMap) {
      emitTaskPatch(item.id, item.recipients, {
        deletedAt: new Date(),
      });
    }

    return sendSuccessResponse(
      res,
      200,
      `${taskIds.length} tasks deleted successfully`
    );
  } catch (err: any) {
    console.error("[deleteTasksBulkAdmin]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete tasks"
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks
   Filters: status, priority, projectId, stepId,
   assignedToAccountId, assignedToTeamId, search, date ranges.
───────────────────────────────────────────────────────────── */
export async function listTasksAdmin(req: Request, res: Response) {
  try {
    const {
      status,
      priority,
      projectId,
      stepId,
      assignedToAccountId,
      assignedToTeamId,
      search,
      fromDate,
      toDate,
      dueBefore,
      dueAfter,
      isSelfTask,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    const where: any = { deletedAt: null };

    if (status) where.status = status as TaskStatus;
    if (priority) where.priority = priority as TaskPriority;
    if (projectId) where.projectId = projectId;
    if (stepId) where.stepId = stepId;

    if (isSelfTask !== undefined) where.isSelfTask = isSelfTask === "true";

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueAfter) where.dueDate.gte = new Date(dueAfter);
      if (dueBefore) where.dueDate.lte = new Date(dueBefore);
    }

    if (search?.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: "insensitive" } },
        { description: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    if (assignedToAccountId || assignedToTeamId) {
      where.assignments = {
        some: {
          ...(assignedToAccountId ? { accountId: assignedToAccountId } : {}),
          ...(assignedToTeamId ? { teamId: assignedToTeamId } : {}),
        },
      };
    }

    const orderBy = [
      { status: "asc" as const },
      { priority: "desc" as const },
      { dueDate: "asc" as const },
      { createdAt: "desc" as const },
    ];

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: TASK_LIST_SELECT,
      }),
    ]);

    return sendSuccessResponse(res, 200, "Tasks fetched", {
      data: tasks,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (err: any) {
    console.error("[listTasksAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch tasks");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks/:id
───────────────────────────────────────────────────────────── */
export async function getTaskByIdAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return sendErrorResponse(res, 400, "Task ID is required");

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: TASK_DETAIL_SELECT,
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    return sendSuccessResponse(res, 200, "Task fetched", task);
  } catch (err: any) {
    console.error("[getTaskByIdAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch task");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks/:id/activity
   Full immutable audit trail, enriched with performer snapshots.
───────────────────────────────────────────────────────────── */
export async function getTaskActivityAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { id } = req.params;
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 100);

    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const [total, activity] = await Promise.all([
      prisma.activityLog.count({ where: { taskId: id } }),
      prisma.activityLog.findMany({
        where: { taskId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          action: true,
          entityType: true,
          meta: true,
          fromState: true,
          toState: true,
          createdAt: true,
          performedBy: true,
        },
      }),
    ]);

    const actorIds = [
      ...new Set(
        activity.map((a) => a.performedBy).filter(Boolean) as string[],
      ),
    ];
    const actors = await prisma.account.findMany({
      where: { id: { in: actorIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        avatar: true,
      },
    });
    const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));

    const enriched = activity.map((a) => ({
      ...a,
      performer: a.performedBy ? (actorMap[a.performedBy] ?? null) : null,
    }));

    return sendSuccessResponse(res, 200, "Task activity fetched", {
      taskId: id,
      total,
      data: enriched,
      meta: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("[getTaskActivityAdmin]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch activity",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks/stats
   Counts grouped by status + overdue count (single groupBy call).
───────────────────────────────────────────────────────────── */
export async function getTaskStatsAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { projectId, assignedToAccountId, fromDate, toDate } =
      req.query as Record<string, string>;

    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    if (assignedToAccountId) {
      where.assignments = { some: { accountId: assignedToAccountId } };
    }

    const grouped = await prisma.task.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });

    const stats: Record<string, number> = {
      PENDING: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      BLOCKED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      TOTAL: 0,
      OVERDUE: 0,
    };

    for (const row of grouped) {
      stats[row.status] = row._count._all;
      stats.TOTAL += row._count._all;
    }

    stats.OVERDUE = await prisma.task.count({
      where: {
        ...where,
        dueDate: { lt: new Date() },
        status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      },
    });

    return sendSuccessResponse(res, 200, "Task stats fetched", stats);
  } catch (err: any) {
    console.error("[getTaskStatsAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch stats");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks/recurring
   List all active recurring task definitions with instance counts.
───────────────────────────────────────────────────────────── */
export async function listRecurringTasksAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const {
      recurrenceType,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    const where: any = {
      isRecurring: true,
      recurrenceParentId: null,
      deletedAt: null,
      recurrenceType: { not: TaskRecurrenceType.ONE_TIME },
    };

    if (recurrenceType) where.recurrenceType = recurrenceType;

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          recurrenceType: true,
          recurrenceRule: true,
          startDate: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          assignments: {
            select: {
              type: true,
              account: {
                select: { id: true, firstName: true, lastName: true, avatar: true },
              },
              team: { select: { id: true, name: true } },
            },
          },
          _count: { select: { recurrenceChildren: true } },
          // Last spawned instance
          recurrenceChildren: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              startDate: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Recurring tasks fetched", {
      data: tasks.map((t) => ({
        ...t,
        instanceCount: t._count.recurrenceChildren,
        lastInstance: t.recurrenceChildren[0] ?? null,
        recurrenceChildren: undefined,
        _count: undefined,
      })),
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("[listRecurringTasksAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch recurring tasks");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/tasks/recurring/trigger
   Manually fire the recurring task scheduler right now.
   Useful in staging / for immediate testing without waiting for cron.
───────────────────────────────────────────────────────────── */
export async function triggerRecurringSchedulerAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const result = await spawnDueRecurringTasks();

    return sendSuccessResponse(res, 200, "Scheduler triggered", result);
  } catch (err: any) {
    console.error("[triggerRecurringSchedulerAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Scheduler failed");
  }
}


/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks/:id/instances
   Paginated list of spawned instances for a given parent task.
───────────────────────────────────────────────────────────── */
export async function listTaskInstancesAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { id: parentId } = req.params;
    const {
      status,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    // Verify parent exists and is recurring
    const parent = await prisma.task.findUnique({
      where: { id: parentId },
      select: { id: true, title: true, isRecurring: true, recurrenceType: true },
    });

    if (!parent) return sendErrorResponse(res, 404, "Task not found");
    if (!parent.isRecurring)
      return sendErrorResponse(res, 400, "Task is not a recurring task definition");

    const where: any = {
      recurrenceParentId: parentId,
      deletedAt: null,
    };

    if (status) where.status = status as TaskStatus;

    const [total, instances] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { startDate: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          startDate: true,
          dueDate: true,
          completedAt: true,
          createdAt: true,
          recurrenceRule: true,
          assignments: {
            select: {
              type: true,
              status: true,
              account: {
                select: { id: true, firstName: true, lastName: true, avatar: true },
              },
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Task instances fetched", {
      parent: {
        id: parent.id,
        title: parent.title,
        recurrenceType: parent.recurrenceType,
      },
      data: instances,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("[listTaskInstancesAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch instances");
  }
}



/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░░  USER CONTROLLERS  ░░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

export async function createSelfTaskUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const {
      title,
      description,
      priority = "NONE",
      dueDate,
      startDate,
      estimatedMinutes,
      labels = [],
      isRecurring = false,
      recurrenceType = "ONE_TIME",
      recurrenceRule = null,
    } = req.body as Record<string, any>;

    if (!title?.trim())
      return sendErrorResponse(res, 400, "Task title is required");

    if (!Object.values(TaskPriority).includes(priority))
      return sendErrorResponse(
        res,
        400,
        `Invalid priority. Must be one of: ${Object.values(TaskPriority).join(", ")}`,
      );

    if (isRecurring && recurrenceType === "ONE_TIME")
      return sendErrorResponse(
        res,
        400,
        "recurrenceType cannot be ONE_TIME when isRecurring is true",
      );

    const task = await prisma.$transaction(async (tx) => {
      // ── Create task (always isSelfTask = true) ──────────────────────────
      const created = await tx.task.create({
        data: {
          title: title.trim(),
          description: description ?? null,
          priority: priority as TaskPriority,
          dueDate: dueDate ? new Date(dueDate) : null,
          startDate: startDate ? new Date(startDate) : null,
          estimatedMinutes: estimatedMinutes ?? null,
          isSelfTask: true,
          createdBy: accountId,
          status: TaskStatus.PENDING,
          isRecurring: Boolean(isRecurring),
          recurrenceType: isRecurring ? recurrenceType : "ONE_TIME",
          recurrenceRule: isRecurring && recurrenceRule ? recurrenceRule : null,
        },
        select: TASK_LIST_SELECT,
      });

      // ── Auto-assign to the creating user so it appears in their task list ─
      await tx.taskAssignment.create({
        data: {
          taskId: created.id,
          type: AssignmentType.ACCOUNT,
          accountId,
          assignedBy: accountId,
          status: TaskStatus.PENDING,
        },
      });

      // ── Labels ────────────────────────────────────────────────────────────
      if (labels.length > 0) {
        await tx.taskLabel.createMany({
          data: labels.map((labelId: string) => ({
            taskId: created.id,
            labelId,
            addedBy: accountId,
          })),
          skipDuplicates: true,
        });
      }

      // ── Activity ──────────────────────────────────────────────────────────
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: created.id,
          action: "CREATED",
          performedBy: accountId,
          taskId: created.id,
          toState: {
            title,
            priority,
            dueDate: dueDate ?? null,
            isRecurring,
            recurrenceType,
          },
          meta: { isSelfTask: true, source: "user_self_create" },
        },
      });

      return created;
    });

    // Re-fetch with assignment hydrated
    const fullTask = await prisma.task.findUnique({
      where: { id: task.id },
      select: TASK_LIST_SELECT,
    });

    // Notify self (user's own socket room)
    try {
      const io = getIo();
      io.to(`tasks:user:${accountId}`).emit("task:created", fullTask);
      io.to("tasks:admin").emit("task:created", fullTask);
    } catch {
      console.warn("[createSelfTaskUser] Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Self task created", fullTask);
  } catch (err: any) {
    console.error("[createSelfTaskUser]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create self task",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/tasks
   All tasks assigned to the requesting user — direct OR via team.
───────────────────────────────────────────────────────────── */
export async function getMyTasksUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const {
      status,
      priority,
      projectId,
      search,
      dueBefore,
      dueAfter,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    // Expand team memberships
    const teamMemberships = await prisma.teamMember.findMany({
      where: { accountId, isActive: true },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((m) => m.teamId);

    const where: any = {
      deletedAt: null,
      assignments: {
        some: {
          OR: [
            { accountId },
            ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
          ],
        },
      },
    };

    if (status) where.status = status as TaskStatus;
    if (priority) where.priority = priority as TaskPriority;
    if (projectId) where.projectId = projectId;

    if (search?.trim()) {
      where.AND = [
        {
          OR: [
            { title: { contains: search.trim(), mode: "insensitive" } },
            { description: { contains: search.trim(), mode: "insensitive" } },
          ],
        },
      ];
    }

    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueAfter) where.dueDate.gte = new Date(dueAfter);
      if (dueBefore) where.dueDate.lte = new Date(dueBefore);
    }

    const orderBy = [
      { status: "asc" as const },
      { priority: "desc" as const },
      { dueDate: "asc" as const },
      { updatedAt: "desc" as const },
    ];

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: TASK_LIST_SELECT,
      }),
    ]);

    return sendSuccessResponse(res, 200, "My tasks fetched", {
      data: tasks,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (err: any) {
    console.error("[getMyTasksUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch tasks");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/tasks/:id
   403 if the requesting user is not an assignee.
───────────────────────────────────────────────────────────── */
export async function getTaskByIdUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: TASK_DETAIL_SELECT,
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const hasAccess = await isAssignedToTask(id, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    return sendSuccessResponse(res, 200, "Task fetched", task);
  } catch (err: any) {
    console.error("[getTaskByIdUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch task");
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /user/tasks/:id/status
   Assignee moves the task through the status machine with a note.

   Allowed transitions:
     PENDING      → IN_PROGRESS | BLOCKED
     IN_PROGRESS  → IN_REVIEW   | BLOCKED | COMPLETED
     IN_REVIEW    → IN_PROGRESS | BLOCKED | COMPLETED
     BLOCKED      → IN_PROGRESS
     COMPLETED    → IN_PROGRESS  (reopen)
     CANCELLED    → ✗  locked — only admin can change cancelled tasks
───────────────────────────────────────────────────────────── */
export async function updateTaskStatusUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;
    const { status, note } = req.body as { status: TaskStatus; note?: string };

    if (!status || !Object.values(TaskStatus).includes(status))
      return sendErrorResponse(
        res,
        400,
        `status must be one of: ${Object.values(TaskStatus).join(", ")}`,
      );

    // Users cannot self-cancel
    if (status === TaskStatus.CANCELLED)
      return sendErrorResponse(res, 403, "Only admins can cancel tasks");

    const hasAccess = await isAssignedToTask(id, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, status: true, projectId: true, startedAt: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    if (task.status === TaskStatus.CANCELLED)
      return sendErrorResponse(res, 409, "Cancelled tasks cannot be updated");

    const fromStatus = task.status;

    // Timestamp logic
    const timestamps: Record<string, Date | null> = {};
    if (status === TaskStatus.IN_PROGRESS && !task.startedAt) {
      timestamps.startedAt = new Date();
    }
    if (status === TaskStatus.COMPLETED) {
      timestamps.completedAt = new Date();
    }
    if (
      status === TaskStatus.IN_PROGRESS &&
      fromStatus === TaskStatus.COMPLETED
    ) {
      timestamps.completedAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { id },
        data: { status, ...timestamps },
        select: TASK_LIST_SELECT,
      });

      // Keep per-assignee status row in sync
      await tx.taskAssignment.updateMany({
        where: { taskId: id, accountId },
        data: {
          status,
          note: note ?? undefined,
          updatedAt: new Date(),
        },
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: id,
          action: "STATUS_CHANGED",
          performedBy: accountId,
          projectId: task.projectId,
          taskId: id,
          fromState: { status: fromStatus },
          toState: { status, ...timestamps },
          meta: {
            note: note ?? null,
            changedBy: accountId,
          },
        },
      });

      return result;
    });

    const recipients = await resolveTaskRecipients(id);

    emitTaskPatch(id, recipients, {
      status: updated.status,
      completedAt: updated.completedAt,
      updatedAt: updated.updatedAt,
      changedBy: accountId,
      note: note ?? null,
    });
    await triggerTaskNotification({
      taskId: id,
      event: "STATUS_CHANGED",
      performedByAccountId: accountId,
      recipientAccountIds: recipients,
    });

    return sendSuccessResponse(res, 200, "Task status updated", {
      id: updated.id,
      status: updated.status,
      completedAt: updated.completedAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err: any) {
    console.error("[updateTaskStatusUser]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update status",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/complete
   Dedicated "mark done" endpoint. Surfaces incomplete checklist
   items as a non-blocking warning in the response.
───────────────────────────────────────────────────────────── */
export async function completeTaskUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;
    const { note } = req.body as { note?: string };

    const hasAccess = await isAssignedToTask(id, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        projectId: true,
        checklist: {
          where: { status: "PENDING" },
          select: { id: true },
        },
      },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    if (task.status === TaskStatus.COMPLETED)
      return sendErrorResponse(res, 409, "Task is already completed");
    if (task.status === TaskStatus.CANCELLED)
      return sendErrorResponse(res, 409, "Cancelled tasks cannot be completed");

    const pendingChecklistCount = task.checklist.length;
    const completedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { id },
        data: { status: TaskStatus.COMPLETED, completedAt },
        select: TASK_LIST_SELECT,
      });

      await tx.taskAssignment.updateMany({
        where: { taskId: id, accountId },
        data: {
          status: TaskStatus.COMPLETED,
          note: note ?? undefined,
          updatedAt: new Date(),
        },
      });

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: id,
          action: "COMPLETED",
          performedBy: accountId,
          projectId: task.projectId,
          taskId: id,
          fromState: { status: task.status },
          toState: { status: TaskStatus.COMPLETED, completedAt },
          meta: {
            note: note ?? null,
            pendingChecklistCount,
          },
        },
      });

      return result;
    });

    const recipients = await resolveTaskRecipients(id);

    emitTaskPatch(id, recipients, {
      status: TaskStatus.COMPLETED,
      completedAt,
      updatedAt: updated.updatedAt,
      completedBy: accountId,
      note: note ?? null,
    });
    await triggerTaskNotification({
      taskId: id,
      event: "COMPLETED",
      performedByAccountId: accountId,
      recipientAccountIds: recipients,
    });

    return sendSuccessResponse(res, 200, "Task completed", {
      id: updated.id,
      status: updated.status,
      completedAt,
      pendingChecklistCount, // client: "3 checklist items still open" if > 0
    });
  } catch (err: any) {
    console.error("[completeTaskUser]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to complete task",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/tasks/:id/activity
   Assignee-readable activity timeline. Enriched with performers.
───────────────────────────────────────────────────────────── */
export async function getTaskActivityUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;

    const hasAccess = await isAssignedToTask(id, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const activity = await prisma.activityLog.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        action: true,
        meta: true,
        toState: true,
        fromState: true,
        performedBy: true,
        createdAt: true,
      },
    });

    const actorIds = [
      ...new Set(
        activity.map((a) => a.performedBy).filter(Boolean) as string[],
      ),
    ];
    const actors = await prisma.account.findMany({
      where: { id: { in: actorIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        designation: true,
        avatar: true,
      },
    });
    const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));

    const enriched = activity.map((a) => ({
      ...a,
      performer: a.performedBy ? (actorMap[a.performedBy] ?? null) : null,
    }));

    return sendSuccessResponse(res, 200, "Task activity fetched", {
      taskId: id,
      total: enriched.length,
      data: enriched,
    });
  } catch (err: any) {
    console.error("[getTaskActivityUser]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch activity",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/comments
───────────────────────────────────────────────────────────── */
export async function addCommentUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;
    const {
      content,
      parentCommentId,
      mentions = [],
    } = req.body as {
      content: string;
      parentCommentId?: string;
      mentions?: string[];
    };

    if (!content?.trim())
      return sendErrorResponse(res, 400, "Comment content is required");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskComment.create({
        data: {
          taskId,
          authorId: accountId,
          content: content.trim(),
          parentCommentId: parentCommentId ?? null,
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          parentCommentId: true,
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
      });

      if (mentions.length > 0) {
        await tx.commentMention.createMany({
          data: mentions.map((mentionedId: string) => ({
            commentId: created.id,
            accountId: mentionedId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "COMMENTED",
          performedBy: accountId,
          projectId: task.projectId,
          taskId,
          meta: {
            commentId: created.id,
            parentCommentId: parentCommentId ?? null,
            mentions,
          },
        },
      });

      return created;
    });

    // Notify assignees + mentioned accounts (skip the author)
    const taskRecipients = await resolveTaskRecipients(taskId);
    const allRecipients = [...new Set([...taskRecipients, ...mentions])].filter(
      (id) => id !== accountId,
    );

    try {
      const io = getIo();
      const payload = { taskId, comment };
      allRecipients.forEach((recipientId) => {
        io.to(`tasks:user:${recipientId}`).emit("task:comment", payload);
      });
      io.to("tasks:admin").emit("task:comment", payload);
    } catch {
      console.warn("[task.controller] Comment socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Comment added", comment);
  } catch (err: any) {
    console.error("[addCommentUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to add comment");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/tasks/:id/comments
   Top-level comments with nested replies hydrated inline.
───────────────────────────────────────────────────────────── */
export async function getTaskCommentsUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const comments = await prisma.taskComment.findMany({
      where: { taskId, parentCommentId: null, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        content: true,
        reactions: true,
        editedAt: true,
        createdAt: true,
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            content: true,
            reactions: true,
            editedAt: true,
            createdAt: true,
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Comments fetched", {
      taskId,
      total: comments.length,
      data: comments,
    });
  } catch (err: any) {
    console.error("[getTaskCommentsUser]", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch comments",
    );
  }
}



/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░  CHECKLIST OPERATIONS  ░░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/checklist
───────────────────────────────────────────────────────────── */
export async function addChecklistItemUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;
    const { title, assignedTo, dueDate } = req.body as {
      title: string;
      assignedTo?: string;
      dueDate?: string;
    };

    if (!title?.trim()) return sendErrorResponse(res, 400, "Title is required");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const { _max } = await prisma.checklistItem.aggregate({
      where: { taskId },
      _max: { order: true },
    });
    const nextOrder = (_max.order ?? -1) + 1;

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.checklistItem.create({
        data: {
          taskId,
          title: title.trim(),
          order: nextOrder,
          assignedTo: assignedTo ?? null,
          dueDate: dueDate ? new Date(dueDate) : null,
          createdBy: accountId,
          status: "PENDING",
        },
      });
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "UPDATED",
          performedBy: accountId,
          projectId: task.projectId,
          taskId,
          meta: { type: "checklist_added", itemId: created.id, title },
        },
      });
      return created;
    });

    const recipients = await resolveTaskRecipients(taskId);
    emitTaskPatch(taskId, recipients, {
      checklistItem: { action: "added", item },
      updatedAt: new Date(),
    });

    return sendSuccessResponse(res, 201, "Checklist item added", item);
  } catch (err: any) {
    console.error("[addChecklistItemUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to add checklist item");
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /user/tasks/:id/checklist/:itemId
   Toggle status, rename, reassign, reorder.
───────────────────────────────────────────────────────────── */
export async function updateChecklistItemUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, itemId } = req.params;
    const { title, status, assignedTo, dueDate, order } = req.body as {
      title?: string;
      status?: string;
      assignedTo?: string | null;
      dueDate?: string | null;
      order?: number;
    };

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const existing = await prisma.checklistItem.findFirst({
      where: { id: itemId, taskId },
    });
    if (!existing) return sendErrorResponse(res, 404, "Checklist item not found");

    const data: Record<string, any> = {};
    if (title !== undefined) data.title = title.trim();
    if (status !== undefined) data.status = status;
    if (assignedTo !== undefined) data.assignedTo = assignedTo;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (order !== undefined) data.order = order;

    if (status === "COMPLETED" && existing.status !== "COMPLETED") {
      data.completedAt = new Date();
      data.completedBy = accountId;
    } else if (status === "PENDING" && existing.status === "COMPLETED") {
      data.completedAt = null;
      data.completedBy = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.checklistItem.update({ where: { id: itemId }, data });
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "UPDATED",
          performedBy: accountId,
          taskId,
          meta: { type: "checklist_updated", itemId, changes: Object.keys(data) },
        },
      });

      // Auto-complete task if all checklist items are now completed
      if (status === "COMPLETED") {
        const pendingCount = await tx.checklistItem.count({
          where: { taskId, status: "PENDING", id: { not: itemId } },
        });

        if (pendingCount === 0) {
          const task = await tx.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });

          if (task && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED) {
            await tx.task.update({
              where: { id: taskId },
              data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
            });

            await tx.taskAssignment.updateMany({
              where: { taskId, accountId },
              data: { status: TaskStatus.COMPLETED, updatedAt: new Date() },
            });

            await tx.activityLog.create({
              data: {
                entityType: "TASK",
                entityId: taskId,
                action: "COMPLETED",
                performedBy: accountId,
                taskId,
                meta: { type: "auto_completed_via_checklist" },
              },
            });
          }
        }
      }
      return item;
    });

    const recipients = await resolveTaskRecipients(taskId);
    emitTaskPatch(taskId, recipients, {
      checklistItem: { action: "updated", item: updated },
      updatedAt: new Date(),
    });

    return sendSuccessResponse(res, 200, "Checklist item updated", updated);
  } catch (err: any) {
    console.error("[updateChecklistItemUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update checklist item");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /user/tasks/:id/checklist/:itemId
───────────────────────────────────────────────────────────── */
export async function deleteChecklistItemUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, itemId } = req.params;

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const item = await prisma.checklistItem.findFirst({ where: { id: itemId, taskId } });
    if (!item) return sendErrorResponse(res, 404, "Checklist item not found");

    await prisma.$transaction(async (tx) => {
      await tx.checklistItem.delete({ where: { id: itemId } });
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "UPDATED",
          performedBy: accountId,
          taskId,
          meta: { type: "checklist_deleted", itemId, title: item.title },
        },
      });
    });

    const recipients = await resolveTaskRecipients(taskId);
    emitTaskPatch(taskId, recipients, {
      checklistItem: { action: "deleted", itemId },
      updatedAt: new Date(),
    });

    return sendSuccessResponse(res, 200, "Checklist item deleted");
  } catch (err: any) {
    console.error("[deleteChecklistItemUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete checklist item");
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /user/tasks/:id/checklist/reorder
   Body: { items: [{ id, order }] }
───────────────────────────────────────────────────────────── */
export async function reorderChecklistUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;
    const { items } = req.body as { items: { id: string; order: number }[] };

    if (!Array.isArray(items) || items.length === 0)
      return sendErrorResponse(res, 400, "items array is required");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    await prisma.$transaction(
      items.map(({ id, order }) =>
        prisma.checklistItem.updateMany({
          where: { id, taskId },
          data: { order },
        }),
      ),
    );

    return sendSuccessResponse(res, 200, "Checklist reordered");
  } catch (err: any) {
    console.error("[reorderChecklistUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to reorder checklist");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░  COMMENT — EDIT / DELETE / REACT  ░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   PATCH /user/tasks/:id/comments/:commentId
   Author-only edit. Captures editedAt for UI diff badge.
───────────────────────────────────────────────────────────── */
export async function editCommentUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, commentId } = req.params;
    const { content } = req.body as { content: string };

    if (!content?.trim()) return sendErrorResponse(res, 400, "Content is required");

    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId, deletedAt: null },
      select: { id: true, authorId: true, content: true },
    });
    if (!comment) return sendErrorResponse(res, 404, "Comment not found");
    if (comment.authorId !== accountId)
      return sendErrorResponse(res, 403, "You can only edit your own comments");

    const updated = await prisma.taskComment.update({
      where: { id: commentId },
      data: { content: content.trim(), editedAt: new Date() },
      select: {
        id: true,
        content: true,
        editedAt: true,
        createdAt: true,
        author: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });

    const recipients = await resolveTaskRecipients(taskId);
    try {
      const io = getIo();
      const payload = { taskId, comment: updated, action: "edited" };
      recipients.forEach((id) => io.to(`tasks:user:${id}`).emit("task:comment", payload));
      io.to("tasks:admin").emit("task:comment", payload);
    } catch { /* no-op */ }

    return sendSuccessResponse(res, 200, "Comment updated", updated);
  } catch (err: any) {
    console.error("[editCommentUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to edit comment");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /user/tasks/:id/comments/:commentId  (soft delete)
───────────────────────────────────────────────────────────── */
export async function deleteCommentUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, commentId } = req.params;

    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId, deletedAt: null },
      select: { id: true, authorId: true },
    });
    if (!comment) return sendErrorResponse(res, 404, "Comment not found");

    // Admin can delete any comment; user only their own
    const isAdmin = req.user?.roles?.includes?.("ADMIN");
    if (!isAdmin && comment.authorId !== accountId)
      return sendErrorResponse(res, 403, "You can only delete your own comments");

    await prisma.taskComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), deletedBy: accountId },
    });

    const recipients = await resolveTaskRecipients(taskId);
    try {
      const io = getIo();
      const payload = { taskId, commentId, action: "deleted" };
      recipients.forEach((id) => io.to(`tasks:user:${id}`).emit("task:comment", payload));
      io.to("tasks:admin").emit("task:comment", payload);
    } catch { /* no-op */ }

    return sendSuccessResponse(res, 200, "Comment deleted");
  } catch (err: any) {
    console.error("[deleteCommentUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete comment");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/comments/:commentId/reactions
   Body: { emoji: "👍" }   — toggles: adds if absent, removes if present
───────────────────────────────────────────────────────────── */
export async function reactToCommentUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, commentId } = req.params;
    const { emoji } = req.body as { emoji: string };

    if (!emoji?.trim()) return sendErrorResponse(res, 400, "emoji is required");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId, deletedAt: null },
      select: { id: true, reactions: true },
    });
    if (!comment) return sendErrorResponse(res, 404, "Comment not found");

    // Mutate reactions JSON: { "👍": ["id1", "id2"] }
    const reactions: Record<string, string[]> =
      (comment.reactions as Record<string, string[]>) ?? {};

    const current = reactions[emoji] ?? [];
    const alreadyReacted = current.includes(accountId);

    if (alreadyReacted) {
      reactions[emoji] = current.filter((id) => id !== accountId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...current, accountId];
    }

    const updated = await prisma.taskComment.update({
      where: { id: commentId },
      data: { reactions },
      select: { id: true, reactions: true },
    });

    // Lightweight reaction patch — no full task emit needed
    try {
      const io = getIo();
      const payload = {
        taskId,
        commentId,
        action: "reaction",
        emoji,
        reactions: updated.reactions,
        by: accountId,
      };
      const recipients = await resolveTaskRecipients(taskId);
      recipients.forEach((id) => io.to(`tasks:user:${id}`).emit("task:comment", payload));
      io.to("tasks:admin").emit("task:comment", payload);
    } catch { /* no-op */ }

    return sendSuccessResponse(res, 200, "Reaction toggled", {
      commentId,
      reactions: updated.reactions,
      action: alreadyReacted ? "removed" : "added",
    });
  } catch (err: any) {
    console.error("[reactToCommentUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to react");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░░  TIME TRACKING  ░░░░░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/time/start
   Creates an open entry (endedAt = null). One active timer per task per user.
───────────────────────────────────────────────────────────── */
export async function startTimeEntryUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;
    const { description, isBillable = false } = req.body as {
      description?: string;
      isBillable?: boolean;
    };

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    // Enforce single active timer per user per task
    const activeEntry = await prisma.taskTimeEntry.findFirst({
      where: { taskId, accountId, endedAt: null },
      select: { id: true },
    });
    if (activeEntry)
      return sendErrorResponse(res, 409, "A timer is already running for this task. Stop it first.");

    const entry = await prisma.taskTimeEntry.create({
      data: {
        taskId,
        accountId,
        startedAt: new Date(),
        description: description ?? null,
        isBillable: Boolean(isBillable),
      },
    });

    return sendSuccessResponse(res, 201, "Timer started", entry);
  } catch (err: any) {
    console.error("[startTimeEntryUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to start timer");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/time/:entryId/stop
   Closes the open entry and updates loggedMinutes on the task.
───────────────────────────────────────────────────────────── */
export async function stopTimeEntryUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, entryId } = req.params;

    const entry = await prisma.taskTimeEntry.findFirst({
      where: { id: entryId, taskId, accountId, endedAt: null },
    });
    if (!entry)
      return sendErrorResponse(res, 404, "Active timer not found for this task");

    const endedAt = new Date();
    const durationMinutes = Math.round(
      (endedAt.getTime() - entry.startedAt.getTime()) / 60_000,
    );

    const [updated] = await prisma.$transaction([
      prisma.taskTimeEntry.update({
        where: { id: entryId },
        data: { endedAt, durationMinutes },
      }),
      prisma.task.update({
        where: { id: taskId },
        data: { loggedMinutes: { increment: durationMinutes } },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Timer stopped", {
      ...updated,
      durationMinutes,
    });
  } catch (err: any) {
    console.error("[stopTimeEntryUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to stop timer");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/time/log
   Manual time log (no start/stop flow).
───────────────────────────────────────────────────────────── */
export async function logManualTimeUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;
    const { durationMinutes, date, description, isBillable = false } = req.body as {
      durationMinutes: number;
      date?: string;
      description?: string;
      isBillable?: boolean;
    };

    if (!durationMinutes || durationMinutes <= 0)
      return sendErrorResponse(res, 400, "durationMinutes must be a positive number");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const logDate = date ? new Date(date) : new Date();

    const [entry] = await prisma.$transaction([
      prisma.taskTimeEntry.create({
        data: {
          taskId,
          accountId,
          startedAt: logDate,
          endedAt: new Date(logDate.getTime() + durationMinutes * 60_000),
          durationMinutes,
          description: description ?? null,
          isBillable: Boolean(isBillable),
        },
      }),
      prisma.task.update({
        where: { id: taskId },
        data: { loggedMinutes: { increment: durationMinutes } },
      }),
    ]);

    return sendSuccessResponse(res, 201, "Time logged", entry);
  } catch (err: any) {
    console.error("[logManualTimeUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to log time");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/tasks/:id/time
───────────────────────────────────────────────────────────── */
export async function getTimeEntriesUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true, estimatedMinutes: true, loggedMinutes: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const entries = await prisma.taskTimeEntry.findMany({
      where: { taskId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationMinutes: true,
        description: true,
        isBillable: true,
        account: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });

    const totalLogged = entries.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

    return sendSuccessResponse(res, 200, "Time entries fetched", {
      taskId,
      estimatedMinutes: task.estimatedMinutes,
      loggedMinutes: totalLogged,
      activeTimer: entries.find((e) => e.endedAt === null) ?? null,
      entries,
    });
  } catch (err: any) {
    console.error("[getTimeEntriesUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch time entries");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /user/tasks/:id/time/:entryId
   Owner or admin only. Decrements loggedMinutes if already stopped.
───────────────────────────────────────────────────────────── */
export async function deleteTimeEntryUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, entryId } = req.params;

    const entry = await prisma.taskTimeEntry.findFirst({
      where: { id: entryId, taskId },
      select: { id: true, accountId: true, durationMinutes: true, endedAt: true },
    });
    if (!entry) return sendErrorResponse(res, 404, "Time entry not found");

    const isAdmin = req.user?.roles?.includes?.("ADMIN");
    if (!isAdmin && entry.accountId !== accountId)
      return sendErrorResponse(res, 403, "You can only delete your own time entries");

    const ops: any[] = [prisma.taskTimeEntry.delete({ where: { id: entryId } })];

    // Only decrement if entry was completed
    if (entry.endedAt && entry.durationMinutes) {
      ops.push(
        prisma.task.update({
          where: { id: taskId },
          data: { loggedMinutes: { decrement: entry.durationMinutes } },
        }),
      );
    }

    await prisma.$transaction(ops);

    return sendSuccessResponse(res, 200, "Time entry deleted");
  } catch (err: any) {
    console.error("[deleteTimeEntryUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete time entry");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░░  WATCHERS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/watch   — toggles watch on/off
───────────────────────────────────────────────────────────── */
export async function toggleWatchTaskUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const existing = await prisma.taskWatcher.findUnique({
      where: { taskId_accountId: { taskId, accountId } },
    });

    if (existing) {
      await prisma.taskWatcher.delete({
        where: { taskId_accountId: { taskId, accountId } },
      });
      return sendSuccessResponse(res, 200, "Unwatched task", { watching: false });
    }

    await prisma.taskWatcher.create({ data: { taskId, accountId } });
    return sendSuccessResponse(res, 200, "Watching task", { watching: true });
  } catch (err: any) {
    console.error("[toggleWatchTaskUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to toggle watch");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░  SELF-TASK — FULL UPDATE & DELETE  ░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   PATCH /user/tasks/:id
   Owners of a self-task can update core fields (not status — use /status).
───────────────────────────────────────────────────────────── */
export async function updateSelfTaskUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, isSelfTask: true, createdBy: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    if (!task.isSelfTask || task.createdBy !== accountId)
      return sendErrorResponse(res, 403, "You can only edit your own self-tasks");

    const ALLOWED = ["title", "description", "priority", "dueDate", "startDate", "estimatedMinutes"];
    const data: Record<string, any> = {};
    for (const f of ALLOWED) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    if (!Object.keys(data).length)
      return sendErrorResponse(res, 400, "No valid fields to update");

    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    if (data.startDate) data.startDate = new Date(data.startDate);

    const fromState = await prisma.task.findUnique({
      where: { id },
      select: { title: true, priority: true, dueDate: true },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where: { id },
        data,
        select: TASK_DETAIL_SELECT,
      });
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: id,
          action: "UPDATED",
          performedBy: accountId,
          taskId: id,
          fromState: fromState as any,
          toState: data,
          meta: { updatedFields: Object.keys(data), isSelfTask: true },
        },
      });
      return result;
    });

    emitTaskPatch(id, [accountId], { ...data, updatedAt: new Date() });

    return sendSuccessResponse(res, 200, "Task updated", updated);
  } catch (err: any) {
    console.error("[updateSelfTaskUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update task");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /user/tasks/:id   (soft delete)
───────────────────────────────────────────────────────────── */
export async function deleteSelfTaskUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, isSelfTask: true, createdBy: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    if (!task.isSelfTask || task.createdBy !== accountId)
      return sendErrorResponse(res, 403, "You can only delete your own self-tasks");

    await prisma.task.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: accountId },
    });

    try {
      const io = getIo();
      io.to(`tasks:user:${accountId}`).emit("task:patch", {
        id,
        patch: { deletedAt: new Date() },
      });
      io.to("tasks:admin").emit("task:patch", { id, patch: { deletedAt: new Date() } });
    } catch { /* no-op */ }

    return sendSuccessResponse(res, 200, "Task deleted");
  } catch (err: any) {
    console.error("[deleteSelfTaskUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete task");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░  ATTACHMENTS (URL-based)  ░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/attachments
   Body: { name, url, mimeType?, sizeBytes?, source? }
───────────────────────────────────────────────────────────── */
export async function addAttachmentUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId } = req.params;
    const { name, url, mimeType, sizeBytes, source = "UPLOAD" } = req.body as {
      name: string;
      url: string;
      mimeType?: string;
      sizeBytes?: number;
      source?: string;
    };

    if (!name?.trim() || !url?.trim())
      return sendErrorResponse(res, 400, "name and url are required");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskAttachment.create({
        data: {
          taskId,
          name: name.trim(),
          url,
          mimeType: mimeType ?? null,
          sizeBytes: sizeBytes ?? null,
          source: source as any,
          uploadedBy: accountId,
        },
      });
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "UPDATED",
          performedBy: accountId,
          projectId: task.projectId,
          taskId,
          meta: { type: "attachment_added", attachmentId: created.id, name },
        },
      });
      return created;
    });

    const recipients = await resolveTaskRecipients(taskId);
    emitTaskPatch(taskId, recipients, {
      attachment: { action: "added", attachment },
      updatedAt: new Date(),
    });

    return sendSuccessResponse(res, 201, "Attachment added", attachment);
  } catch (err: any) {
    console.error("[addAttachmentUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to add attachment");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /user/tasks/:id/attachments/:attachmentId
───────────────────────────────────────────────────────────── */
export async function deleteAttachmentUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: taskId, attachmentId } = req.params;

    const attachment = await prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId, deletedAt: null },
      select: { id: true, uploadedBy: true, name: true },
    });
    if (!attachment) return sendErrorResponse(res, 404, "Attachment not found");

    const isAdmin = req.user?.roles?.includes?.("ADMIN");
    if (!isAdmin && attachment.uploadedBy !== accountId)
      return sendErrorResponse(res, 403, "You can only delete your own attachments");

    await prisma.$transaction(async (tx) => {
      await tx.taskAttachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      });
      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: taskId,
          action: "UPDATED",
          performedBy: accountId,
          taskId,
          meta: { type: "attachment_deleted", attachmentId, name: attachment.name },
        },
      });
    });

    const recipients = await resolveTaskRecipients(taskId);
    emitTaskPatch(taskId, recipients, {
      attachment: { action: "deleted", attachmentId },
      updatedAt: new Date(),
    });

    return sendSuccessResponse(res, 200, "Attachment deleted");
  } catch (err: any) {
    console.error("[deleteAttachmentUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete attachment");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░░  SUBTASKS  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/tasks/:id/subtasks
───────────────────────────────────────────────────────────── */
export async function createSubtaskUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id: parentTaskId } = req.params;
    const { title, description, priority = "NONE", dueDate, assigneeAccountId } =
      req.body as {
        title: string;
        description?: string;
        priority?: string;
        dueDate?: string;
        assigneeAccountId?: string;
      };

    if (!title?.trim()) return sendErrorResponse(res, 400, "Title is required");

    const hasAccess = await isAssignedToTask(parentTaskId, accountId);
    if (!hasAccess) return sendErrorResponse(res, 403, "Not assigned to this task");

    const parent = await prisma.task.findUnique({
      where: { id: parentTaskId, deletedAt: null },
      select: { id: true, projectId: true, stepId: true },
    });
    if (!parent) return sendErrorResponse(res, 404, "Parent task not found");

    const subtask = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: title.trim(),
          description: description ?? null,
          priority: priority as any,
          dueDate: dueDate ? new Date(dueDate) : null,
          parentTaskId,
          projectId: parent.projectId,
          stepId: parent.stepId,
          createdBy: accountId,
          status: TaskStatus.PENDING,
        },
        select: TASK_LIST_SELECT,
      });

      if (assigneeAccountId) {
        await tx.taskAssignment.create({
          data: {
            taskId: created.id,
            type: "ACCOUNT" as any,
            accountId: assigneeAccountId,
            assignedBy: accountId,
            status: TaskStatus.PENDING,
          },
        });
      }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: parentTaskId,
          action: "UPDATED",
          performedBy: accountId,
          projectId: parent.projectId,
          taskId: parentTaskId,
          meta: { type: "subtask_created", subtaskId: created.id, title },
        },
      });

      return created;
    });

    emitTaskPatch(parentTaskId, await resolveTaskRecipients(parentTaskId), {
      subtask: { action: "added", id: subtask.id, title: subtask.title },
      updatedAt: new Date(),
    });

    return sendSuccessResponse(res, 201, "Subtask created", subtask);
  } catch (err: any) {
    console.error("[createSubtaskUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create subtask");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/tasks/stats
   Personal stats for the logged-in user.
───────────────────────────────────────────────────────────── */
export async function getMyTaskStatsUser(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const teamMemberships = await prisma.teamMember.findMany({
      where: { accountId, isActive: true },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((m) => m.teamId);

    const baseWhere: any = {
      deletedAt: null,
      assignments: {
        some: {
          OR: [
            { accountId },
            ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
          ],
        },
      },
    };

    const [grouped, overdue, activeTimer] = await Promise.all([
      prisma.task.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.task.count({
        where: {
          ...baseWhere,
          dueDate: { lt: new Date() },
          status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
        },
      }),
      prisma.taskTimeEntry.findFirst({
        where: { accountId, endedAt: null },
        select: { id: true, taskId: true, startedAt: true },
      }),
    ]);

    const stats: Record<string, number> = {
      PENDING: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      BLOCKED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      TOTAL: 0,
      OVERDUE: overdue,
    };

    for (const row of grouped) {
      stats[row.status] = row._count._all;
      stats.TOTAL += row._count._all;
    }

    return sendSuccessResponse(res, 200, "My task stats", {
      stats,
      activeTimer: activeTimer ?? null,
    });
  } catch (err: any) {
    console.error("[getMyTaskStatsUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch stats");
  }
}

/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░  ADMIN — BULK / DUPLICATE / DEPS / KANBAN  ░░░░░░
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /admin/tasks/bulk-update
   Body: { ids: string[], data: { status?, priority?, stepId?, assigneeAccountId? } }
───────────────────────────────────────────────────────────── */
export async function bulkUpdateTasksAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;
    const adminAccountId = req.user?.accountId!;

    const { ids, data: updateData } = req.body as {
      ids: string[];
      data: {
        status?: string;
        priority?: string;
        stepId?: string;
        assigneeAccountId?: string;
      };
    };

    if (!Array.isArray(ids) || ids.length === 0)
      return sendErrorResponse(res, 400, "ids array is required");
    if (ids.length > 100)
      return sendErrorResponse(res, 400, "Maximum 100 tasks per bulk operation");
    if (!updateData || !Object.keys(updateData).length)
      return sendErrorResponse(res, 400, "No update fields provided");

    const ALLOWED_BULK = ["status", "priority", "stepId"];
    const sanitized: Record<string, any> = {};
    for (const f of ALLOWED_BULK) {
      if (updateData[f as keyof typeof updateData] !== undefined)
        sanitized[f] = updateData[f as keyof typeof updateData];
    }

    // Status-driven timestamps
    if (sanitized.status === TaskStatus.IN_PROGRESS) sanitized.startedAt = new Date();
    if (sanitized.status === TaskStatus.COMPLETED) sanitized.completedAt = new Date();
    if (sanitized.status === TaskStatus.CANCELLED) sanitized.cancelledAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: sanitized });

      if (updateData.assigneeAccountId) {
        // Replace all assignments in bulk
        await tx.taskAssignment.deleteMany({ where: { taskId: { in: ids } } });
        await tx.taskAssignment.createMany({
          data: ids.map((taskId) => ({
            taskId,
            type: "ACCOUNT" as any,
            accountId: updateData.assigneeAccountId!,
            assignedBy: adminAccountId,
            status: (sanitized.status as TaskStatus) ?? TaskStatus.PENDING,
          })),
          skipDuplicates: true,
        });
      }

      await tx.activityLog.createMany({
        data: ids.map((taskId) => ({
          entityType: "TASK" as any,
          entityId: taskId,
          action: "UPDATED" as any,
          performedBy: adminAccountId,
          taskId,
          meta: { type: "bulk_update", changes: Object.keys(sanitized) },
        })),
      });
    });

    // Notify each task's recipients
    for (const taskId of ids) {
      const recipients = await resolveTaskRecipients(taskId);
      emitTaskPatch(taskId, recipients, { ...sanitized, updatedAt: new Date() });
    }

    return sendSuccessResponse(res, 200, `${ids.length} tasks updated`, { updated: ids.length });
  } catch (err: any) {
    console.error("[bulkUpdateTasksAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Bulk update failed");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/tasks/bulk-delete
   Body: { ids: string[] }   — hard delete (no activity log kept)
───────────────────────────────────────────────────────────── */
export async function bulkDeleteTasksAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0)
      return sendErrorResponse(res, 400, "ids array is required");
    if (ids.length > 50)
      return sendErrorResponse(res, 400, "Maximum 50 tasks per bulk delete");

    // Fan-out recipients before deleting
    const recipientMap: Record<string, string[]> = {};
    for (const id of ids) {
      recipientMap[id] = await resolveTaskRecipients(id);
    }

    await prisma.task.deleteMany({ where: { id: { in: ids } } });

    ids.forEach((id) => {
      emitTaskPatch(id, recipientMap[id] ?? [], { deletedAt: new Date() });
    });

    return sendSuccessResponse(res, 200, `${ids.length} tasks deleted`, { deleted: ids.length });
  } catch (err: any) {
    console.error("[bulkDeleteTasksAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Bulk delete failed");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/tasks/:id/duplicate
   Clones a task (and optionally its checklist).
   Body: { includeChecklist?: boolean, includeAssignees?: boolean }
───────────────────────────────────────────────────────────── */
export async function duplicateTaskAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;
    const adminAccountId = req.user?.accountId!;

    const { id } = req.params;
    const { includeChecklist = true, includeAssignees = true } = req.body as {
      includeChecklist?: boolean;
      includeAssignees?: boolean;
    };

    const source = await prisma.task.findUnique({
      where: { id, deletedAt: null },
      include: {
        checklist: { orderBy: { order: "asc" } },
        assignments: true,
        labels: true,
      },
    });
    if (!source) return sendErrorResponse(res, 404, "Task not found");

    const clone = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: `${source.title} (Copy)`,
          description: source.description,
          priority: source.priority,
          projectId: source.projectId,
          stepId: source.stepId,
          dueDate: source.dueDate,
          startDate: source.startDate,
          estimatedMinutes: source.estimatedMinutes,
          parentTaskId: source.parentTaskId,
          createdBy: adminAccountId,
          status: TaskStatus.PENDING,
        },
        select: TASK_LIST_SELECT,
      });

      if (includeChecklist && source.checklist.length > 0) {
        await tx.checklistItem.createMany({
          data: source.checklist.map((ci) => ({
            taskId: created.id,
            title: ci.title,
            order: ci.order,
            assignedTo: ci.assignedTo,
            dueDate: ci.dueDate,
            createdBy: adminAccountId,
            status: "PENDING",
          })),
        });
      }

      if (includeAssignees && source.assignments.length > 0) {
        await tx.taskAssignment.createMany({
          data: source.assignments.map((a) => ({
            taskId: created.id,
            type: a.type,
            accountId: a.accountId,
            teamId: a.teamId,
            assignedBy: adminAccountId,
            status: TaskStatus.PENDING,
          })),
          skipDuplicates: true,
        });
      }

      if (source.labels.length > 0) {
        await tx.taskLabel.createMany({
          data: source.labels.map((l) => ({
            taskId: created.id,
            labelId: l.labelId,
            addedBy: adminAccountId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.activityLog.create({
        data: {
          entityType: "TASK",
          entityId: created.id,
          action: "CREATED",
          performedBy: adminAccountId,
          projectId: source.projectId,
          taskId: created.id,
          meta: { type: "duplicated_from", sourceTaskId: id },
        },
      });

      return created;
    });

    const recipients = await resolveTaskRecipients(clone.id);
    emitTaskCreated(recipients, clone as Record<string, unknown>);

    return sendSuccessResponse(res, 201, "Task duplicated", clone);
  } catch (err: any) {
    console.error("[duplicateTaskAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to duplicate task");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/tasks/:id/dependencies
   Body: { blockingTaskId: string }
   Adds: "task :id is blocked by blockingTaskId"
───────────────────────────────────────────────────────────── */
export async function addTaskDependencyAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;
    const adminAccountId = req.user?.accountId!;

    const { id: dependentTaskId } = req.params;
    const { blockingTaskId } = req.body as { blockingTaskId: string };

    if (!blockingTaskId)
      return sendErrorResponse(res, 400, "blockingTaskId is required");
    if (dependentTaskId === blockingTaskId)
      return sendErrorResponse(res, 400, "A task cannot depend on itself");

    const [dependent, blocking] = await Promise.all([
      prisma.task.findUnique({
        where: { id: dependentTaskId, deletedAt: null },
        select: { id: true },
      }),
      prisma.task.findUnique({
        where: { id: blockingTaskId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!dependent) return sendErrorResponse(res, 404, "Dependent task not found");
    if (!blocking) return sendErrorResponse(res, 404, "Blocking task not found");

    // Guard: circular dependency — blockingTask must not already depend on dependentTask
    const circular = await prisma.taskDependency.findFirst({
      where: { dependentTaskId: blockingTaskId, blockingTaskId: dependentTaskId },
    });
    if (circular)
      return sendErrorResponse(res, 409, "Circular dependency detected");

    const dep = await prisma.taskDependency.create({
      data: { dependentTaskId, blockingTaskId, createdBy: adminAccountId },
    });

    return sendSuccessResponse(res, 201, "Dependency added", dep);
  } catch (err: any) {
    if (err?.code === "P2002")
      return sendErrorResponse(res, 409, "Dependency already exists");
    console.error("[addTaskDependencyAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to add dependency");
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/tasks/:id/dependencies/:blockingTaskId
───────────────────────────────────────────────────────────── */
export async function removeTaskDependencyAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { id: dependentTaskId, blockingTaskId } = req.params;

    const dep = await prisma.taskDependency.findUnique({
      where: { dependentTaskId_blockingTaskId: { dependentTaskId, blockingTaskId } },
    });
    if (!dep) return sendErrorResponse(res, 404, "Dependency not found");

    await prisma.taskDependency.delete({
      where: { dependentTaskId_blockingTaskId: { dependentTaskId, blockingTaskId } },
    });

    return sendSuccessResponse(res, 200, "Dependency removed");
  } catch (err: any) {
    console.error("[removeTaskDependencyAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to remove dependency");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/tasks/kanban?projectId=...
   Returns tasks grouped by pipeline step — ideal for board views.
   Each step carries its tasks, WIP limit, and counts.
───────────────────────────────────────────────────────────── */
export async function getProjectKanbanAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { projectId } = req.query as { projectId: string };
    if (!projectId) return sendErrorResponse(res, 400, "projectId is required");

    const pipeline = await prisma.projectPipeline.findUnique({
      where: { projectId },
      include: {
        steps: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              where: { deletedAt: null, parentTaskId: null }, // top-level only
              orderBy: { sortOrder: "asc" },
              select: TASK_LIST_SELECT,
            },
          },
        },
      },
    });

    if (!pipeline)
      return sendErrorResponse(res, 404, "No pipeline found for this project");

    const columns = pipeline.steps.map((step) => ({
      id: step.id,
      name: step.name,
      color: step.color,
      order: step.order,
      isTerminal: step.isTerminal,
      wipLimit: step.wipLimit,
      taskCount: step.tasks.length,
      tasks: step.tasks,
    }));

    return sendSuccessResponse(res, 200, "Kanban board fetched", {
      projectId,
      pipelineId: pipeline.id,
      columns,
    });
  } catch (err: any) {
    console.error("[getProjectKanbanAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch kanban");
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/tasks/:id/labels
   Body: { add?: string[], remove?: string[] }
───────────────────────────────────────────────────────────── */
export async function updateTaskLabelsAdmin(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;
    const adminAccountId = req.user?.accountId!;

    const { id: taskId } = req.params;
    const { add = [], remove = [] } = req.body as {
      add?: string[];
      remove?: string[];
    };

    const task = await prisma.task.findUnique({
      where: { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    await prisma.$transaction(async (tx) => {
      if (remove.length > 0) {
        await tx.taskLabel.deleteMany({
          where: { taskId, labelId: { in: remove } },
        });
      }
      if (add.length > 0) {
        await tx.taskLabel.createMany({
          data: add.map((labelId) => ({ taskId, labelId, addedBy: adminAccountId })),
          skipDuplicates: true,
        });
      }
    });

    const labels = await prisma.taskLabel.findMany({
      where: { taskId },
      select: { label: { select: { id: true, name: true, color: true } } },
    });

    const recipients = await resolveTaskRecipients(taskId);
    emitTaskPatch(taskId, recipients, { labels, updatedAt: new Date() });

    return sendSuccessResponse(res, 200, "Labels updated", { labels });
  } catch (err: any) {
    console.error("[updateTaskLabelsAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update labels");
  }
}