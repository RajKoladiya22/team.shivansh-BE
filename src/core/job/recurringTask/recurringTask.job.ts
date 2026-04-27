// /* ─────────────────────────────────────────────────────────────
//    Cron registration
//    Schedule: every minute ("* * * * *")
//    For less frequent polling, change to e.g. "0 * * * *" (hourly)
//    or "0 0 * * *" (daily at midnight UTC).
// ───────────────────────────────────────────────────────────── */


// // src/core/job/recurringTask/recurringTask.job.ts
// //
// // Spawns new Task instances for every active recurring task whose
// // next-due window has arrived.
// //
// // Key design decisions
// // ────────────────────
// // • ONE instance per window per parent.  Idempotency is enforced by a
// //   unique child row keyed on (recurrenceParentId + startDate/dedupeKey).
// // • We do NOT gate spawning on whether the previous child is COMPLETED.
// //   Recurring means "create on schedule" — completion tracking is separate.
// // • "Window key" = ISO date string (YYYY-MM-DD) so UTC midnight is the
// //   shared boundary regardless of server timezone.
// // • The JSON-path query for the dedupe key is replaced by a direct column
// //   lookup (startDate), which is indexed and unambiguous.

// import cron from "node-cron";
// import { prisma } from "../../../config/database.config";
// import { TaskStatus, TaskRecurrenceType } from "@prisma/client";
// import { logger } from "../../help/logs/logger";
// import { triggerTaskNotification } from "../../../services/notifications";

// /* ═══════════════════════════════════════════════════════════════
//    DATE HELPERS
// ═══════════════════════════════════════════════════════════════ */

// /**
//  * Truncates a Date to midnight UTC, returning a new Date.
//  * e.g. 2025-06-15T14:33:00Z  →  2025-06-15T00:00:00.000Z
//  */
// function toMidnightUTC(d: Date): Date {
//   return new Date(
//     Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
//   );
// }

// /**
//  * Returns today's window key (YYYY-MM-DD in UTC).
//  */
// function todayWindowKey(now: Date = new Date()): string {
//   return toMidnightUTC(now).toISOString().slice(0, 10);
// }

// /**
//  * Given a reference Date and a recurrence type, returns the Date of
//  * the **next** window start (at midnight UTC).
//  *
//  * `referenceDate` should already be a window-start (midnight UTC).
//  */
// function nextWindowAfter(
//   referenceDate: Date,
//   recurrenceType: TaskRecurrenceType,
//   customRule?: Record<string, any> | null,
// ): Date {
//   // Work in UTC-day arithmetic to avoid DST issues.
//   const ref = toMidnightUTC(referenceDate);

//   switch (recurrenceType) {
//     case TaskRecurrenceType.DAILY:
//       return new Date(ref.getTime() + 1 * 24 * 60 * 60 * 1000);

//     case TaskRecurrenceType.WEEKLY:
//       return new Date(ref.getTime() + 7 * 24 * 60 * 60 * 1000);

//     case TaskRecurrenceType.BIWEEKLY:
//       return new Date(ref.getTime() + 14 * 24 * 60 * 60 * 1000);

//     case TaskRecurrenceType.MONTHLY: {
//       const d = new Date(ref);
//       d.setUTCMonth(d.getUTCMonth() + 1);
//       return toMidnightUTC(d);
//     }

//     case TaskRecurrenceType.QUARTERLY: {
//       const d = new Date(ref);
//       d.setUTCMonth(d.getUTCMonth() + 3);
//       return toMidnightUTC(d);
//     }

//     case TaskRecurrenceType.CUSTOM: {
//       const intervalDays =
//         typeof customRule?.intervalDays === "number" && customRule.intervalDays > 0
//           ? customRule.intervalDays
//           : 1;
//       return new Date(ref.getTime() + intervalDays * 24 * 60 * 60 * 1000);
//     }

//     default:
//       // ONE_TIME — should never reach here; push far into the future as a guard.
//       return new Date(ref.getTime() + 365 * 24 * 60 * 60 * 1000 * 100);
//   }
// }

// /**
//  * Returns the window key (YYYY-MM-DD UTC) for a given Date.
//  */
// function windowKey(d: Date): string {
//   return toMidnightUTC(d).toISOString().slice(0, 10);
// }

// /* ═══════════════════════════════════════════════════════════════
//    CORE SPAWN FUNCTION
// ═══════════════════════════════════════════════════════════════ */

