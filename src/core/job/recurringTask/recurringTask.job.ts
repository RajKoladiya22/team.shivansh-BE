// src/core/job/recurringTask/recurringTask.job.ts
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
function computeChildDueDateV1(
  task: { startDate: Date | null; createdAt: Date; dueDate: Date | null },
  childStartDate: Date,
): Date | null {
  if (!task.dueDate){
    return addDays(childStartDate, 1);
  };
  const originStart = toMidnightUTC(task.startDate ?? task.createdAt);
  const originDue = toMidnightUTC(task.dueDate);
  const offsetMs = originDue.getTime() - originStart.getTime();
  if (offsetMs < 0) return addDays(childStartDate, 1); // dueDate before startDate — malformed definition
  return new Date(childStartDate.getTime() + offsetMs);
}

function computeChildStartDate(spawnedAt: Date): Date {
  // Start at 10:00 AM UTC of the spawn day
  const midnight = toMidnightUTC(spawnedAt);
  return new Date(midnight.getTime() + 10 * 60 * 60 * 1000); // +10 hours
}

function computeChildDueDate(childStartDate: Date): Date {
  // Due at end of the same day (23:59:59.999 UTC)
  const midnight = toMidnightUTC(childStartDate);
  return new Date(midnight.getTime() + 86_400_000 - 1);
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

  /* ── 0. Load active approved leaves for skip logic ──────────── */
  const activeLeaves = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      OR: [
        { endDate: null },
        { endDate: { gte: catchupFloor } },
      ],
    },
    select: {
      accountId: true,
      startDate: true,
      endDate: true,
    },
  });

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
      isLearning: true,

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
        // nextWindowStart = toMidnightUTC(task.startDate ?? task.createdAt);
        nextWindowStart = todayMidnight;
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
      let assignmentSource =
        lastChild?.assignments?.length ? lastChild.assignments : task.assignments;

      const originalAssignmentCount = assignmentSource.length;

      // Filter out assignees who are on an approved leave on nextWindowStart
      assignmentSource = assignmentSource.filter((assignment) => {
        if (!assignment.accountId) return true; // Team assignment or unassigned
        
        const isOnLeave = activeLeaves.some((leave) => {
          if (leave.accountId !== assignment.accountId) return false;
          const leaveStart = toMidnightUTC(leave.startDate);
          const leaveEnd = leave.endDate ? toMidnightUTC(leave.endDate) : null;
          return nextWindowStart >= leaveStart && (!leaveEnd || nextWindowStart <= leaveEnd);
        });
        
        return !isOnLeave;
      });

      const isCancelledDueToLeave = originalAssignmentCount > 0 && assignmentSource.length === 0;
      const labelSource =
        lastChild?.labels?.length ? lastChild.labels : task.labels;
      const checklistSource =
        lastChild?.checklist?.length ? lastChild.checklist : task.checklist;

      /* ── 2f. Resolve team members for notifications (before tx) */
      const recipientAccountIds = await resolveRecipients(
        assignmentSource,
        // task.createdBy,
      );

      /* ── 2g. Compute child dueDate ──────────────────────────── */
      // const childDueDate = computeChildDueDate(
      //   {
      //     startDate: task.startDate,
      //     createdAt: task.createdAt,
      //     dueDate: task.dueDate,
      //   },
      //   nextWindowStart,
      // );
      const childStartDate = computeChildStartDate(now);
      const childDueDate = computeChildDueDate(childStartDate);

      /* ── 2h. Build dedupe metadata (audit only, not used for idempotency) */
      const dedupeKey = `recurring:${task.id}:${nextKey}`;

      /* ── 2i. Spawn inside a transaction ─────────────────────── */
      const childId = await prisma.$transaction(async (tx) => {
        // Create the child task
        const child = await tx.task.create({
          data: {
            title: isCancelledDueToLeave ? `[SKIPPED - LEAVE] ${task.title}` : task.title,
            description: task.description,
            priority: task.priority,
            projectId: task.projectId,
            stepId: task.stepId,
            estimatedMinutes: task.estimatedMinutes,
            isSelfTask: task.isSelfTask,
            createdBy: task.createdBy,

            isLearning: task.isLearning === true,

            // Recurrence linkage
            recurrenceParentId: task.id,
            isRecurring: false,
            recurrenceType: TaskRecurrenceType.ONE_TIME,

            // Scheduling
            startDate: childStartDate,
            dueDate: childDueDate,

            // Fresh status
            status: isCancelledDueToLeave ? TaskStatus.CANCELLED : TaskStatus.PENDING,

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
  createdBy?: string | null,
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












/**
 * CLOUD SERVICE API - COMPLETE INTEGRATION GUIDE
 *
 * This document provides all the information needed to integrate the CloudService
 * CRUD endpoints into your Shivansh Infosys CRM system.
 */

// ============================================================================
// 1. REGISTRATION & SETUP
// ============================================================================

/**
 * In your main app.ts / server.ts file:
 *
 * import cloudServiceRoutes from './routes/cloud-service.routes';
 *
 * // Mount routes
 * app.use('/api/v1/cloud-services', cloudServiceRoutes);
 *
 * The controller requires:
 *   - Express Request/Response
 *   - Prisma client configured
 *   - Error/success response utilities (sendErrorResponse, sendSuccessResponse)
 *   - Authentication middleware (req.user.id, req.user.accountId)
 */

// ============================================================================
// 2. API ENDPOINTS REFERENCE
// ============================================================================

/**
 * GET /api/v1/cloud-services
 * List all cloud services with filters and pagination
 *
 * Query Parameters:
 *   page:             number (default: 1)
 *   limit:            number (default: 20, max: 100)
 *   customerId:       string (filter by customer)
 *   type:             'MIRACLE' | 'COMHARD'
 *   renewalType:      'QUARTERLY' | 'SIX_MONTHS' | 'YEARLY'
 *   isActive:         'true' | 'false'
 *   isOnTrial:        'true' | 'false'
 *   isDriveSetup:     'true' | 'false'
 *   status:           'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' (renewal status)
 *   search:           string (customer name or mobile)
 *
 * Example Requests:
 *   GET /api/v1/cloud-services?page=1&limit=20
 *   GET /api/v1/cloud-services?type=MIRACLE&status=EXPIRING_SOON
 *   GET /api/v1/cloud-services?customerId=abc123&isActive=true
 *   GET /api/v1/cloud-services?search=Amit Kumar
 *   GET /api/v1/cloud-services?renewalType=YEARLY&isOnTrial=false
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "Cloud services fetched",
 *   data: {
 *     page: 1,
 *     limit: 20,
 *     total: 45,
 *     pages: 3,
 *     items: [
 *       {
 *         id: "uuid",
 *         customerId: "uuid",
 *         type: "MIRACLE",
 *         cost: 15000,
 *         renewalType: "YEARLY",
 *         purchaseDate: "2025-05-19T10:00:00Z",
 *         isDriveSetup: true,
 *         isActive: true,
 *         customer: {
 *           id: "uuid",
 *           name: "Amit Kumar",
 *           mobile: "+91-9876543210",
 *           customerCompanyName: "ABC Pvt Ltd"
 *         },
 *         lead: {
 *           id: "uuid",
 *           status: "CONVERTED"
 *         },
 *         _count: {
 *           users: 5
 *         },
 *         createdAt: "2025-05-19T10:00:00Z",
 *         updatedAt: "2025-05-19T10:00:00Z"
 *       }
 *     ]
 *   }
 * }
 */

/**
 * GET /api/v1/cloud-services/:id
 * Get single cloud service with all users
 *
 * URL Parameters:
 *   id: string (cloud service ID)
 *
 * Example Request:
 *   GET /api/v1/cloud-services/abc123
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "Cloud service details fetched",
 *   data: {
 *     id: "uuid",
 *     customerId: "uuid",
 *     leadId: "uuid" | null,
 *     type: "MIRACLE",
 *     cost: 15000,
 *     renewalType: "YEARLY",
 *     purchaseDate: "2025-05-19T10:00:00Z",
 *     isDriveSetup: true,
 *     isActive: true,
 *     ipAddress: "192.168.1.100",
 *     adminPassword: "encrypted...",
 *     userCount: 5,
 *     comhardSubId: null,
 *     numberOfTally: null,
 *     isOnTrial: false,
 *     trialStartDate: null,
 *     trialEndDate: null,
 *     trialDoneAt: null,
 *     customer: { ... },
 *     lead: { ... },
 *     users: [
 *       {
 *         id: "uuid",
 *         username: "amit",
 *         password: "encrypted...",
 *         note: "Admin user",
 *         isAdmin: true,
 *         tallyNumber: null,
 *         isActive: true,
 *         createdAt: "2025-05-19T10:00:00Z"
 *       }
 *     ],
 *     renewalInfo: {
 *       renewalDate: "2026-05-19T10:00:00Z",
 *       daysRemaining: 365,
 *       status: "ACTIVE",
 *       formattedDate: "19 May 2026"
 *     }
 *   }
 * }
 */

/**
 * POST /api/v1/cloud-services
 * Create new cloud service
 *
 * Body:
 * {
 *   customerId:      string (required)
 *   leadId:          string (optional)
 *   type:            'MIRACLE' | 'COMHARD' (required)
 *   cost:            number (optional)
 *   renewalType:     'QUARTERLY' | 'SIX_MONTHS' | 'YEARLY' (required)
 *   purchaseDate:    ISO string (optional, defaults to null)
 *   isDriveSetup:    boolean (optional, defaults to false)
 *
 *   // MIRACLE-specific fields:
 *   ipAddress:       string (optional)
 *   adminPassword:   string (required for MIRACLE)
 *   userCount:       number (optional)
 *
 *   // COMHARD-specific fields:
 *   comhardSubId:    string (required for COMHARD)
 *   numberOfTally:   1 | 2 (optional, defaults to 1)
 *   isOnTrial:       boolean (optional)
 *   trialStartDate:  ISO string (if isOnTrial=true)
 *   trialEndDate:    ISO string (if isOnTrial=true)
 *
 *   // Users array (optional):
 *   users: [
 *     {
 *       username:      string (required for MIRACLE, optional for COMHARD)
 *       password:      string (required)
 *       note:          string (optional)
 *       isAdmin:       boolean (optional, defaults to false)
 *       tallyNumber:   1 | 2 (optional, for COMHARD only)
 *     }
 *   ]
 * }
 *
 * Example Request (MIRACLE):
 * POST /api/v1/cloud-services
 * {
 *   customerId: "cust-123",
 *   type: "MIRACLE",
 *   cost: 15000,
 *   renewalType: "YEARLY",
 *   purchaseDate: "2025-05-19T10:00:00Z",
 *   isDriveSetup: true,
 *   ipAddress: "192.168.1.100",
 *   adminPassword: "mySecurePassword123",
 *   userCount: 3,
 *   users: [
 *     {
 *       username: "amit",
 *       password: "user123",
 *       note: "Admin user",
 *       isAdmin: true
 *     },
 *     {
 *       username: "priya",
 *       password: "user456",
 *       note: "Accountant",
 *       isAdmin: false
 *     }
 *   ]
 * }
 *
 * Example Request (COMHARD with Trial):
 * POST /api/v1/cloud-services
 * {
 *   customerId: "cust-456",
 *   type: "COMHARD",
 *   cost: 0,
 *   renewalType: "QUARTERLY",
 *   isDriveSetup: false,
 *   comhardSubId: "COM-123-XYZ",
 *   numberOfTally: 1,
 *   isOnTrial: true,
 *   trialStartDate: "2026-05-23T00:00:00Z",
 *   trialEndDate: "2026-05-30T00:00:00Z",
 *   users: [
 *     {
 *       username: "trial-admin",
 *       password: "trialPass123",
 *       isAdmin: true,
 *       tallyNumber: 1
 *     }
 *   ]
 * }
 *
 * Response (201 Created):
 * {
 *   success: true,
 *   message: "Cloud service created",
 *   data: { ...service object }
 * }
 */

/**
 * PATCH /api/v1/cloud-services/:id
 * Update cloud service
 *
 * URL Parameters:
 *   id: string (cloud service ID)
 *
 * Body: Any of the fields from POST request (except customerId and type)
 *
 * Example Request:
 * PATCH /api/v1/cloud-services/abc123
 * {
 *   cost: 18000,
 *   renewalType: "SIX_MONTHS",
 *   ipAddress: "192.168.1.101"
 * }
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "Cloud service updated",
 *   data: { ...updated service object }
 * }
 */

/**
 * DELETE /api/v1/cloud-services/:id
 * Soft delete cloud service (sets isActive: false)
 *
 * URL Parameters:
 *   id: string (cloud service ID)
 *
 * Example Request:
 * DELETE /api/v1/cloud-services/abc123
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "Cloud service deleted"
 * }
 */

// ============================================================================
// 3. CLOUD SERVICE USER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/v1/cloud-services/:id/users
 * Get all users for a cloud service
 *
 * URL Parameters:
 *   id: string (cloud service ID)
 *
 * Query Parameters:
 *   tallyNumber: 1 | 2 (optional, filter by tally for Comhard)
 *
 * Example Requests:
 *   GET /api/v1/cloud-services/abc123/users
 *   GET /api/v1/cloud-services/abc123/users?tallyNumber=1
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "Users fetched",
 *   data: [
 *     {
 *       id: "uuid",
 *       cloudServiceId: "uuid",
 *       username: "amit",
 *       password: "encrypted...",
 *       note: "Admin",
 *       isAdmin: true,
 *       tallyNumber: null,
 *       isActive: true,
 *       createdAt: "2025-05-19T10:00:00Z",
 *       updatedAt: "2025-05-19T10:00:00Z"
 *     }
 *   ]
 * }
 */

/**
 * POST /api/v1/cloud-services/:id/users
 * Add new user to cloud service
 *
 * URL Parameters:
 *   id: string (cloud service ID)
 *
 * Body:
 * {
 *   username:      string (required for MIRACLE, optional for COMHARD)
 *   password:      string (required)
 *   note:          string (optional)
 *   isAdmin:       boolean (optional, defaults to false)
 *   tallyNumber:   1 | 2 (optional, for COMHARD multi-tally)
 * }
 *
 * Example Request (MIRACLE):
 * POST /api/v1/cloud-services/abc123/users
 * {
 *   username: "rajesh",
 *   password: "securePass456",
 *   note: "New accountant",
 *   isAdmin: false
 * }
 *
 * Example Request (COMHARD - Tally 2):
 * POST /api/v1/cloud-services/abc123/users
 * {
 *   username: "branch-admin",
 *   password: "branchPass789",
 *   isAdmin: true,
 *   tallyNumber: 2
 * }
 *
 * Response (201 Created):
 * {
 *   success: true,
 *   message: "User added to cloud service",
 *   data: { ...user object }
 * }
 */

/**
 * PATCH /api/v1/cloud-services/:serviceId/users/:userId
 * Update cloud service user
 *
 * URL Parameters:
 *   serviceId: string (cloud service ID)
 *   userId:    string (user ID)
 *
 * Body: Any of the fields from POST request
 *
 * Example Request (Change password):
 * PATCH /api/v1/cloud-services/abc123/users/user-456
 * {
 *   password: "newPassword999"
 * }
 *
 * Example Request (Promote to admin):
 * PATCH /api/v1/cloud-services/abc123/users/user-456
 * {
 *   isAdmin: true
 * }
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "User updated",
 *   data: { ...updated user object }
 * }
 */

/**
 * DELETE /api/v1/cloud-services/:serviceId/users/:userId
 * Delete user from cloud service (soft delete)
 *
 * URL Parameters:
 *   serviceId: string (cloud service ID)
 *   userId:    string (user ID)
 *
 * Example Request:
 * DELETE /api/v1/cloud-services/abc123/users/user-456
 *
 * Response (200 OK):
 * {
 *   success: true,
 *   message: "User deleted"
 * }
 */

// ============================================================================
// 4. USAGE EXAMPLES
// ============================================================================

/**
 * Example 1: Create a new Miracle Cloud service
 */
const createMiracleExample = {
  request: {
    method: "POST",
    url: "http://localhost:3000/api/v1/cloud-services",
    headers: { "Content-Type": "application/json" },
    body: {
      customerId: "cust-abc-123",
      type: "MIRACLE",
      cost: 15000,
      renewalType: "YEARLY",
      purchaseDate: "2025-05-19T10:00:00Z",
      isDriveSetup: true,
      ipAddress: "192.168.1.100",
      adminPassword: "Admin@123456",
      userCount: 3,
      users: [
        {
          username: "owner",
          password: "Owner@123",
          note: "Owner/Admin",
          isAdmin: true,
        },
        {
          username: "accountant",
          password: "Acc@123",
          note: "Accountant",
          isAdmin: false,
        },
        {
          username: "manager",
          password: "Mgr@123",
          note: "Finance Manager",
          isAdmin: false,
        },
      ],
    },
  },
  response: 201,
};

/**
 * Example 2: List all Miracle services expiring in next 30 days
 */
const listExpiringExample = {
  request: {
    method: "GET",
    url: 'http://localhost:3000/api/v1/cloud-services?type=MIRACLE&status=EXPIRING_SOON&page=1&limit=50',
    headers: { "Content-Type": "application/json" },
  },
  response: 200,
};

/**
 * Example 3: Update Comhard trial to paid
 */
const convertTrialToPaidExample = {
  request: {
    method: "PATCH",
    url: "http://localhost:3000/api/v1/cloud-services/service-uuid",
    headers: { "Content-Type": "application/json" },
    body: {
      isOnTrial: false,
      trialDoneAt: "2026-05-30T00:00:00Z",
      cost: 10000,
      renewalType: "YEARLY",
      purchaseDate: "2026-05-23T00:00:00Z",
    },
  },
  response: 200,
};

/**
 * Example 4: Change user password
 */
const changePasswordExample = {
  request: {
    method: "PATCH",
    url: "http://localhost:3000/api/v1/cloud-services/service-uuid/users/user-uuid",
    headers: { "Content-Type": "application/json" },
    body: {
      password: "NewSecurePassword@789",
    },
  },
  response: 200,
};

// ============================================================================
// 5. ERROR RESPONSES
// ============================================================================

/**
 * Common Error Responses:
 *
 * 400 Bad Request:
 * {
 *   success: false,
 *   message: "customerId is required"
 * }
 *
 * 401 Unauthorized:
 * {
 *   success: false,
 *   message: "Unauthorized"
 * }
 *
 * 404 Not Found:
 * {
 *   success: false,
 *   message: "Cloud service not found"
 * }
 *
 * 500 Internal Server Error:
 * {
 *   success: false,
 *   message: "Failed to create cloud service"
 * }
 */

// ============================================================================
// 6. CRON JOBS & AUTOMATION
// ============================================================================

/**
 * Set up automatic renewal reminders (see cloud-service.cron.ts):
 *
 * Cron Job 1: Daily renewal reminder check at 9 AM
 * - Finds services expiring within next 30 days
 * - Finds services already expired
 * - Creates SUPPORT type Leads for each
 *
 * Cron Job 2: Daily trial expiration check at 10 AM
 * - Finds trials ending in 1-3 days
 * - Creates SUPPORT type Leads for follow-up
 *
 * Install node-cron:
 * npm install node-cron
 *
 * In your main app file:
 * import cron from 'node-cron';
 * import {
 *   generateCloudServiceRenewalReminders,
 *   generateTrialExpirationReminders
 * } from './cron/cloud-service.cron';
 *
 * // Run at 9 AM daily
 * cron.schedule('0 9 * * *', generateCloudServiceRenewalReminders);
 *
 * // Run at 10 AM daily
 * cron.schedule('0 10 * * *', generateTrialExpirationReminders);
 */

// ============================================================================
// 7. FRONTEND INTEGRATION EXAMPLES
// ============================================================================

/**
 * React Hook for fetching cloud services:
 *
 * const useCloudServices = (filters = {}) => {
 *   const [services, setServices] = useState([]);
 *   const [loading, setLoading] = useState(false);
 *   const [error, setError] = useState(null);
 *
 *   useEffect(() => {
 *     const fetchServices = async () => {
 *       try {
 *         setLoading(true);
 *         const params = new URLSearchParams(filters);
 *         const res = await fetch(`/api/v1/cloud-services?${params}`);
 *         const data = await res.json();
 *         setServices(data.data.items);
 *       } catch (err) {
 *         setError(err.message);
 *       } finally {
 *         setLoading(false);
 *       }
 *     };
 *     fetchServices();
 *   }, [filters]);
 *
 *   return { services, loading, error };
 * };
 *
 * // Usage:
 * const { services } = useCloudServices({ type: 'MIRACLE', isActive: 'true' });
 */

/**
 * Redux action example:
 *
 * export const fetchCloudServices = (filters) => async (dispatch) => {
 *   dispatch({ type: 'CLOUD_SERVICES_LOADING' });
 *   try {
 *     const res = await fetch(`/api/v1/cloud-services?${new URLSearchParams(filters)}`);
 *     const data = await res.json();
 *     dispatch({
 *       type: 'CLOUD_SERVICES_LOADED',
 *       payload: data.data
 *     });
 *   } catch (error) {
 *     dispatch({
 *       type: 'CLOUD_SERVICES_ERROR',
 *       payload: error.message
 *     });
 *   }
 * };
 */

// ============================================================================
// 8. NEXT STEPS
// ============================================================================

/**
 * 1. Copy cloud-service.controller.ts to your controllers folder
 * 2. Copy cloud-service.routes.ts to your routes folder
 * 3. Copy cloud-service.utils.ts to your utilities folder
 * 4. Copy cloud-service.cron.ts to your cron jobs folder
 * 5. Update Prisma schema with CloudService and CloudServiceUser models
 * 6. Run: npx prisma migrate dev
 * 7. Mount routes in your main app file
 * 8. Set up cron jobs
 * 9. Add authentication middleware
 * 10. Test all endpoints with Postman or your REST client
 * 11. Build React components for UI
 * 12. Create tables/lists for viewing services and users
 * 13. Add forms for creating/editing services and users
 */