// // src/core/job/recurringTask.job.ts
// //
// // Spawns new Task instances for every active recurring task whose
// // next-due date has arrived.  Runs on a cron schedule (configurable,
// // default every minute so it never misses a window).
// //
// // Algorithm
// // ─────────
// //  1. Find all "root" recurring tasks that have no recurrenceParentId
// //     (i.e. they are the definition, not a generated instance).
// //  2. For each, determine the "last generated" instance date by
// //     looking at the most-recent child (recurrenceChildren).
// //  3. Compute the next due date from the last instance (or from the
// //     task's own startDate / createdAt if no instance exists yet).
// //  4. If now >= nextDueDate → create a new child Task + copy assignments.
// //  5. Idempotency: a unique dedupeKey stored in recurrenceRule prevents
// //     double-spawning within the same window.

// import cron from "node-cron";
// import { prisma } from "../../../config/database.config";

// import { TaskStatus, TaskRecurrenceType } from "@prisma/client";
// import { logger } from "../../help/logs/logger";
// import { triggerTaskNotification } from "../../../services/notifications";


// /* ─────────────────────────────────────────────────────────────
//    Date arithmetic helpers
// ───────────────────────────────────────────────────────────── */

// /**
//  * Given a reference date and a recurrence type, returns the Date
//  * on which the *next* instance should be created.
//  */
// function computeNextDueDate(
//   referenceDate: Date,
//   recurrenceType: TaskRecurrenceType,
//   customRule?: Record<string, any> | null,
// ): Date {
//   const next = new Date(referenceDate);

//   switch (recurrenceType) {
//     case TaskRecurrenceType.DAILY:
//       next.setDate(next.getDate() + 1);
//       break;

//     case TaskRecurrenceType.WEEKLY:
//       next.setDate(next.getDate() + 7);
//       break;

//     case TaskRecurrenceType.BIWEEKLY:
//       next.setDate(next.getDate() + 14);
//       break;

//     case TaskRecurrenceType.MONTHLY:
//       next.setMonth(next.getMonth() + 1);
//       break;

//     case TaskRecurrenceType.QUARTERLY:
//       next.setMonth(next.getMonth() + 3);
//       break;

//     case TaskRecurrenceType.CUSTOM: {
//       // customRule example: { intervalDays: 3 }
//       const intervalDays = customRule?.intervalDays ?? 1;
//       next.setDate(next.getDate() + intervalDays);
//       break;
//     }

//     default:
//       // ONE_TIME – should never be processed here
//       next.setFullYear(next.getFullYear() + 100);
//       break;
//   }

//   return next;
// }

// /**
//  * Normalise a date to midnight UTC so daily tasks don't drift.
//  */
// function toMidnightUTC(d: Date): Date {
//   return new Date(
//     Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
//   );
// }

// /* ─────────────────────────────────────────────────────────────
//    Core spawn logic (exported so it can be called in tests or
//    triggered manually via an admin endpoint)
// ───────────────────────────────────────────────────────────── */

// export async function spawnDueRecurringTasks(): Promise<{
//   processed: number;
//   spawned: number;
//   errors: number;
// }> {
//   const now = new Date();
//   let processed = 0;
//   let spawned = 0;
//   let errors = 0;

//   // ── 1. Load all active recurring root tasks ────────────────
//   const rootTasks = await prisma.task.findMany({
//     where: {
//       isRecurring: true,
//       recurrenceType: { not: TaskRecurrenceType.ONE_TIME },
//       recurrenceParentId: null,   // definition rows only
//       deletedAt: null,
//       status: { notIn: [TaskStatus.CANCELLED, TaskStatus.PENDING] },
//     },
//     include: {
//       assignments: true,
//       labels: true,
//       checklist: true,
//       // Most-recent spawned child (ordered by the date it was spawned)
//       recurrenceChildren: {
//         orderBy: { createdAt: "desc" },
//         take: 1,
//         select: {
//           id: true,
//           assignments: true,
//           labels: true,
//           checklist: true,
//           createdAt: true,   // when it was spawned — used as reference for next due
//           startDate: true,   // the scheduled "work begins" date of that child
//           dueDate: true,
//           status: true,
//         },
//       },
//     },
//   });

//   logger.info(
//     `[RecurringTask] Found ${rootTasks.length} active recurring definition(s)`,
//   );

//   for (const task of rootTasks) {
//     processed++;