// export async function spawnDueRecurringTasks(): Promise<{
//   processed: number;
//   spawned: number;
//   skipped: number;
//   errors: number;
// }> {
//   const now = new Date();
//   const todayKey = todayWindowKey(now);
//   const todayMidnight = toMidnightUTC(now);

//   let processed = 0;
//   let spawned = 0;
//   let skipped = 0;
//   let errors = 0;

//   // ── 1. Load all recurring root-task definitions ─────────────
//   //
//   //  Include:
//   //   • All statuses except CANCELLED — a PENDING/IN_PROGRESS/COMPLETED
//   //     definition should still spawn children on schedule.
//   //   • recurrenceParentId: null  →  root definitions only (not instances).
//   //   • recurrenceType != ONE_TIME → actually recurring.
//   //
//   const rootTasks = await prisma.task.findMany({
//     where: {
//       isRecurring: true,
//       recurrenceType: { not: TaskRecurrenceType.ONE_TIME },
//       recurrenceParentId: null,
//       deletedAt: null,
//       status: { not: TaskStatus.CANCELLED },
//     },
//     select: {
//       id: true,
//       title: true,
//       description: true,
//       priority: true,
//       projectId: true,
//       stepId: true,
//       estimatedMinutes: true,
//       isSelfTask: true,
//       createdBy: true,
//       createdAt: true,
//       startDate: true,
//       dueDate: true,
//       recurrenceType: true,
//       recurrenceRule: true,
//       // Assignments on the definition (used for the very first spawn, and
//       // as a fallback if the last child has no assignments).
//       assignments: {
//         select: {
//           type: true,
//           accountId: true,
//           teamId: true,
//           note: true,
//         },
//       },
//       labels: {
//         select: { labelId: true },
//       },
//       checklist: {
//         orderBy: { order: "asc" },
//         select: {
//           title: true,
//           order: true,
//           assignedTo: true,
//           dueDate: true,
//         },
//       },
//       // Most-recently spawned child — used to determine the LAST window
//       // that was already generated, so we know what window comes NEXT.
//       recurrenceChildren: {
//         where: { deletedAt: null },
//         orderBy: { startDate: "desc" },
//         take: 1,
//         select: {
//           id: true,
//           startDate: true,
//           createdAt: true,
//           assignments: {
//             select: {
//               type: true,
//               accountId: true,
//               teamId: true,
//               note: true,
//             },
//           },
//           labels: {
//             select: { labelId: true },
//           },
//           checklist: {
//             orderBy: { order: "asc" },
//             select: {
//               title: true,
//               order: true,
//               assignedTo: true,
//               dueDate: true,
//             },
//           },
//         },
//       },
//     },
//   });

//   logger.info(
//     `[RecurringTask] ${rootTasks.length} active recurring definition(s) found for window ${todayKey}`,
//   );

//   for (const task of rootTasks) {
//     processed++;

//     try {
//       const customRule =
//         task.recurrenceType === TaskRecurrenceType.CUSTOM &&
//           task.recurrenceRule &&
//           typeof task.recurrenceRule === "object"
//           ? (task.recurrenceRule as Record<string, any>)
//           : null;

//       const lastChild = task.recurrenceChildren[0] ?? null;

//       // ── 2. Determine which window should be generated NEXT ──
//       //
//       // If no child exists yet → the first window is the task's own
//       // startDate (falling back to createdAt).  We do NOT add an interval
//       // here: the definition's startDate IS the first scheduled occurrence.
//       //
//       // If a child exists → advance one interval past the last child's
//       // startDate.  This means even if we missed several windows (e.g.
//       // server was down) we will only ever create ONE new child per cron
//       // tick — the next overdue window.  The next cron tick will catch up
//       // to the following window, and so on, until we are current.
//       let nextWindowStart: Date;

//       if (!lastChild) {
//         // First occurrence = definition's startDate (midnight UTC).
//         const firstOccurrence = task.startDate ?? task.createdAt;
//         nextWindowStart = toMidnightUTC(firstOccurrence);
//       } else {
//         // Next occurrence = interval after the last spawned child's window.
//         const lastWindowStart = lastChild.startDate
//           ? toMidnightUTC(lastChild.startDate)
//           : toMidnightUTC(lastChild.createdAt);

//         nextWindowStart = nextWindowAfter(
//           lastWindowStart,
//           task.recurrenceType,
//           customRule,
//         );
//       }

//       const nextKey = windowKey(nextWindowStart);

