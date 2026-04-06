// src/core/job/recurringTask.job.ts
//
// Spawns new Task instances for every active recurring task whose
// next-due date has arrived.  Runs on a cron schedule (configurable,
// default every minute so it never misses a window).
//
// Algorithm
// ─────────
//  1. Find all "root" recurring tasks that have no recurrenceParentId
//     (i.e. they are the definition, not a generated instance).
//  2. For each, determine the "last generated" instance date by
//     looking at the most-recent child (recurrenceChildren).
//  3. Compute the next due date from the last instance (or from the
//     task's own startDate / createdAt if no instance exists yet).
//  4. If now >= nextDueDate → create a new child Task + copy assignments.
//  5. Idempotency: a unique dedupeKey stored in recurrenceRule prevents
//     double-spawning within the same window.

import cron from "node-cron";
import { prisma } from "../../../config/database.config";

import { TaskStatus, TaskRecurrenceType } from "@prisma/client";
import { logger } from "../../help/logs/logger";


/* ─────────────────────────────────────────────────────────────
   Date arithmetic helpers
───────────────────────────────────────────────────────────── */

/**
 * Given a reference date and a recurrence type, returns the Date
 * on which the *next* instance should be created.
 */
function computeNextDueDate(
  referenceDate: Date,
  recurrenceType: TaskRecurrenceType,
  customRule?: Record<string, any> | null,
): Date {
  const next = new Date(referenceDate);

  switch (recurrenceType) {
    case TaskRecurrenceType.DAILY:
      next.setDate(next.getDate() + 1);
      break;

    case TaskRecurrenceType.WEEKLY:
      next.setDate(next.getDate() + 7);
      break;

    case TaskRecurrenceType.BIWEEKLY:
      next.setDate(next.getDate() + 14);
      break;

    case TaskRecurrenceType.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      break;

    case TaskRecurrenceType.QUARTERLY:
      next.setMonth(next.getMonth() + 3);
      break;

    case TaskRecurrenceType.CUSTOM: {
      // customRule example: { intervalDays: 3 }
      const intervalDays = customRule?.intervalDays ?? 1;
      next.setDate(next.getDate() + intervalDays);
      break;
    }

    default:
      // ONE_TIME – should never be processed here, guard anyway
      next.setFullYear(next.getFullYear() + 100);
      break;
  }

  return next;
}

/**
 * Normalise a date to midnight UTC so daily tasks don't drift.
 */
function toMidnightUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/* ─────────────────────────────────────────────────────────────
   Core spawn logic (exported so it can be called in tests or
   triggered manually via an admin endpoint)
───────────────────────────────────────────────────────────── */