//     try {
//       const lastChild = task.recurrenceChildren[0] ?? null;

//       if (lastChild && lastChild.status !== TaskStatus.COMPLETED) {
//         continue;
//       }

//       const customRule =
//         task.recurrenceType === TaskRecurrenceType.CUSTOM &&
//           task.recurrenceRule &&
//           typeof task.recurrenceRule === "object"
//           ? (task.recurrenceRule as Record<string, any>)
//           : null;

//       let nextDue: Date;
//       let windowKey: string;

//       if (lastChild && lastChild.status !== TaskStatus.COMPLETED) {
//         logger.debug(
//           `[RecurringTask] Skipping ${task.id} because last child (${lastChild.id}) is not completed (status: ${lastChild.status})`
//         );
//         continue;
//       }

//       if (!lastChild) {
//         // ── First instance ──────────────────────────────────────
//         // The very first child should be created on (or after) the
//         // task's own startDate. If no startDate, fall back to createdAt.
//         // We do NOT add an interval here — the definition's startDate IS
//         // the first due date.
//         const firstDue = task.startDate ?? task.createdAt;
//         nextDue = toMidnightUTC(firstDue);
//         windowKey = nextDue.toISOString().slice(0, 10);
//       } else {
//         // ── Subsequent instances ────────────────────────────────
//         // Use the last child's startDate as the reference and add one interval.
//         // lastChild.startDate is the "work date" that was assigned to that child
//         // when it was spawned (= its nextDue at spawn time).
//         const reference = lastChild.startDate ?? lastChild.createdAt;
//         nextDue = computeNextDueDate(reference, task.recurrenceType, customRule);
//         windowKey = toMidnightUTC(nextDue).toISOString().slice(0, 10);
//       }

//       // ── 4. Check whether it's time ─────────────────────────
//       if (now < nextDue) {
//         // Not yet due — skip silently
//         continue;
//       }

//       // ── 5. Idempotency guard ───────────────────────────────
//       const dedupeKey = `recurring:${task.id}:${windowKey}`;

//       const alreadySpawned = await prisma.task.findFirst({
//         where: {
//           recurrenceParentId: task.id,
//           recurrenceRule: { path: ["dedupeKey"], equals: dedupeKey },
//         },
//         select: { id: true },
//       });

//       if (alreadySpawned) {
//         logger.debug(
//           `[RecurringTask] Already spawned for key ${dedupeKey}, skipping`,
//         );
//         continue;
//       }

//       const source: any = lastChild ?? task;

//       // ── 6. Spawn child inside a transaction ───────────────
//       const result = await prisma.$transaction(async (tx) => {

//         const child = await tx.task.create({
//           data: {
//             // ── Core fields copied from the definition ──────
//             title: source.title,
//             description: source.description,
//             priority: source.priority,
//             projectId: source.projectId,
//             stepId: source.stepId,
//             estimatedMinutes: source.estimatedMinutes,
//             isSelfTask: source.isSelfTask,
//             // createdBy: task.createdBy,
//             createdAt: new Date(),

//             // ── Recurrence linkage ──────────────────────────
//             recurrenceParentId: task.id,
//             isRecurring: false,                        // instances are NOT themselves recurring
//             recurrenceType: TaskRecurrenceType.ONE_TIME,

//             // ── Scheduling ──────────────────────────────────
//             startDate: nextDue,
//             dueDate: task.dueDate
//               ? computeNextDueDate(task.dueDate, task.recurrenceType, customRule)
//               : null,

//             // ── Fresh status ────────────────────────────────
//             status: TaskStatus.PENDING,

//             // ── Idempotency key ─────────────────────────────
//             recurrenceRule: { dedupeKey },
//           },
//         });

//         let recipientAccountIds: string[] = [];

//         // console.log("\n\n\n\n\n\n\n\n\n\n\n\n\n\n--> task.assignments\n", task.assignments)
//         const assignmentSource =
//           source.assignments?.length ? source.assignments : task.assignments;

//         // ── 7. Copy assignments (preserves original assignees) ─
//         if (assignmentSource?.length) {
//           await tx.taskAssignment.createMany({
//             data: assignmentSource.map((a: any) => ({
//               taskId: child.id,
//               type: a.type,
//               accountId: a.accountId ?? null,
//               teamId: a.teamId ?? null,
//               note: a.note ?? null,
//               assignedBy: task.createdBy ?? null,
//               status: TaskStatus.PENDING,
//             })),
//             skipDuplicates: true,
//           });