//       // ── 3. Is this window due yet? ──────────────────────────
//       //
//       // "Due" means nextWindowStart <= now (i.e. today >= nextWindowStart).
//       // We compare as UTC midnight dates to avoid sub-day jitter.
//       if (nextWindowStart > todayMidnight) {
//         logger.debug(
//           `[RecurringTask] ${task.id} next window ${nextKey} is in the future — skip`,
//         );
//         skipped++;
//         continue;
//       }

//       // ── 3b. Skip Sundays for DAILY tasks ───────────────────
//       if (task.recurrenceType === TaskRecurrenceType.DAILY) {
//         const dayOfWeek = nextWindowStart.getUTCDay(); // 0 = Sunday
//         if (dayOfWeek === 0) {
//            nextWindowStart = new Date(nextWindowStart.getTime() + 24 * 60 * 60 * 1000);
//           logger.debug(
//             `[RecurringTask] ${task.id} DAILY task — skipping Sunday window ${nextKey}`,
//           );
//           skipped++;
//           continue;
//         }
//       }

//       // ── 4. Idempotency — has this window already been spawned? ──
//       //
//       // We store startDate = nextWindowStart on every child, so a
//       // simple DB lookup is the dedupe guard.  This is far more reliable
//       // than a JSON-path filter on recurrenceRule.
//       const alreadySpawned = await prisma.task.findFirst({
//         where: {
//           recurrenceParentId: task.id,
//           startDate: nextWindowStart,
//           deletedAt: null,
//         },
//         select: { id: true },
//       });

//       if (alreadySpawned) {
//         logger.debug(
//           `[RecurringTask] Window ${nextKey} already spawned for ${task.id} (child: ${alreadySpawned.id}) — skip`,
//         );
//         skipped++;
//         continue;
//       }

//       // ── 5. Determine the source of assignments / labels / checklist ─
//       //
//       // Prefer the last child's data (it may have been re-assigned after
//       // creation).  Fall back to the root definition.
//       const assignmentSource =
//         lastChild?.assignments?.length
//           ? lastChild.assignments
//           : task.assignments;

//       const labelSource =
//         lastChild?.labels?.length ? lastChild.labels : task.labels;

//       const checklistSource =
//         lastChild?.checklist?.length ? lastChild.checklist : task.checklist;

//       // ── 6. Compute the dueDate for this child (optional) ────
//       //
//       // If the root task has a dueDate, we compute a relative dueDate for
//       // the child by advancing it by the same interval from nextWindowStart.
//       // This keeps the "days until due" constant across instances.
//       let childDueDate: Date | null = null;
//       if (task.dueDate) {
//         childDueDate = nextWindowAfter(
//           nextWindowStart,
//           task.recurrenceType,
//           customRule,
//         );
//         // Subtract 1 interval to keep relative offset: the due date should
//         // be relative to this window, not the next one.
//         // e.g. DAILY task with dueDate = startDate + 1 day → each child
//         // also has dueDate = its startDate + 1 day.
//         // We compute: dueDate offset from original = task.dueDate - (task.startDate ?? task.createdAt)
//         const originStart = toMidnightUTC(task.startDate ?? task.createdAt);
//         const originDue = toMidnightUTC(task.dueDate);
//         const offsetMs = originDue.getTime() - originStart.getTime();
//         childDueDate = new Date(nextWindowStart.getTime() + offsetMs);
//       }

//       // ── 7. Spawn inside a transaction ───────────────────────
//       const dedupeKey = `recurring:${task.id}:${nextKey}`;

//       const { childId, recipientAccountIds } = await prisma.$transaction(
//         async (tx) => {
//           // Create the child task
//           const child = await tx.task.create({
//             data: {
//               title: task.title,
//               description: task.description,
//               priority: task.priority,
//               projectId: task.projectId,
//               stepId: task.stepId,
//               estimatedMinutes: task.estimatedMinutes,
//               isSelfTask: task.isSelfTask,
//               createdBy: task.createdBy,

//               // Recurrence linkage
//               recurrenceParentId: task.id,
//               isRecurring: false,
//               recurrenceType: TaskRecurrenceType.ONE_TIME,

//               // Scheduling
//               startDate: nextWindowStart,
//               dueDate: childDueDate,

//               // Status
//               status: TaskStatus.PENDING,

//               // Dedupe metadata stored for human-readable audit trail.
//               // We do NOT rely on this for idempotency (we use startDate above).
//               recurrenceRule: { dedupeKey, windowKey: nextKey },
//             },
//           });

