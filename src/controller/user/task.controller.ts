// src/controller/task/task.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import { TaskStatus, TaskPriority, AssignmentType } from "@prisma/client";

/* ═══════════════════════════════════════════════════════════════
   SNAPSHOT HELPERS  (mirrors lead.controller.ts pattern)
═══════════════════════════════════════════════════════════════ */

async function resolveAssigneeSnapshot(input: {
  accountId?: string | null;
  teamId?: string | null;
}) {
  if (input.accountId) {
    const acc = await prisma.account.findUnique({
      where:  { id: input.accountId },
      select: { id: true, firstName: true, lastName: true, designation: true },
    });
    return acc
      ? {
          type:        "ACCOUNT" as const,
          id:          acc.id,
          name:        `${acc.firstName} ${acc.lastName}`,
          designation: acc.designation ?? null,
        }
      : null;
  }

  if (input.teamId) {
    const team = await prisma.team.findUnique({
      where:  { id: input.teamId },
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
    where:  { id: accountId },
    select: { id: true, firstName: true, lastName: true, designation: true },
  });
  if (!acc) return null;
  return {
    id:          acc.id,
    name:        `${acc.firstName} ${acc.lastName}`,
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
    where:  { taskId },
    select: { accountId: true, teamId: true },
  });

  const ids = new Set<string>();

  for (const a of assignments) {
    if (a.accountId) {
      ids.add(a.accountId);
    } else if (a.teamId) {
      const members = await prisma.teamMember.findMany({
        where:  { teamId: a.teamId, isActive: true },
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
  taskId:     string,
  recipients: string[],
  patch:      Record<string, unknown>,
) {
  try {
    const io      = getIo();
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
  taskId:    string,
  accountId: string,
): Promise<boolean> {
  const direct = await prisma.taskAssignment.findFirst({
    where:  { taskId, accountId },
    select: { id: true },
  });
  if (direct) return true;

  const teamAssignments = await prisma.taskAssignment.findMany({
    where:  { taskId, teamId: { not: null } },
    select: { teamId: true },
  });

  for (const { teamId } of teamAssignments) {
    if (!teamId) continue;
    const member = await prisma.teamMember.findFirst({
      where:  { teamId, accountId, isActive: true },
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
  id:          true,
  title:       true,
  description: true,
  status:      true,
  priority:    true,
  dueDate:     true,
  startDate:   true,
  startedAt:   true,
  completedAt: true,
  isSelfTask:  true,
  sortOrder:   true,
  createdAt:   true,
  updatedAt:   true,

  project: { select: { id: true, name: true, status: true } },
  step:    { select: { id: true, name: true, order: true, color: true } },

  assignments: {
    select: {
      id:         true,
      type:       true,
      status:     true,
      note:       true,
      assignedAt: true,
      account: {
        select: {
          id: true, firstName: true, lastName: true,
          avatar: true, designation: true,
        },
      },
      team: { select: { id: true, name: true } },
    },
  },

  checklist: {
    select:  { id: true, title: true, status: true, order: true },
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
  loggedMinutes:    true,
  isRecurring:      true,
  recurrenceType:   true,

  parentTaskId: true,
  parentTask:   { select: { id: true, title: true, status: true } },

  subTasks: {
    where:   { deletedAt: null },
    select:  { id: true, title: true, status: true, priority: true, dueDate: true },
    orderBy: { sortOrder: "asc" as const },
  },

  attachments: {
    where:   { deletedAt: null },
    select:  {
      id: true, name: true, source: true,
      url: true, mimeType: true, sizeBytes: true, createdAt: true,
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
      priority       = "NONE",
      projectId,
      stepId,
      dueDate,
      startDate,
      estimatedMinutes,
      isSelfTask     = false,
      parentTaskId,
      labels         = [],
      note,                              // assignment handoff note
      accountId: assigneeAccountId,
      teamId:    assigneeTeamId,
    } = req.body as Record<string, any>;

    // ── Validation ─────────────────────────────────────────────
    if (!title?.trim())
      return sendErrorResponse(res, 400, "Task title is required");

    if (!assigneeAccountId && !assigneeTeamId && !isSelfTask)
      return sendErrorResponse(
        res, 400,
        "Assign to an account, a team, or mark as self task",
      );

    if (assigneeAccountId && assigneeTeamId)
      return sendErrorResponse(
        res, 400, "Provide either accountId or teamId, not both",
      );

    if (!Object.values(TaskPriority).includes(priority))
      return sendErrorResponse(
        res, 400,
        `Invalid priority. Must be one of: ${Object.values(TaskPriority).join(", ")}`,
      );

    // stepId must belong to the given project
    if (stepId && projectId) {
      const step = await prisma.pipelineStep.findFirst({
        where:  { id: stepId, pipeline: { projectId } },
        select: { id: true },
      });
      if (!step)
        return sendErrorResponse(
          res, 400, "Step does not belong to the specified project",
        );
    }

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: assigneeAccountId,
      teamId:    assigneeTeamId,
    });

    // ── Transaction ────────────────────────────────────────────
    const { task, recipientIds } = await prisma.$transaction(async (tx) => {

      const created = await tx.task.create({
        data: {
          title:            title.trim(),
          description:      description      ?? null,
          priority:         priority as TaskPriority,
          projectId:        projectId        ?? null,
          stepId:           stepId           ?? null,
          dueDate:          dueDate          ? new Date(dueDate)   : null,
          startDate:        startDate        ? new Date(startDate) : null,
          estimatedMinutes: estimatedMinutes ?? null,
          isSelfTask:       Boolean(isSelfTask),
          parentTaskId:     parentTaskId     ?? null,
          createdBy:        creatorAccountId,
          status:           TaskStatus.PENDING,
        },
        select: TASK_LIST_SELECT,
      });

      // ── Assignment ──────────────────────────────────────────
      if (assigneeAccountId || assigneeTeamId) {
        await tx.taskAssignment.create({
          data: {
            taskId:     created.id,
            type:       assigneeAccountId
              ? AssignmentType.ACCOUNT
              : AssignmentType.TEAM,
            accountId:  assigneeAccountId ?? null,
            teamId:     assigneeTeamId    ?? null,
            assignedBy: creatorAccountId,
            note:       note              ?? null,
            status:     TaskStatus.PENDING,
          },
        });
      }

      // ── Labels ─────────────────────────────────────────────
      if (labels.length > 0) {
        await tx.taskLabel.createMany({
          data: labels.map((labelId: string) => ({
            taskId:  created.id,
            labelId,
            addedBy: creatorAccountId,
          })),
          skipDuplicates: true,
        });
      }

      // ── Activity: CREATED ───────────────────────────────────
      await tx.activityLog.create({
        data: {
          entityType:  "TASK",
          entityId:    created.id,
          action:      "CREATED",
          performedBy: creatorAccountId,
          projectId:   projectId  ?? null,
          taskId:      created.id,
          toState: {
            title,
            priority,
            dueDate:  dueDate  ?? null,
            assignee: initialAssignee,
          },
          meta: {
            assignedTo: initialAssignee,
            note:       note ?? null,
          },
        },
      });

      // ── Socket recipients ───────────────────────────────────
      let recipientIds: string[] = [];
      if (assigneeAccountId) {
        recipientIds = [assigneeAccountId];
      } else if (assigneeTeamId) {
        const members = await tx.teamMember.findMany({
          where:  { teamId: assigneeTeamId, isActive: true },
          select: { accountId: true },
        });
        recipientIds = members.map((m) => m.accountId);
      }

      return { task: created, recipientIds };
    });

    // Re-fetch with assignment rows hydrated
    const fullTask = await prisma.task.findUnique({
      where:  { id: task.id },
      select: TASK_LIST_SELECT,
    });

    emitTaskCreated(recipientIds, fullTask as Record<string, unknown>);

    return sendSuccessResponse(res, 201, "Task created successfully", fullTask);
  } catch (err: any) {
    console.error("[createTaskAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create task");
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
      accountId?:       string;
      teamId?:          string;
      note?:            string;
      replaceExisting?: boolean;
    };

    if (!accountId && !teamId)
      return sendErrorResponse(res, 400, "Provide accountId or teamId");

    if (accountId && teamId)
      return sendErrorResponse(res, 400, "Provide either accountId or teamId, not both");

    const task = await prisma.task.findUnique({
      where:  { id: taskId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    // Snapshot previous for activity log
    const previousAssignments = await prisma.taskAssignment.findMany({
      where:  { taskId },
      select: {
        accountId: true,
        teamId:    true,
        account:   { select: { id: true, firstName: true, lastName: true } },
        team:      { select: { id: true, name: true } },
      },
    });

    const fromSnapshot = previousAssignments.map((a) =>
      a.account
        ? {
            type: "ACCOUNT",
            id:   a.account.id,
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
          type:       accountId ? AssignmentType.ACCOUNT : AssignmentType.TEAM,
          accountId:  accountId ?? null,
          teamId:     teamId    ?? null,
          assignedBy: performerAccountId,
          note:       note      ?? null,
          status:     TaskStatus.PENDING,
        },
      });

      await tx.activityLog.create({
        data: {
          entityType:  "TASK",
          entityId:    taskId,
          action:      "ASSIGNED",
          performedBy: performerAccountId,
          projectId:   task.projectId,
          taskId,
          fromState:   { assignees: fromSnapshot },
          toState:     { assignee:  toSnapshot },
          meta:        { note: note ?? null, replaceExisting },
        },
      });

      let newRecipients: string[] = [];
      if (accountId) {
        newRecipients = [accountId];
      } else if (teamId) {
        const members = await tx.teamMember.findMany({
          where:  { teamId, isActive: true },
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
      updatedAt:  new Date(),
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
      where:  { id, deletedAt: null },
      select: {
        id:          true,
        status:      true,
        priority:    true,
        dueDate:     true,
        stepId:      true,
        projectId:   true,
        startedAt:   true,
        completedAt: true,
      },
    });
    if (!existing) return sendErrorResponse(res, 404, "Task not found");

    const ALLOWED_FIELDS = [
      "title", "description", "priority", "status",
      "dueDate", "startDate", "estimatedMinutes",
      "stepId", "sortOrder", "parentTaskId",
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

    if (data.dueDate)   data.dueDate   = new Date(data.dueDate);
    if (data.startDate) data.startDate = new Date(data.startDate);

    const fromState = {
      status:   existing.status,
      priority: existing.priority,
      dueDate:  existing.dueDate,
      stepId:   existing.stepId,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where:  { id },
        data,
        select: TASK_DETAIL_SELECT,
      });

      await tx.activityLog.create({
        data: {
          entityType:  "TASK",
          entityId:    id,
          action:      "UPDATED",
          performedBy: adminAccountId,
          projectId:   existing.projectId,
          taskId:      id,
          fromState,
          toState:     data,
          meta:        { updatedFields: Object.keys(data) },
        },
      });

      return task;
    });

    const recipients = await resolveTaskRecipients(id);

    emitTaskPatch(id, recipients, {
      status:      updated.status,
      priority:    updated.priority,
      dueDate:     updated.dueDate,
      completedAt: updated.completedAt,
      updatedAt:   updated.updatedAt,
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

    const adminAccountId = req.user?.accountId;
    if (!adminAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where:  { id, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const recipients = await resolveTaskRecipients(id);

    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data:  { deletedAt: new Date(), deletedBy: adminAccountId },
      });

      await tx.activityLog.create({
        data: {
          entityType:  "TASK",
          entityId:    id,
          action:      "DELETED",
          performedBy: adminAccountId,
          projectId:   task.projectId,
          taskId:      id,
        },
      });
    });

    emitTaskPatch(id, recipients, { deletedAt: new Date() });

    return sendSuccessResponse(res, 200, "Task deleted");
  } catch (err: any) {
    console.error("[deleteTaskAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete task");
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
      page  = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page),  1);
    const pageSize   = Math.min(Number(limit), 100);
    const skip       = (pageNumber - 1) * pageSize;

    const where: any = { deletedAt: null };

    if (status)   where.status   = status   as TaskStatus;
    if (priority) where.priority = priority as TaskPriority;
    if (projectId) where.projectId = projectId;
    if (stepId)    where.stepId    = stepId;

    if (isSelfTask !== undefined)
      where.isSelfTask = isSelfTask === "true";

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate)   where.createdAt.lte = new Date(toDate);
    }

    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueAfter)  where.dueDate.gte = new Date(dueAfter);
      if (dueBefore) where.dueDate.lte = new Date(dueBefore);
    }

    if (search?.trim()) {
      where.OR = [
        { title:       { contains: search.trim(), mode: "insensitive" } },
        { description: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    if (assignedToAccountId || assignedToTeamId) {
      where.assignments = {
        some: {
          ...(assignedToAccountId ? { accountId: assignedToAccountId } : {}),
          ...(assignedToTeamId    ? { teamId:    assignedToTeamId    } : {}),
        },
      };
    }

    const orderBy = [
      { priority:  "desc" as const },
      { dueDate:   "asc"  as const },
      { createdAt: "desc" as const },
    ];

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy,
        skip,
        take:   pageSize,
        select: TASK_LIST_SELECT,
      }),
    ]);

    return sendSuccessResponse(res, 200, "Tasks fetched", {
      data: tasks,
      meta: {
        page:       pageNumber,
        limit:      pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext:    pageNumber * pageSize < total,
        hasPrev:    pageNumber > 1,
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
      where:  { id, deletedAt: null },
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
    const page  = Math.max(Number(req.query.page  ?? 1), 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 100);

    const task = await prisma.task.findUnique({
      where:  { id },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const [total, activity] = await Promise.all([
      prisma.activityLog.count({ where: { taskId: id } }),
      prisma.activityLog.findMany({
        where:   { taskId: id },
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * limit,
        take:    limit,
        select: {
          id:          true,
          action:      true,
          entityType:  true,
          meta:        true,
          fromState:   true,
          toState:     true,
          createdAt:   true,
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
      where:  { id: { in: actorIds } },
      select: {
        id: true, firstName: true, lastName: true,
        designation: true, avatar: true,
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
      data:   enriched,
      meta: {
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("[getTaskActivityAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch activity");
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
      if (toDate)   where.createdAt.lte = new Date(toDate);
    }

    if (assignedToAccountId) {
      where.assignments = { some: { accountId: assignedToAccountId } };
    }

    const grouped = await prisma.task.groupBy({
      by:     ["status"],
      where,
      _count: { _all: true },
    });

    const stats: Record<string, number> = {
      PENDING:     0,
      IN_PROGRESS: 0,
      IN_REVIEW:   0,
      BLOCKED:     0,
      COMPLETED:   0,
      CANCELLED:   0,
      TOTAL:       0,
      OVERDUE:     0,
    };

    for (const row of grouped) {
      stats[row.status]  = row._count._all;
      stats.TOTAL       += row._count._all;
    }

    stats.OVERDUE = await prisma.task.count({
      where: {
        ...where,
        dueDate: { lt: new Date() },
        status:  { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      },
    });

    return sendSuccessResponse(res, 200, "Task stats fetched", stats);
  } catch (err: any) {
    console.error("[getTaskStatsAdmin]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch stats");
  }
}










/* ═══════════════════════════════════════════════════════════════
   ░░░░░░░░░░░░░░░░  USER CONTROLLERS  ░░░░░░░░░░░░░░░░░░░░░░░░
═══════════════════════════════════════════════════════════════ */

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
      page  = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page),  1);
    const pageSize   = Math.min(Number(limit), 100);
    const skip       = (pageNumber - 1) * pageSize;

    // Expand team memberships
    const teamMemberships = await prisma.teamMember.findMany({
      where:  { accountId, isActive: true },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((m) => m.teamId);

    const where: any = {
      deletedAt:   null,
      assignments: {
        some: {
          OR: [
            { accountId },
            ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
          ],
        },
      },
    };

    if (status)    where.status    = status    as TaskStatus;
    if (priority)  where.priority  = priority  as TaskPriority;
    if (projectId) where.projectId = projectId;

    if (search?.trim()) {
      where.AND = [{
        OR: [
          { title:       { contains: search.trim(), mode: "insensitive" } },
          { description: { contains: search.trim(), mode: "insensitive" } },
        ],
      }];
    }

    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueAfter)  where.dueDate.gte = new Date(dueAfter);
      if (dueBefore) where.dueDate.lte = new Date(dueBefore);
    }

    const orderBy = [
      { priority:  "desc" as const },
      { dueDate:   "asc"  as const },
      { updatedAt: "desc" as const },
    ];

    const [total, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy,
        skip,
        take:   pageSize,
        select: TASK_LIST_SELECT,
      }),
    ]);

    return sendSuccessResponse(res, 200, "My tasks fetched", {
      data: tasks,
      meta: {
        page:       pageNumber,
        limit:      pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext:    pageNumber * pageSize < total,
        hasPrev:    pageNumber > 1,
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
      where:  { id, deletedAt: null },
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
        res, 400,
        `status must be one of: ${Object.values(TaskStatus).join(", ")}`,
      );

    // Users cannot self-cancel
    if (status === TaskStatus.CANCELLED)
      return sendErrorResponse(res, 403, "Only admins can cancel tasks");

    const hasAccess = await isAssignedToTask(id, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where:  { id, deletedAt: null },
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
    if (status === TaskStatus.IN_PROGRESS && fromStatus === TaskStatus.COMPLETED) {
      timestamps.completedAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where:  { id },
        data:   { status, ...timestamps },
        select: TASK_LIST_SELECT,
      });

      // Keep per-assignee status row in sync
      await tx.taskAssignment.updateMany({
        where: { taskId: id, accountId },
        data: {
          status,
          note:      note      ?? undefined,
          updatedAt: new Date(),
        },
      });

      await tx.activityLog.create({
        data: {
          entityType:  "TASK",
          entityId:    id,
          action:      "STATUS_CHANGED",
          performedBy: accountId,
          projectId:   task.projectId,
          taskId:      id,
          fromState:   { status: fromStatus },
          toState:     { status, ...timestamps },
          meta: {
            note:      note ?? null,
            changedBy: accountId,
          },
        },
      });

      return result;
    });

    const recipients = await resolveTaskRecipients(id);

    emitTaskPatch(id, recipients, {
      status:      updated.status,
      completedAt: updated.completedAt,
      updatedAt:   updated.updatedAt,
      changedBy:   accountId,
      note:        note ?? null,
    });

    return sendSuccessResponse(res, 200, "Task status updated", {
      id:          updated.id,
      status:      updated.status,
      completedAt: updated.completedAt,
      updatedAt:   updated.updatedAt,
    });
  } catch (err: any) {
    console.error("[updateTaskStatusUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update status");
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
      where:  { id, deletedAt: null },
      select: {
        id:        true,
        status:    true,
        projectId: true,
        checklist: {
          where:  { status: "PENDING" },
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
    const completedAt           = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.task.update({
        where:  { id },
        data:   { status: TaskStatus.COMPLETED, completedAt },
        select: TASK_LIST_SELECT,
      });

      await tx.taskAssignment.updateMany({
        where: { taskId: id, accountId },
        data: {
          status:    TaskStatus.COMPLETED,
          note:      note      ?? undefined,
          updatedAt: new Date(),
        },
      });

      await tx.activityLog.create({
        data: {
          entityType:  "TASK",
          entityId:    id,
          action:      "COMPLETED",
          performedBy: accountId,
          projectId:   task.projectId,
          taskId:      id,
          fromState:   { status: task.status },
          toState:     { status: TaskStatus.COMPLETED, completedAt },
          meta: {
            note:                 note ?? null,
            pendingChecklistCount,
          },
        },
      });

      return result;
    });

    const recipients = await resolveTaskRecipients(id);

    emitTaskPatch(id, recipients, {
      status:      TaskStatus.COMPLETED,
      completedAt,
      updatedAt:   updated.updatedAt,
      completedBy: accountId,
      note:        note ?? null,
    });

    return sendSuccessResponse(res, 200, "Task completed", {
      id:                   updated.id,
      status:               updated.status,
      completedAt,
      pendingChecklistCount, // client: "3 checklist items still open" if > 0
    });
  } catch (err: any) {
    console.error("[completeTaskUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to complete task");
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
      where:  { id, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const activity = await prisma.activityLog.findMany({
      where:   { taskId: id },
      orderBy: { createdAt: "desc" },
      take:    100,
      select: {
        id:          true,
        action:      true,
        meta:        true,
        toState:     true,
        fromState:   true,
        performedBy: true,
        createdAt:   true,
      },
    });

    const actorIds = [
      ...new Set(
        activity.map((a) => a.performedBy).filter(Boolean) as string[],
      ),
    ];
    const actors = await prisma.account.findMany({
      where:  { id: { in: actorIds } },
      select: {
        id: true, firstName: true, lastName: true,
        designation: true, avatar: true,
      },
    });
    const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));

    const enriched = activity.map((a) => ({
      ...a,
      performer: a.performedBy ? (actorMap[a.performedBy] ?? null) : null,
    }));

    return sendSuccessResponse(res, 200, "Task activity fetched", {
      taskId: id,
      total:  enriched.length,
      data:   enriched,
    });
  } catch (err: any) {
    console.error("[getTaskActivityUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch activity");
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
      content:          string;
      parentCommentId?: string;
      mentions?:        string[];
    };

    if (!content?.trim())
      return sendErrorResponse(res, 400, "Comment content is required");

    const hasAccess = await isAssignedToTask(taskId, accountId);
    if (!hasAccess)
      return sendErrorResponse(res, 403, "You are not assigned to this task");

    const task = await prisma.task.findUnique({
      where:  { id: taskId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskComment.create({
        data: {
          taskId,
          authorId:        accountId,
          content:         content.trim(),
          parentCommentId: parentCommentId ?? null,
        },
        select: {
          id:              true,
          content:         true,
          createdAt:       true,
          parentCommentId: true,
          author: {
            select: {
              id: true, firstName: true, lastName: true, avatar: true,
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
          entityType:  "TASK",
          entityId:    taskId,
          action:      "COMMENTED",
          performedBy: accountId,
          projectId:   task.projectId,
          taskId,
          meta: {
            commentId:       created.id,
            parentCommentId: parentCommentId ?? null,
            mentions,
          },
        },
      });

      return created;
    });

    // Notify assignees + mentioned accounts (skip the author)
    const taskRecipients = await resolveTaskRecipients(taskId);
    const allRecipients  = [
      ...new Set([...taskRecipients, ...mentions]),
    ].filter((id) => id !== accountId);

    try {
      const io      = getIo();
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
      where:  { id: taskId, deletedAt: null },
      select: { id: true },
    });
    if (!task) return sendErrorResponse(res, 404, "Task not found");

    const comments = await prisma.taskComment.findMany({
      where:   { taskId, parentCommentId: null, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id:        true,
        content:   true,
        reactions: true,
        editedAt:  true,
        createdAt: true,
        author: {
          select: {
            id: true, firstName: true, lastName: true, avatar: true,
          },
        },
        replies: {
          where:   { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            id:        true,
            content:   true,
            reactions: true,
            editedAt:  true,
            createdAt: true,
            author: {
              select: {
                id: true, firstName: true, lastName: true, avatar: true,
              },
            },
          },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Comments fetched", {
      taskId,
      total: comments.length,
      data:  comments,
    });
  } catch (err: any) {
    console.error("[getTaskCommentsUser]", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch comments");
  }
}