//           recipientAccountIds = assignmentSource
//             .map((a: any) => a.accountId)
//             .filter(Boolean);
//         }


//         // ─────────────────────────────
//         // ✅ COPY LABELS
//         // ─────────────────────────────
//         if (source.labels?.length) {
//           await tx.taskLabel.createMany({
//             data: source.labels.map((l: any) => ({
//               taskId: child.id,
//               labelId: l.labelId,
//               addedBy: task.createdBy ?? null,
//             })),
//             skipDuplicates: true,
//           });
//         }

//         // ─────────────────────────────
//         // ✅ COPY CHECKLIST (RESET)
//         // ─────────────────────────────
//         if (source.checklist?.length) {
//           await tx.checklistItem.createMany({
//             data: source.checklist.map((item: any, idx: number) => ({
//               taskId: child.id,
//               title: item.title,
//               order: idx,
//               status: "PENDING", // 🔥 reset
//               assignedTo: item.assignedTo ?? null,
//               dueDate: item.dueDate ?? null,
//               createdBy: task.createdBy ?? null,
//             })),
//           });
//         }

//         // ── 8. Activity log ─────────────────────────────────
//         await tx.activityLog.create({
//           data: {
//             entityType: "TASK",
//             entityId: child.id,
//             action: "CREATED",
//             performedBy: null,   // system-generated
//             projectId: task.projectId ?? null,
//             taskId: child.id,
//             toState: {
//               title: child.title,
//               priority: child.priority,
//               startDate: child.startDate,
//               dueDate: child.dueDate,
//               spawnedFrom: task.id,
//               dedupeKey,
//             },
//             meta: {
//               source: "recurring_scheduler",
//               parentTaskId: task.id,
//               recurrenceType: task.recurrenceType,
//               windowKey,
//               isFirstInstance: !lastChild,
//               clonedFrom: source.id,
//             },
//           },
//         });

//         logger.info(
//           `[RecurringTask] Spawned child ${child.id} for parent ${task.id}` +
//           ` (${task.recurrenceType}, window ${windowKey}${!lastChild ? ", FIRST instance" : ""})`,
//         );
//         return { childId: child.id, recipientAccountIds };
//       });

//       if (result.recipientAccountIds.length > 0) {


//         await triggerTaskNotification({
//           taskId: result.childId,
//           event: "CREATED",
//           performedByAccountId: task.createdBy ?? null,
//           // performedByAccountId: null,
//           recipientAccountIds: result.recipientAccountIds,
//         });
//       }

//       spawned++;
//     } catch (err: any) {
//       errors++;
//       logger.error(
//         `[RecurringTask] Error processing task ${task.id}: ${err?.message}`,
//         err,
//       );
//     }
//   }

//   logger.info(
//     `[RecurringTask] Done — processed: ${processed}, spawned: ${spawned}, errors: ${errors}`,
//   );

//   return { processed, spawned, errors };
// }



// export function registerRecurringTaskJob(): void {
//   const schedule = process.env.RECURRING_TASK_CRON ?? "0 0 * * *";  // default: daily at midnight UTC

//   cron.schedule(schedule, async () => {
//     try {
//       await spawnDueRecurringTasks();
//     } catch (err: any) {
//       logger.error("[RecurringTask] Unhandled scheduler error:", err);
//     }
//   });

//   logger.info(
//     `[RecurringTask] Scheduler registered (cron: "${schedule}")`,
//   );
// }


/* ─────────────────────────────────────────────────────────────
   Cron registration
   Schedule: every minute ("* * * * *")
   For less frequent polling, change to e.g. "0 * * * *" (hourly)
   or "0 0 * * *" (daily at midnight UTC).
───────────────────────────────────────────────────────────── */


// src/core/job/recurringTask/recurringTask.job.ts
//
// Spawns new Task instances for every active recurring task whose
// next-due window has arrived.
//
// Key design decisions
// ────────────────────
// • ONE instance per window per parent.  Idempotency is enforced by a
//   unique child row keyed on (recurrenceParentId + startDate/dedupeKey).
// • We do NOT gate spawning on whether the previous child is COMPLETED.
//   Recurring means "create on schedule" — completion tracking is separate.
// • "Window key" = ISO date string (YYYY-MM-DD) so UTC midnight is the
//   shared boundary regardless of server timezone.
// • The JSON-path query for the dedupe key is replaced by a direct column
//   lookup (startDate), which is indexed and unambiguous.