//           // Copy assignments
//           const recipients: string[] = [];
//           if (assignmentSource.length > 0) {
//             await tx.taskAssignment.createMany({
//               data: assignmentSource.map((a) => ({
//                 taskId: child.id,
//                 type: a.type,
//                 accountId: a.accountId ?? null,
//                 teamId: a.teamId ?? null,
//                 note: a.note ?? null,
//                 assignedBy: task.createdBy ?? null,
//                 status: TaskStatus.PENDING,
//               })),
//               skipDuplicates: true,
//             });

//             // Resolve direct account recipients for notification
//             for (const a of assignmentSource) {
//               if (a.accountId) {
//                 recipients.push(a.accountId);
//               } else if (a.teamId) {
//                 const members = await tx.teamMember.findMany({
//                   where: { teamId: a.teamId, isActive: true },
//                   select: { accountId: true },
//                 });
//                 members.forEach((m) => recipients.push(m.accountId));
//               }
//             }
//           }

//           // Copy labels
//           if (labelSource.length > 0) {
//             await tx.taskLabel.createMany({
//               data: labelSource.map((l) => ({
//                 taskId: child.id,
//                 labelId: l.labelId,
//                 addedBy: task.createdBy ?? null,
//               })),
//               skipDuplicates: true,
//             });
//           }

//           // Copy checklist (always reset to PENDING)
//           if (checklistSource.length > 0) {
//             await tx.checklistItem.createMany({
//               data: checklistSource.map((item, idx) => ({
//                 taskId: child.id,
//                 title: item.title,
//                 order: item.order ?? idx,
//                 status: "PENDING" as const,
//                 assignedTo: item.assignedTo ?? null,
//                 dueDate: item.dueDate ?? null,
//                 createdBy: task.createdBy ?? null,
//               })),
//             });
//           }

//           // Activity log
//           await tx.activityLog.create({
//             data: {
//               entityType: "TASK",
//               entityId: child.id,
//               action: "CREATED",
//               performedBy: null, // system-generated
//               projectId: task.projectId ?? null,
//               taskId: child.id,
//               toState: {
//                 title: child.title,
//                 priority: child.priority,
//                 startDate: child.startDate,
//                 dueDate: child.dueDate,
//                 spawnedFrom: task.id,
//                 dedupeKey,
//               },
//               meta: {
//                 source: "recurring_scheduler",
//                 parentTaskId: task.id,
//                 recurrenceType: task.recurrenceType,
//                 windowKey: nextKey,
//                 isFirstInstance: !lastChild,
//               },
//             },
//           });

//           return {
//             childId: child.id,
//             recipientAccountIds: [...new Set(recipients)],
//           };
//         },
//       );

//       logger.info(
//         `[RecurringTask] Spawned child ${childId} for parent ${task.id}` +
//         ` (${task.recurrenceType}, window ${nextKey}${!lastChild ? " — FIRST instance" : ""})`,
//       );

//       // ── 8. Notifications (outside transaction, best-effort) ─
//       if (recipientAccountIds.length > 0) {
//         try {
//           await triggerTaskNotification({
//             taskId: childId,
//             event: "CREATED",
//             performedByAccountId: task.createdBy ?? null,
//             recipientAccountIds,
//           });
//         } catch (notifErr: any) {
//           logger.warn(
//             `[RecurringTask] Notification failed for child ${childId}: ${notifErr?.message}`,
//           );
//         }
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
//     `[RecurringTask] Done — processed: ${processed}, spawned: ${spawned}, skipped: ${skipped}, errors: ${errors}`,
//   );

//   return { processed, spawned, skipped, errors };
// }

// /* ═══════════════════════════════════════════════════════════════
//    CRON REGISTRATION
// ═══════════════════════════════════════════════════════════════ */

// /**
//  * Registers the recurring-task scheduler as a cron job.
//  *
//  * Default schedule: every hour at :00  ("0 * * * *").
//  * Override via RECURRING_TASK_CRON env variable.
//  *
//  * Running every hour is safe because the idempotency guard (startDate
//  * uniqueness per parent) prevents double-spawning within the same day.
//  * You can safely run this every minute in staging with no side-effects.
//  */
// export function registerRecurringTaskJob(): void {
//   const schedule = process.env.RECURRING_TASK_CRON ?? "0 0 * * *";

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