export async function spawnDueRecurringTasks(): Promise<{
  processed: number;
  spawned: number;
  errors: number;
}> {
  const now = new Date();
  let processed = 0;
  let spawned = 0;
  let errors = 0;

  // ── 1. Load all recurring root tasks ──────────────────────
  const rootTasks = await prisma.task.findMany({
    where: {
      isRecurring: true,
      recurrenceType: { not: TaskRecurrenceType.ONE_TIME },
      recurrenceParentId: null, // definition tasks only
      deletedAt: null,
      status: {
        // Skip cancelled/completed definitions TaskStatus.COMPLETED
        notIn: [TaskStatus.CANCELLED],
      },
    },
    include: {
      assignments: {
        select: {
          type: true,
          accountId: true,
          teamId: true,
          note: true,
        },
      },
      // Most-recent child = last generated instance
      recurrenceChildren: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          startDate: true,
          dueDate: true,
        },
      },
    },
  });

  logger.info(
    `[RecurringTask] Found ${rootTasks.length} active recurring task definition(s)`,
  );

  for (const task of rootTasks) {
    processed++;

    try {
      const lastChild = task.recurrenceChildren[0] ?? null;

      // ── 2. Determine reference date ────────────────────────
      // Use the last child's startDate / dueDate / createdAt,
      // or fall back to the definition's own startDate / createdAt.
      const referenceDate: Date = lastChild
        ? (lastChild.startDate ?? lastChild.dueDate ?? lastChild.createdAt)
        : (task.startDate ?? task.dueDate ?? task.createdAt);

      // ── 3. Compute next due date ───────────────────────────
      const customRule =
        task.recurrenceType === TaskRecurrenceType.CUSTOM &&
        task.recurrenceRule &&
        typeof task.recurrenceRule === "object"
          ? (task.recurrenceRule as Record<string, any>)
          : null;

      const nextDue = computeNextDueDate(
        referenceDate,
        task.recurrenceType,
        customRule,
      );

      // ── 4. Check whether it's time ─────────────────────────
      if (now < nextDue) {
        // Not yet due — skip
        continue;
      }

      // ── 5. Idempotency guard ───────────────────────────────
      // Use a dedupeKey based on parent task ID + next-due window
      // so we never double-spawn within the same scheduling tick.
      const windowKey = toMidnightUTC(nextDue).toISOString().slice(0, 10);
      const dedupeKey = `recurring:${task.id}:${windowKey}`;

      const alreadySpawned = await prisma.task.findFirst({
        where: {
          recurrenceParentId: task.id,
          // The recurrenceRule JSON stores our dedupeKey
          recurrenceRule: { path: ["dedupeKey"], equals: dedupeKey },
        },
        select: { id: true },
      });

      if (alreadySpawned) {
        logger.debug(
          `[RecurringTask] Already spawned for key ${dedupeKey}, skipping`,
        );
        continue;
      }

      // ── 6. Spawn child task inside a transaction ───────────
      await prisma.$transaction(async (tx) => {
        const child = await tx.task.create({
          data: {
            // Core fields copied from definition
            title: task.title,
            description: task.description,
            priority: task.priority,
            projectId: task.projectId,
            stepId: task.stepId,
            estimatedMinutes: task.estimatedMinutes,
            isSelfTask: task.isSelfTask,
            createdBy: task.createdBy,

            // Recurrence linkage
            recurrenceParentId: task.id,
            isRecurring: false, // instances are not themselves recurring
            recurrenceType: TaskRecurrenceType.ONE_TIME,

            // Scheduling
            startDate: nextDue,
            dueDate: task.dueDate
              ? computeNextDueDate(task.dueDate, task.recurrenceType, customRule)
              : null,

            // Fresh status
            status: TaskStatus.PENDING,

            // Idempotency key stored in recurrenceRule JSON
            recurrenceRule: { dedupeKey },
          },
        });

        // ── 7. Copy assignments ──────────────────────────────
        if (task.assignments.length > 0) {
          await tx.taskAssignment.createMany({
            data: task.assignments.map((a) => ({
              taskId: child.id,
              type: a.type,
              accountId: a.accountId ?? null,
              teamId: a.teamId ?? null,
              note: a.note ?? null,
              assignedBy: task.createdBy ?? null,
              status: TaskStatus.PENDING,
            })),
            skipDuplicates: true,
          });
        }

        // ── 8. Activity log ──────────────────────────────────
        await tx.activityLog.create({
          data: {
            entityType: "TASK",
            entityId: child.id,
            action: "CREATED",
            performedBy: null, // system-generated
            projectId: task.projectId ?? null,
            taskId: child.id,
            toState: {
              title: child.title,
              priority: child.priority,
              startDate: child.startDate,
              dueDate: child.dueDate,
              spawnedFrom: task.id,
              dedupeKey,
            },
            meta: {
              source: "recurring_scheduler",
              parentTaskId: task.id,
              recurrenceType: task.recurrenceType,
              windowKey,
            },
          },
        });

        logger.info(
          `[RecurringTask] Spawned child ${child.id} for parent ${task.id} (${task.recurrenceType}, window ${windowKey})`,
        );
      });

      spawned++;
    } catch (err: any) {
      errors++;
      logger.error(
        `[RecurringTask] Error processing task ${task.id}: ${err?.message}`,
        err,
      );
    }
  }

  logger.info(
    `[RecurringTask] Done — processed: ${processed}, spawned: ${spawned}, errors: ${errors}`,
  );

  return { processed, spawned, errors };
}

/* ─────────────────────────────────────────────────────────────
   Cron registration
   Schedule: every minute ("* * * * *")
   For less frequent polling, change to e.g. "0 * * * *" (hourly)
   or "0 0 * * *" (daily at midnight UTC).
───────────────────────────────────────────────────────────── */

export function registerRecurringTaskJob(): void {
  // Run every minute — fine-grained enough for DAILY tasks and above.
  // The idempotency guard prevents double-spawning on multiple ticks.
  const schedule = process.env.RECURRING_TASK_CRON ?? "* * * * *";

  cron.schedule(schedule, async () => {
    try {
      await spawnDueRecurringTasks();
    } catch (err: any) {
      logger.error("[RecurringTask] Unhandled scheduler error:", err);
    }
  });

  logger.info(
    `[RecurringTask] Scheduler registered (cron: "${schedule}")`,
  );
}