import cron from "node-cron";
import { prisma } from "../../../config/database.config";
import { TaskStatus, TaskRecurrenceType } from "@prisma/client";
import { logger } from "../../help/logs/logger";
import { triggerTaskNotification } from "../../../services/notifications";

/* ═══════════════════════════════════════════════════════════════
   DATE HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * Truncates a Date to midnight UTC, returning a new Date.
 * e.g. 2025-06-15T14:33:00Z  →  2025-06-15T00:00:00.000Z
 */
function toMidnightUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Returns today's window key (YYYY-MM-DD in UTC).
 */
function todayWindowKey(now: Date = new Date()): string {
  return toMidnightUTC(now).toISOString().slice(0, 10);
}

/**
 * Given a reference Date and a recurrence type, returns the Date of
 * the **next** window start (at midnight UTC).
 *
 * `referenceDate` should already be a window-start (midnight UTC).
 */
function nextWindowAfter(
  referenceDate: Date,
  recurrenceType: TaskRecurrenceType,
  customRule?: Record<string, any> | null,
): Date {
  // Work in UTC-day arithmetic to avoid DST issues.
  const ref = toMidnightUTC(referenceDate);

  switch (recurrenceType) {
    case TaskRecurrenceType.DAILY:
      return new Date(ref.getTime() + 1 * 24 * 60 * 60 * 1000);

    case TaskRecurrenceType.WEEKLY:
      return new Date(ref.getTime() + 7 * 24 * 60 * 60 * 1000);

    case TaskRecurrenceType.BIWEEKLY:
      return new Date(ref.getTime() + 14 * 24 * 60 * 60 * 1000);

    case TaskRecurrenceType.MONTHLY: {
      const d = new Date(ref);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return toMidnightUTC(d);
    }

    case TaskRecurrenceType.QUARTERLY: {
      const d = new Date(ref);
      d.setUTCMonth(d.getUTCMonth() + 3);
      return toMidnightUTC(d);
    }

    case TaskRecurrenceType.CUSTOM: {
      const intervalDays =
        typeof customRule?.intervalDays === "number" && customRule.intervalDays > 0
          ? customRule.intervalDays
          : 1;
      return new Date(ref.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    }

    default:
      // ONE_TIME — should never reach here; push far into the future as a guard.
      return new Date(ref.getTime() + 365 * 24 * 60 * 60 * 1000 * 100);
  }
}

/**
 * Returns the window key (YYYY-MM-DD UTC) for a given Date.
 */
function windowKey(d: Date): string {
  return toMidnightUTC(d).toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════════════════════════════
   CORE SPAWN FUNCTION
═══════════════════════════════════════════════════════════════ */

export async function spawnDueRecurringTasks(): Promise<{
  processed: number;
  spawned: number;
  skipped: number;
  errors: number;
}> {
  const now = new Date();
  const todayKey = todayWindowKey(now);
  const todayMidnight = toMidnightUTC(now);

  let processed = 0;
  let spawned = 0;
  let skipped = 0;
  let errors = 0;

  // ── 1. Load all recurring root-task definitions ─────────────
  //
  //  Include:
  //   • All statuses except CANCELLED — a PENDING/IN_PROGRESS/COMPLETED
  //     definition should still spawn children on schedule.
  //   • recurrenceParentId: null  →  root definitions only (not instances).
  //   • recurrenceType != ONE_TIME → actually recurring.
  //
  const rootTasks = await prisma.task.findMany({
    where: {
      isRecurring: true,
      recurrenceType: { not: TaskRecurrenceType.ONE_TIME },
      recurrenceParentId: null,
      deletedAt: null,
      status: { not: TaskStatus.CANCELLED },
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      projectId: true,
      stepId: true,
      estimatedMinutes: true,
      isSelfTask: true,
      createdBy: true,
      createdAt: true,
      startDate: true,
      dueDate: true,
      recurrenceType: true,
      recurrenceRule: true,
      // Assignments on the definition (used for the very first spawn, and
      // as a fallback if the last child has no assignments).
      assignments: {
        select: {
          type: true,
          accountId: true,
          teamId: true,
          note: true,
        },
      },
      labels: {
        select: { labelId: true },
      },
      checklist: {
        orderBy: { order: "asc" },
        select: {
          title: true,
          order: true,
          assignedTo: true,
          dueDate: true,
        },
      },
      // Most-recently spawned child — used to determine the LAST window
      // that was already generated, so we know what window comes NEXT.
      recurrenceChildren: {
        where: { deletedAt: null },
        orderBy: { startDate: "desc" },
        take: 1,
        select: {
          id: true,
          startDate: true,
          createdAt: true,
          assignments: {
            select: {
              type: true,
              accountId: true,
              teamId: true,
              note: true,
            },
          },
          labels: {
            select: { labelId: true },
          },
          checklist: {
            orderBy: { order: "asc" },
            select: {
              title: true,
              order: true,
              assignedTo: true,
              dueDate: true,
            },
          },
        },
      },
    },
  });

  logger.info(
    `[RecurringTask] ${rootTasks.length} active recurring definition(s) found for window ${todayKey}`,
  );

  for (const task of rootTasks) {
    processed++;

    try {
      const customRule =
        task.recurrenceType === TaskRecurrenceType.CUSTOM &&
        task.recurrenceRule &&
        typeof task.recurrenceRule === "object"
          ? (task.recurrenceRule as Record<string, any>)
          : null;

      const lastChild = task.recurrenceChildren[0] ?? null;

      // ── 2. Determine which window should be generated NEXT ──
      //
      // If no child exists yet → the first window is the task's own
      // startDate (falling back to createdAt).  We do NOT add an interval
      // here: the definition's startDate IS the first scheduled occurrence.
      //
      // If a child exists → advance one interval past the last child's
      // startDate.  This means even if we missed several windows (e.g.
      // server was down) we will only ever create ONE new child per cron
      // tick — the next overdue window.  The next cron tick will catch up
      // to the following window, and so on, until we are current.
      let nextWindowStart: Date;

      if (!lastChild) {
        // First occurrence = definition's startDate (midnight UTC).
        const firstOccurrence = task.startDate ?? task.createdAt;
        nextWindowStart = toMidnightUTC(firstOccurrence);
      } else {
        // Next occurrence = interval after the last spawned child's window.
        const lastWindowStart = lastChild.startDate
          ? toMidnightUTC(lastChild.startDate)
          : toMidnightUTC(lastChild.createdAt);

        nextWindowStart = nextWindowAfter(
          lastWindowStart,
          task.recurrenceType,
          customRule,
        );
      }

      const nextKey = windowKey(nextWindowStart);

      // ── 3. Is this window due yet? ──────────────────────────
      //
      // "Due" means nextWindowStart <= now (i.e. today >= nextWindowStart).
      // We compare as UTC midnight dates to avoid sub-day jitter.
      if (nextWindowStart > todayMidnight) {
        logger.debug(
          `[RecurringTask] ${task.id} next window ${nextKey} is in the future — skip`,
        );
        skipped++;
        continue;
      }

      // ── 4. Idempotency — has this window already been spawned? ──
      //
      // We store startDate = nextWindowStart on every child, so a
      // simple DB lookup is the dedupe guard.  This is far more reliable
      // than a JSON-path filter on recurrenceRule.
      const alreadySpawned = await prisma.task.findFirst({
        where: {
          recurrenceParentId: task.id,
          startDate: nextWindowStart,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (alreadySpawned) {
        logger.debug(
          `[RecurringTask] Window ${nextKey} already spawned for ${task.id} (child: ${alreadySpawned.id}) — skip`,
        );
        skipped++;
        continue;
      }

      // ── 5. Determine the source of assignments / labels / checklist ─
      //
      // Prefer the last child's data (it may have been re-assigned after
      // creation).  Fall back to the root definition.
      const assignmentSource =
        lastChild?.assignments?.length
          ? lastChild.assignments
          : task.assignments;

      const labelSource =
        lastChild?.labels?.length ? lastChild.labels : task.labels;

      const checklistSource =
        lastChild?.checklist?.length ? lastChild.checklist : task.checklist;

      // ── 6. Compute the dueDate for this child (optional) ────
      //
      // If the root task has a dueDate, we compute a relative dueDate for
      // the child by advancing it by the same interval from nextWindowStart.
      // This keeps the "days until due" constant across instances.
      let childDueDate: Date | null = null;
      if (task.dueDate) {
        childDueDate = nextWindowAfter(
          nextWindowStart,
          task.recurrenceType,
          customRule,
        );
        // Subtract 1 interval to keep relative offset: the due date should
        // be relative to this window, not the next one.
        // e.g. DAILY task with dueDate = startDate + 1 day → each child
        // also has dueDate = its startDate + 1 day.
        // We compute: dueDate offset from original = task.dueDate - (task.startDate ?? task.createdAt)
        const originStart = toMidnightUTC(task.startDate ?? task.createdAt);
        const originDue = toMidnightUTC(task.dueDate);
        const offsetMs = originDue.getTime() - originStart.getTime();
        childDueDate = new Date(nextWindowStart.getTime() + offsetMs);
      }

      // ── 7. Spawn inside a transaction ───────────────────────
      const dedupeKey = `recurring:${task.id}:${nextKey}`;

      const { childId, recipientAccountIds } = await prisma.$transaction(
        async (tx) => {
          // Create the child task
          const child = await tx.task.create({
            data: {
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
              isRecurring: false,
              recurrenceType: TaskRecurrenceType.ONE_TIME,

              // Scheduling
              startDate: nextWindowStart,
              dueDate: childDueDate,

              // Status
              status: TaskStatus.PENDING,

              // Dedupe metadata stored for human-readable audit trail.
              // We do NOT rely on this for idempotency (we use startDate above).
              recurrenceRule: { dedupeKey, windowKey: nextKey },
            },
          });

          // Copy assignments
          const recipients: string[] = [];
          if (assignmentSource.length > 0) {
            await tx.taskAssignment.createMany({
              data: assignmentSource.map((a) => ({
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

            // Resolve direct account recipients for notification
            for (const a of assignmentSource) {
              if (a.accountId) {
                recipients.push(a.accountId);
              } else if (a.teamId) {
                const members = await tx.teamMember.findMany({
                  where: { teamId: a.teamId, isActive: true },
                  select: { accountId: true },
                });
                members.forEach((m) => recipients.push(m.accountId));
              }
            }
          }

          // Copy labels
          if (labelSource.length > 0) {
            await tx.taskLabel.createMany({
              data: labelSource.map((l) => ({
                taskId: child.id,
                labelId: l.labelId,
                addedBy: task.createdBy ?? null,
              })),
              skipDuplicates: true,
            });
          }

          // Copy checklist (always reset to PENDING)
          if (checklistSource.length > 0) {
            await tx.checklistItem.createMany({
              data: checklistSource.map((item, idx) => ({
                taskId: child.id,
                title: item.title,
                order: item.order ?? idx,
                status: "PENDING" as const,
                assignedTo: item.assignedTo ?? null,
                dueDate: item.dueDate ?? null,
                createdBy: task.createdBy ?? null,
              })),
            });
          }

          // Activity log
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
                windowKey: nextKey,
                isFirstInstance: !lastChild,
              },
            },
          });

          return {
            childId: child.id,
            recipientAccountIds: [...new Set(recipients)],
          };
        },
      );

      logger.info(
        `[RecurringTask] Spawned child ${childId} for parent ${task.id}` +
          ` (${task.recurrenceType}, window ${nextKey}${!lastChild ? " — FIRST instance" : ""})`,
      );

      // ── 8. Notifications (outside transaction, best-effort) ─
      if (recipientAccountIds.length > 0) {
        try {
          await triggerTaskNotification({
            taskId: childId,
            event: "CREATED",
            performedByAccountId: task.createdBy ?? null,
            recipientAccountIds,
          });
        } catch (notifErr: any) {
          logger.warn(
            `[RecurringTask] Notification failed for child ${childId}: ${notifErr?.message}`,
          );
        }
      }

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
    `[RecurringTask] Done — processed: ${processed}, spawned: ${spawned}, skipped: ${skipped}, errors: ${errors}`,
  );

  return { processed, spawned, skipped, errors };
}

/* ═══════════════════════════════════════════════════════════════
   CRON REGISTRATION
═══════════════════════════════════════════════════════════════ */

/**
 * Registers the recurring-task scheduler as a cron job.
 *
 * Default schedule: every hour at :00  ("0 * * * *").
 * Override via RECURRING_TASK_CRON env variable.
 *
 * Running every hour is safe because the idempotency guard (startDate
 * uniqueness per parent) prevents double-spawning within the same day.
 * You can safely run this every minute in staging with no side-effects.
 */
export function registerRecurringTaskJob(): void {
  const schedule = process.env.RECURRING_TASK_CRON ?? "0 0 * * *";

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