// src/core/job/recurringTask/recurringTask.job.ts
//
// Production-ready recurring task scheduler.
//
// Design principles
// ─────────────────
// 1. IDEMPOTENT  — uses (recurrenceParentId + startDate) uniqueness as the
//                  dedupe guard.  Safe to run the cron as often as every minute.
// 2. SCHEDULE-AWARE — respects recurrenceRule.daysOfWeek for DAILY/WEEKLY/CUSTOM.
//                     DAILY tasks skip Sunday by default unless Sunday is
//                     explicitly listed in daysOfWeek.
// 3. CATCH-UP BOUNDED — if the server was down, we catch up at most
//                       MAX_CATCHUP_DAYS windows to avoid flooding users.
// 4. CLEAN TRANSACTIONS — only writes happen inside the DB transaction;
//                         reads (team members, etc.) happen before it.
// 5. NOTIFICATION BEST-EFFORT — outside the transaction so a notification
//                               failure never rolls back a successful spawn.

import cron from "node-cron";
import { prisma } from "../../../config/database.config";
import { TaskStatus, TaskRecurrenceType } from "@prisma/client";
import { logger } from "../../help/logs/logger";
import { triggerTaskNotification } from "../../../services/notifications";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */

/** Maximum number of missed windows we will back-fill per task per run.
 *  Prevents flooding when the server was down for a long time.
 *  Set to 1 if you only ever want exactly one instance per cron tick. */
const MAX_CATCHUP_DAYS = 7;

/** Day index for Sunday in UTC (Date.getUTCDay()). */
const SUNDAY = 0;

/* ═══════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════ */

interface RecurrenceRule {
  /** Explicit days of the week (0=Sun … 6=Sat) that this task should run on.
   *  Used by DAILY, WEEKLY, and CUSTOM types. */
  daysOfWeek?: number[];
  /** Day of month (1–31) for MONTHLY / QUARTERLY. */
  dayOfMonth?: number;
  /** Number of days between instances for CUSTOM. */
  intervalDays?: number;
  /** Alias kept for backward compatibility with older records. */
  interval?: number;
  /** Advisory end date (ISO string). Not currently enforced by the scheduler. */
  endDate?: string;
  /** Advisory max occurrence count. Not currently enforced. */
  occurrences?: number;
  /** Human-readable dedupe string stored on each child for auditing only. */
  dedupeKey?: string;
  windowKey?: string;
}

/* ═══════════════════════════════════════════════════════════════
   UTC DATE HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * Truncates any Date to midnight UTC.
 * e.g. 2025-06-15T14:33:00Z  →  2025-06-15T00:00:00.000Z
 */
function toMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Returns the ISO date string (YYYY-MM-DD) for the UTC midnight of a date.
 */
function toWindowKey(d: Date): string {
  return toMidnightUTC(d).toISOString().slice(0, 10);
}

/**
 * Adds N days to a midnight-UTC date, returning a new midnight-UTC date.
 * Uses millisecond arithmetic to be completely immune to DST.
 */
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/* ═══════════════════════════════════════════════════════════════
   SCHEDULE-AWARE DATE RESOLUTION
═══════════════════════════════════════════════════════════════ */

/**
 * Given the last spawned window's start date, returns the Date of the NEXT
 * window that should be created, fully honouring the recurrence type and rule.
 *
 * For DAILY: advances day-by-day until we land on an allowed weekday.
 *   • Sunday (0) is always skipped unless explicitly listed in daysOfWeek.
 *   • If daysOfWeek is provided, only those days are valid targets.
 *
 * For WEEKLY: advances 7 days, then if daysOfWeek is set, finds the next
 *   matching weekday on or after that date.
 *
 * For MONTHLY / QUARTERLY: advances the month/quarter, then applies dayOfMonth
 *   if specified (clamped to the last day of that month).
 *
 * For CUSTOM: advances by intervalDays, then applies daysOfWeek if set.
 *
 * Returns null if the rule is ONE_TIME (should never be called).
 */
function computeNextWindowStart(
  lastWindowStart: Date,
  recurrenceType: TaskRecurrenceType,
  rule: RecurrenceRule,
): Date | null {
  const ref = toMidnightUTC(lastWindowStart);

  switch (recurrenceType) {
    // ── DAILY ──────────────────────────────────────────────────
    case TaskRecurrenceType.DAILY: {
      // Advance one day at a time until we hit an allowed weekday.
      // Allowed = daysOfWeek from rule, or [1,2,3,4,5,6] (Mon–Sat) by default.
      const allowed = getAllowedDays(rule.daysOfWeek, { skipSundayByDefault: true });
      let candidate = addDays(ref, 1);
      // Safety: scan at most 14 days forward to avoid infinite loops on
      // degenerate rules (e.g. daysOfWeek: [] which allows nothing).
      for (let i = 0; i < 14; i++) {
        if (allowed.has(candidate.getUTCDay())) return candidate;
        candidate = addDays(candidate, 1);
      }
      // Fallback: just advance one day (misconfigured rule).
      return addDays(ref, 1);
    }

    // ── WEEKLY ─────────────────────────────────────────────────
    case TaskRecurrenceType.WEEKLY: {
      const base = addDays(ref, 7);
      if (!rule.daysOfWeek?.length) return base;
      // Find the next occurrence of any of the listed weekdays on or after base.
      return findNextWeekdayOnOrAfter(base, rule.daysOfWeek);
    }

    // ── BIWEEKLY ───────────────────────────────────────────────
    case TaskRecurrenceType.BIWEEKLY: {
      return addDays(ref, 14);
    }

    // ── MONTHLY ────────────────────────────────────────────────
    case TaskRecurrenceType.MONTHLY: {
      const next = new Date(ref);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return applyDayOfMonth(toMidnightUTC(next), rule.dayOfMonth);
    }

    // ── QUARTERLY ──────────────────────────────────────────────
    case TaskRecurrenceType.QUARTERLY: {
      const next = new Date(ref);
      next.setUTCMonth(next.getUTCMonth() + 3);
      return applyDayOfMonth(toMidnightUTC(next), rule.dayOfMonth);
    }

    // ── CUSTOM ─────────────────────────────────────────────────
    case TaskRecurrenceType.CUSTOM: {
      const intervalDays = resolveIntervalDays(rule);
      const base = addDays(ref, intervalDays);
      if (!rule.daysOfWeek?.length) return base;
      return findNextWeekdayOnOrAfter(base, rule.daysOfWeek);
    }

    default:
      return null;
  }
}

/**
 * Resolves the effective interval in days for a CUSTOM recurrence rule.
 * Falls back gracefully through: intervalDays → interval → 1.
 */
function resolveIntervalDays(rule: RecurrenceRule): number {
  const n = rule.intervalDays ?? rule.interval ?? 1;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
}

/**
 * Returns a Set of allowed weekday indices.
 *
 * If explicit daysOfWeek are provided, use them as-is.
 * Otherwise return Mon–Sat (1–6) when skipSundayByDefault=true,
 * or Mon–Sun (0–6) when false.
 */
function getAllowedDays(
  daysOfWeek: number[] | undefined,
  options: { skipSundayByDefault: boolean },
): Set<number> {
  if (daysOfWeek && daysOfWeek.length > 0) {
    return new Set(daysOfWeek);
  }
  if (options.skipSundayByDefault) {
    // Monday(1) … Saturday(6)
    return new Set([1, 2, 3, 4, 5, 6]);
  }
  return new Set([0, 1, 2, 3, 4, 5, 6]);
}

/**
 * Given a base date, returns the earliest date that falls on one of the
 * listed weekdays, starting from base (inclusive).
 * Scans at most 7 days forward.
 */
function findNextWeekdayOnOrAfter(base: Date, daysOfWeek: number[]): Date {
  const allowed = new Set(daysOfWeek);
  let candidate = toMidnightUTC(base);
  for (let i = 0; i < 7; i++) {
    if (allowed.has(candidate.getUTCDay())) return candidate;
    candidate = addDays(candidate, 1);
  }
  // Fallback (should never happen with a valid daysOfWeek): return base.
  return toMidnightUTC(base);
}

/**
 * Applies a specific day-of-month to a date that is already set to the
 * correct month. Clamps to the last valid day of that month.
 *
 * e.g. dayOfMonth=31 on Feb 2025 → Feb 28, 2025.
 */
function applyDayOfMonth(date: Date, dayOfMonth: number | undefined): Date {
  if (!dayOfMonth) return date;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  // Last valid day of this month:
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(dayOfMonth, lastDay);
  return new Date(Date.UTC(year, month, clampedDay));
}

/**
 * Computes the child's dueDate by preserving the same offset between
 * startDate and dueDate that the original definition had.
 *
 * e.g. if the definition had startDate=Jan 1 and dueDate=Jan 3 (offset +2 days),
 * a child with startDate=Feb 1 will get dueDate=Feb 3.
 *
 * Returns null if the definition has no dueDate.
 */
function computeChildDueDate(
  task: { startDate: Date | null; createdAt: Date; dueDate: Date | null },
  childStartDate: Date,
): Date | null {
  if (!task.dueDate) return null;
  const originStart = toMidnightUTC(task.startDate ?? task.createdAt);
  const originDue = toMidnightUTC(task.dueDate);
  const offsetMs = originDue.getTime() - originStart.getTime();
  if (offsetMs < 0) return null; // dueDate before startDate — malformed definition
  return new Date(childStartDate.getTime() + offsetMs);
}

/* ═══════════════════════════════════════════════════════════════
   CORE SPAWN FUNCTION
═══════════════════════════════════════════════════════════════ */

export interface SpawnResult {
  processed: number;
  spawned: number;
  skipped: number;
  errors: number;
}

export async function spawnDueRecurringTasks(): Promise<SpawnResult> {
  const now = new Date();
  const todayMidnight = toMidnightUTC(now);
  const todayKey = toWindowKey(now);
  // The earliest window we will back-fill (inclusive).
  const catchupFloor = addDays(todayMidnight, -MAX_CATCHUP_DAYS);

  let processed = 0;
  let spawned = 0;
  let skipped = 0;
  let errors = 0;

  /* ── 1. Load all active recurring root-task definitions ─────── */
  const rootTasks = await prisma.task.findMany({
    where: {
      isRecurring: true,
      recurrenceType: { not: TaskRecurrenceType.ONE_TIME },
      recurrenceParentId: null,   // definition rows only
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

      assignments: {
        select: { type: true, accountId: true, teamId: true, note: true },
      },
      labels: {
        select: { labelId: true },
      },
      checklist: {
        orderBy: { order: "asc" },
        select: { title: true, order: true, assignedTo: true, dueDate: true },
      },

      // Only the most-recently spawned child — tells us the last window date.
      recurrenceChildren: {
        where: { deletedAt: null },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          startDate: true,
          createdAt: true,
          assignments: {
            select: { type: true, accountId: true, teamId: true, note: true },
          },
          labels: { select: { labelId: true } },
          checklist: {
            orderBy: { order: "asc" },
            select: { title: true, order: true, assignedTo: true, dueDate: true },
          },
        },
      },
    },
  });

  logger.info(
    `[RecurringTask] Run started — ${rootTasks.length} definition(s), window ${todayKey}`,
  );

  /* ── 2. Process each definition ─────────────────────────────── */
  for (const task of rootTasks) {
    processed++;

    try {
      const rule = (
        task.recurrenceRule && typeof task.recurrenceRule === "object"
          ? task.recurrenceRule
          : {}
      ) as RecurrenceRule;

      const lastChild = task.recurrenceChildren[0] ?? null;

      /* ── 2a. Determine the next window start date ───────────── */
      let nextWindowStart: Date;

      if (!lastChild) {
        // First instance: the definition's own startDate is the first window.
        nextWindowStart = toMidnightUTC(task.startDate ?? task.createdAt);
      } else {
        const lastStart = lastChild.startDate
          ? toMidnightUTC(lastChild.startDate)
          : toMidnightUTC(lastChild.createdAt);

        const next = computeNextWindowStart(lastStart, task.recurrenceType, rule);
        if (!next) {
          logger.warn(
            `[RecurringTask] ${task.id} is ONE_TIME — should not be in recurring set`,
          );
          skipped++;
          continue;
        }
        nextWindowStart = next;
      }

      const nextKey = toWindowKey(nextWindowStart);

      /* ── 2b. Not due yet? ───────────────────────────────────── */
      if (nextWindowStart > todayMidnight) {
        logger.debug(`[RecurringTask] ${task.id} next=${nextKey} is future — skip`);
        skipped++;
        continue;
      }

      /* ── 2c. Too far in the past (catch-up limit)? ─────────── */
      if (nextWindowStart < catchupFloor) {
        logger.warn(
          `[RecurringTask] ${task.id} next=${nextKey} exceeds catch-up floor ` +
          `(${toWindowKey(catchupFloor)}) — skipping stale window`,
        );
        skipped++;
        continue;
      }

      /* ── 2d. Idempotency: already spawned for this window? ──── */
      const alreadyExists = await prisma.task.findFirst({
        where: {
          recurrenceParentId: task.id,
          startDate: nextWindowStart,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (alreadyExists) {
        logger.debug(
          `[RecurringTask] ${task.id} window ${nextKey} already spawned ` +
          `(child: ${alreadyExists.id}) — skip`,
        );
        skipped++;
        continue;
      }

      /* ── 2e. Resolve assignments, labels, checklist ─────────── */
      // Prefer the last child's data (may have been re-assigned after creation).
      const assignmentSource =
        lastChild?.assignments?.length ? lastChild.assignments : task.assignments;
      const labelSource =
        lastChild?.labels?.length ? lastChild.labels : task.labels;
      const checklistSource =
        lastChild?.checklist?.length ? lastChild.checklist : task.checklist;

      /* ── 2f. Resolve team members for notifications (before tx) */
      const recipientAccountIds = await resolveRecipients(
        assignmentSource,
        task.createdBy,
      );

      /* ── 2g. Compute child dueDate ──────────────────────────── */
      const childDueDate = computeChildDueDate(
        {
          startDate: task.startDate,
          createdAt: task.createdAt,
          dueDate: task.dueDate,
        },
        nextWindowStart,
      );

      /* ── 2h. Build dedupe metadata (audit only, not used for idempotency) */
      const dedupeKey = `recurring:${task.id}:${nextKey}`;

      /* ── 2i. Spawn inside a transaction ─────────────────────── */
      const childId = await prisma.$transaction(async (tx) => {
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

            // Fresh status
            status: TaskStatus.PENDING,

            // Audit metadata (NOT the idempotency key)
            recurrenceRule: { dedupeKey, windowKey: nextKey } as any,
          },
        });

        // Copy assignments
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

        // Copy checklist — always reset items to PENDING
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
            performedBy: null,   // system-generated
            projectId: task.projectId ?? null,
            taskId: child.id,
            toState: {
              title: child.title,
              priority: child.priority,
              startDate: child.startDate,
              dueDate: child.dueDate,
              spawnedFrom: task.id,
            },
            meta: {
              source: "recurring_scheduler",
              parentTaskId: task.id,
              recurrenceType: task.recurrenceType,
              windowKey: nextKey,
              dedupeKey,
              isFirstInstance: !lastChild,
            },
          },
        });

        return child.id;
      });

      logger.info(
        `[RecurringTask] ✅ Spawned child ${childId} for parent ${task.id}` +
        ` type=${task.recurrenceType} window=${nextKey}` +
        `${!lastChild ? " (FIRST instance)" : ""}`,
      );

      /* ── 2j. Notifications — best-effort, outside transaction ─ */
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
        `[RecurringTask] ❌ Error processing task ${task.id}: ${err?.message}`,
        { stack: err?.stack },
      );
    }
  }

  logger.info(
    `[RecurringTask] Run complete — ` +
    `processed=${processed} spawned=${spawned} skipped=${skipped} errors=${errors}`,
  );

  return { processed, spawned, skipped, errors };
}

/* ═══════════════════════════════════════════════════════════════
   RECIPIENT RESOLUTION (outside transaction)
═══════════════════════════════════════════════════════════════ */

/**
 * Resolves a flat, de-duplicated list of accountIds to notify.
 * Direct assignments → use accountId directly.
 * Team assignments → expand to active team members.
 * createdBy → always included so the task creator is aware.
 */
async function resolveRecipients(
  assignments: Array<{ type: string; accountId: string | null; teamId: string | null }>,
  createdBy: string | null,
): Promise<string[]> {
  const ids = new Set<string>();

  if (createdBy) ids.add(createdBy);

  for (const a of assignments) {
    if (a.accountId) {
      ids.add(a.accountId);
    } else if (a.teamId) {
      try {
        const members = await prisma.teamMember.findMany({
          where: { teamId: a.teamId, isActive: true },
          select: { accountId: true },
        });
        members.forEach((m) => ids.add(m.accountId));
      } catch (err: any) {
        logger.warn(
          `[RecurringTask] Failed to resolve team ${a.teamId} members: ${err?.message}`,
        );
      }
    }
  }

  return [...ids];
}

/* ═══════════════════════════════════════════════════════════════
   CRON REGISTRATION
═══════════════════════════════════════════════════════════════ */

/**
 * Registers the recurring-task scheduler as a cron job.
 *
 * Default schedule: daily at midnight UTC  ("0 0 * * *").
 * Override via RECURRING_TASK_CRON env var.
 *
 * The idempotency guard (startDate uniqueness) makes it safe to run
 * this every minute in development with no side-effects.
 *
 * Recommended schedules:
 *   "0 0 * * *"   — daily at midnight (production default)
 *   "0 * * * *"   — hourly (if you need same-day spawning)
 *   "* * * * *"   — every minute (dev/testing only)
 */
export function registerRecurringTaskJob(): void {
  const schedule = process.env.RECURRING_TASK_CRON ?? "0 0 * * *";

  cron.schedule(
    schedule,
    async () => {
      try {
        logger.info("[RecurringTask] Cron tick — starting spawn run");
        await spawnDueRecurringTasks();
      } catch (err: any) {
        logger.error("[RecurringTask] Unhandled scheduler error:", err);
      }
    },
    { timezone: "UTC" },
  );

  logger.info(`[RecurringTask] Scheduler registered (cron: "${schedule}")`);
}