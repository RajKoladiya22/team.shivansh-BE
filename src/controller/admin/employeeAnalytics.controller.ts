// src/controller/admin/employeeAnalytics.controller.ts
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

function parseDateParam(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

/** First day of the month N months ago from today */
function monthStart(offsetMonths: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
}

/** First day of the month after monthStart(offsetMonths) */
function monthEnd(offsetMonths: number): Date {
  return monthStart(offsetMonths + 1);
}

/**
 * GET /admin/analytics/employees/tasks
 *
 * Query params:
 *   accountId     – filter to a single employee
 *   fromDate      – ISO date (inclusive)
 *   toDate        – ISO date (inclusive)
 *   projectId     – filter to a specific project
 *   status        – filter to a specific task status
 *
 * Returns a rich analytics payload covering:
 *   1. Summary KPIs (totals, completion rate, overdue rate)
 *   2. Month-over-month growth
 *   3. Per-status breakdown
 *   4. Priority breakdown
 *   5. Average completion time (hours)
 *   6. Overdue analysis
 *   7. Per-employee leaderboard (top performers)
 *   8. Monthly trend (last 13 months)
 *   9. Self-tasks vs assigned tasks split
 *  10. Checklist completion rate
 *  11. Comment activity
 *  12. Time-logging stats
 *  13. Per-project breakdown
 *  14. Individual employee detail (when accountId supplied)
 */
export async function getEmployeeTaskAnalytics(req: Request, res: Response) {
  try {
    /* ── 1. Auth guard ── */
    if (!req.user?.roles?.includes?.("ADMIN")) {
      return sendErrorResponse(res, 403, "Admin access required");
    }

    /* ── 2. Parse query params ── */
    const rawFrom = req.query.fromDate as string | undefined;
    const rawTo = req.query.toDate as string | undefined;
    const accountId = req.query.accountId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    const fromDate = parseDateParam(rawFrom);
    const toDate = parseDateParam(rawTo);

    if (rawFrom && !fromDate)
      return sendErrorResponse(res, 400, "Invalid 'fromDate'");
    if (rawTo && !toDate)
      return sendErrorResponse(res, 400, "Invalid 'toDate'");
    if (fromDate && toDate && fromDate > toDate)
      return sendErrorResponse(res, 400, "'fromDate' must be before 'toDate'");

    /* ── 3. Build reusable Prisma where fragments ── */

    // Base task filter (excludes soft-deleted)
    const taskWhere: Prisma.TaskWhereInput = {
      deletedAt: null,
      ...(projectId ? { projectId } : {}),
      ...(statusFilter ? { status: statusFilter as any } : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      // Scope to a specific employee if requested
      ...(accountId
        ? {
            assignments: {
              some: { accountId },
            },
          }
        : {}),
    };

    // Raw SQL date fragment (reused in $queryRaw calls)
    const rawDateFilter: Prisma.Sql =
      fromDate || toDate
        ? Prisma.sql`AND t."createdAt" >= ${fromDate ?? new Date(0)}
                     AND t."createdAt" <= ${toDate ?? new Date()}`
        : Prisma.empty;

    const rawAccountFilter: Prisma.Sql = accountId
      ? Prisma.sql`AND ta."accountId" = ${accountId}`
      : Prisma.empty;

    const rawProjectFilter: Prisma.Sql = projectId
      ? Prisma.sql`AND t."projectId" = ${projectId}`
      : Prisma.empty;

    /* ── 4. Month-over-month windows (always current calendar context) ── */
    const thisMonthStart = monthStart(0);
    const lastMonthStart = monthStart(-1);
    const lastMonthEnd = monthEnd(-1);
    const now = new Date();

    /* ══════════════════════════════════════════════════════════
       SECTION A — Summary counts (single transaction)
    ══════════════════════════════════════════════════════════ */
    const summaryCounts = await prisma.$transaction(async (tx) => ({
      totalTasks: await tx.task.count({ where: taskWhere }),
      completedTasks: await tx.task.count({ where: { ...taskWhere, status: "COMPLETED" } }),
      inProgressTasks: await tx.task.count({ where: { ...taskWhere, status: "IN_PROGRESS" } }),
      pendingTasks: await tx.task.count({ where: { ...taskWhere, status: "PENDING" } }),
      cancelledTasks: await tx.task.count({ where: { ...taskWhere, status: "CANCELLED" } }),
      blockedTasks: await tx.task.count({ where: { ...taskWhere, status: "BLOCKED" } }),
      overdueTasks: await tx.task.count({
        where: {
          ...taskWhere,
          dueDate: { lt: now },
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      }),
      // new tasks created this calendar month
      newThisMonth: await tx.task.count({
        where: {
          ...taskWhere,
          createdAt: { gte: thisMonthStart },
        },
      }),
      newLastMonth: await tx.task.count({
        where: {
          ...taskWhere,
          createdAt: { gte: lastMonthStart, lt: lastMonthEnd },
        },
      }),
      // tasks completed this month
      completedThisMonth: await tx.task.count({
        where: {
          ...taskWhere,
          status: "COMPLETED",
          completedAt: { gte: thisMonthStart },
        },
      }),
      completedLastMonth: await tx.task.count({
        where: {
          ...taskWhere,
          status: "COMPLETED",
          completedAt: { gte: lastMonthStart, lt: lastMonthEnd },
        },
      }),
    }));

    const {
      totalTasks,
      completedTasks,
      inProgressTasks,
      pendingTasks,
      cancelledTasks,
      blockedTasks,
      overdueTasks,
      newThisMonth,
      newLastMonth,
      completedThisMonth,
      completedLastMonth,
    } = summaryCounts;

    const completionRate =
      totalTasks === 0
        ? 0
        : parseFloat(((completedTasks / totalTasks) * 100).toFixed(1));

    const overdueRate =
      totalTasks === 0
        ? 0
        : parseFloat(((overdueTasks / totalTasks) * 100).toFixed(1));

    const mom_created =
      newLastMonth === 0
        ? null
        : parseFloat(
            (((newThisMonth - newLastMonth) / newLastMonth) * 100).toFixed(1),
          );

    const mom_completed =
      completedLastMonth === 0
        ? null
        : parseFloat(
            (
              ((completedThisMonth - completedLastMonth) / completedLastMonth) *
              100
            ).toFixed(1),
          );

    /* ══════════════════════════════════════════════════════════
       SECTION B — Priority breakdown
    ══════════════════════════════════════════════════════════ */
    const priorityGroups = await prisma.task.groupBy({
      by: ["priority"],
      where: taskWhere,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    /* ══════════════════════════════════════════════════════════
       SECTION C — Average completion time (hours)
       Uses raw SQL to calculate (completedAt - startedAt)
    ══════════════════════════════════════════════════════════ */
    const avgCompletionRows = await prisma.$queryRaw<
      { avg_hours: number | null }[]
    >`
      SELECT ROUND(
        AVG(
          EXTRACT(EPOCH FROM (t."completedAt" - t."startedAt")) / 3600.0
        )::numeric, 2
      ) AS avg_hours
      FROM "Task" t
      WHERE t."deletedAt" IS NULL
        AND t."status" = 'COMPLETED'
        AND t."completedAt" IS NOT NULL
        AND t."startedAt"  IS NOT NULL
        ${rawDateFilter}
        ${rawProjectFilter}
    `;
    const avgCompletionHours = Number(avgCompletionRows[0]?.avg_hours ?? 0);

    /* ══════════════════════════════════════════════════════════
       SECTION D — Self-task vs assigned split
    ══════════════════════════════════════════════════════════ */
    const [selfTaskCount, assignedTaskCount] = await prisma.$transaction([
      prisma.task.count({ where: { ...taskWhere, isSelfTask: true } }),
      prisma.task.count({ where: { ...taskWhere, isSelfTask: false } }),
    ]);

    /* ══════════════════════════════════════════════════════════
       SECTION E — Monthly trend (last 13 months)
    ══════════════════════════════════════════════════════════ */
    const trendWindow = Prisma.sql`NOW() - INTERVAL '13 months'`;

    const [creationTrend, completionTrend] = await Promise.all([
      prisma.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT TO_CHAR(t."createdAt", 'YYYY-MM') AS month,
               COUNT(*)::bigint                  AS count
        FROM   "Task" t
        WHERE  t."deletedAt" IS NULL
          AND  t."createdAt" >= ${trendWindow}
          ${rawProjectFilter}
        GROUP  BY 1
        ORDER  BY 1 ASC
      `,
      prisma.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT TO_CHAR(t."completedAt", 'YYYY-MM') AS month,
               COUNT(*)::bigint                    AS count
        FROM   "Task" t
        WHERE  t."deletedAt" IS NULL
          AND  t."status" = 'COMPLETED'
          AND  t."completedAt" IS NOT NULL
          AND  t."completedAt" >= ${trendWindow}
          ${rawProjectFilter}
        GROUP  BY 1
        ORDER  BY 1 ASC
      `,
    ]);

    /* ══════════════════════════════════════════════════════════
       SECTION F — Per-employee leaderboard
       Joins TaskAssignment → Account for name resolution
    ══════════════════════════════════════════════════════════ */
    const leaderboardRows = await prisma.$queryRaw<
      {
        account_id: string;
        first_name: string;
        last_name: string;
        avatar: string | null;
        designation: string | null;
        total_assigned: bigint;
        completed: bigint;
        in_progress: bigint;
        pending: bigint;
        cancelled: bigint;
        overdue: bigint;
        avg_completion_hours: number | null;
        total_logged_minutes: bigint;
      }[]
    >`
      SELECT
        a.id                                                      AS account_id,
        a."firstName"                                             AS first_name,
        a."lastName"                                              AS last_name,
        a.avatar                                                  AS avatar,
        a.designation                                             AS designation,

        COUNT(DISTINCT t.id)                                      AS total_assigned,

        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED')  AS completed,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'IN_PROGRESS') AS in_progress,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'PENDING')    AS pending,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'CANCELLED')  AS cancelled,

        COUNT(DISTINCT t.id) FILTER (
          WHERE t."dueDate" < NOW()
            AND t.status NOT IN ('COMPLETED','CANCELLED')
        )                                                         AS overdue,

        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (t."completedAt" - t."startedAt")) / 3600.0
          ) FILTER (
            WHERE t.status = 'COMPLETED'
              AND t."completedAt" IS NOT NULL
              AND t."startedAt"  IS NOT NULL
          )::numeric, 2
        )                                                         AS avg_completion_hours,

        COALESCE(SUM(t."loggedMinutes") FILTER (WHERE t."loggedMinutes" > 0), 0)
                                                                  AS total_logged_minutes

      FROM "Account"      a
      JOIN "TaskAssignment" ta ON ta."accountId" = a.id
      JOIN "Task"           t  ON t.id = ta."taskId"
                               AND t."deletedAt" IS NULL
      WHERE a."isActive" = TRUE
        ${rawDateFilter}
        ${rawAccountFilter}
        ${rawProjectFilter}
      GROUP BY a.id, a."firstName", a."lastName", a.avatar, a.designation
      ORDER BY completed DESC, total_assigned DESC
      LIMIT 50
    `;

    const leaderboard = leaderboardRows.map((row) => {
      const total = Number(row.total_assigned);
      const completed = Number(row.completed);
      return {
        accountId: row.account_id,
        name: `${row.first_name} ${row.last_name}`.trim(),
        avatar: row.avatar,
        designation: row.designation,
        stats: {
          totalAssigned: total,
          completed,
          inProgress: Number(row.in_progress),
          pending: Number(row.pending),
          cancelled: Number(row.cancelled),
          overdue: Number(row.overdue),
          completionRate:
            total === 0
              ? 0
              : parseFloat(((completed / total) * 100).toFixed(1)),
          avgCompletionHours: row.avg_completion_hours
            ? Number(row.avg_completion_hours)
            : null,
          totalLoggedMinutes: Number(row.total_logged_minutes),
          totalLoggedHours: parseFloat(
            (Number(row.total_logged_minutes) / 60).toFixed(2),
          ),
        },
      };
    });

    /* ══════════════════════════════════════════════════════════
       SECTION G — Checklist completion rate
    ══════════════════════════════════════════════════════════ */
    const checklistStats = await prisma.$queryRaw<
      { total: bigint; completed: bigint }[]
    >`
      SELECT
        COUNT(*)::bigint                                       AS total,
        COUNT(*) FILTER (WHERE ci.status = 'COMPLETED')::bigint AS completed
      FROM "ChecklistItem" ci
      JOIN "Task" t ON t.id = ci."taskId" AND t."deletedAt" IS NULL
      ${
        accountId
          ? Prisma.sql`
            JOIN "TaskAssignment" ta ON ta."taskId" = t.id AND ta."accountId" = ${accountId}
            `
          : Prisma.empty
      }
      WHERE 1=1
        ${rawDateFilter}
        ${rawProjectFilter}
    `;

    const totalChecklist = Number(checklistStats[0]?.total ?? 0);
    const completedChecklist = Number(checklistStats[0]?.completed ?? 0);
    const checklistCompletionRate =
      totalChecklist === 0
        ? 0
        : parseFloat(((completedChecklist / totalChecklist) * 100).toFixed(1));

    /* ══════════════════════════════════════════════════════════
       SECTION H — Comment activity per employee (top 10)
    ══════════════════════════════════════════════════════════ */
    const commentActivityRows = await prisma.$queryRaw<
      {
        account_id: string;
        first_name: string;
        last_name: string;
        comment_count: bigint;
      }[]
    >`
      SELECT
        a.id            AS account_id,
        a."firstName"   AS first_name,
        a."lastName"    AS last_name,
        COUNT(tc.id)::bigint AS comment_count
      FROM "TaskComment" tc
      JOIN "Account" a ON a.id = tc."authorId"
      JOIN "Task"    t ON t.id = tc."taskId" AND t."deletedAt" IS NULL
      WHERE tc."deletedAt" IS NULL
        ${rawDateFilter}
        ${rawProjectFilter}
        ${rawAccountFilter ? Prisma.sql`AND a.id = ${accountId}` : Prisma.empty}
      GROUP BY a.id, a."firstName", a."lastName"
      ORDER BY comment_count DESC
      LIMIT 10
    `;

    /* ══════════════════════════════════════════════════════════
       SECTION I — Time-logging summary
    ══════════════════════════════════════════════════════════ */
    const timeLogRows = await prisma.$queryRaw<
      {
        total_entries: bigint;
        total_minutes: bigint;
        avg_minutes_per_task: number | null;
        employees_logging: bigint;
      }[]
    >`
      SELECT
        COUNT(tte.id)::bigint                           AS total_entries,
        COALESCE(SUM(tte."durationMinutes"), 0)::bigint AS total_minutes,
        ROUND(AVG(tte."durationMinutes")::numeric, 2)   AS avg_minutes_per_task,
        COUNT(DISTINCT tte."accountId")::bigint         AS employees_logging
      FROM "TaskTimeEntry" tte
      JOIN "Task" t ON t.id = tte."taskId" AND t."deletedAt" IS NULL
      WHERE tte."endedAt" IS NOT NULL
        ${rawDateFilter}
        ${rawProjectFilter}
        ${
          accountId
            ? Prisma.sql`AND tte."accountId" = ${accountId}`
            : Prisma.empty
        }
    `;

    const timeLogs = timeLogRows[0];

    /* ══════════════════════════════════════════════════════════
       SECTION J — Per-project breakdown (top 20)
    ══════════════════════════════════════════════════════════ */
    const projectBreakdownRows = await prisma.$queryRaw<
      {
        project_id: string;
        project_name: string;
        total: bigint;
        completed: bigint;
        in_progress: bigint;
        pending: bigint;
        overdue: bigint;
        avg_completion_hours: number | null;
      }[]
    >`
      SELECT
        p.id                                                        AS project_id,
        p.name                                                      AS project_name,
        COUNT(DISTINCT t.id)::bigint                                AS total,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED')::bigint  AS completed,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'IN_PROGRESS')::bigint AS in_progress,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'PENDING')::bigint    AS pending,
        COUNT(DISTINCT t.id) FILTER (
          WHERE t."dueDate" < NOW()
            AND t.status NOT IN ('COMPLETED','CANCELLED')
        )::bigint                                                   AS overdue,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (t."completedAt" - t."startedAt")) / 3600.0
          ) FILTER (
            WHERE t.status = 'COMPLETED'
              AND t."completedAt" IS NOT NULL
              AND t."startedAt"  IS NOT NULL
          )::numeric, 2
        )                                                           AS avg_completion_hours
      FROM "Project" p
      JOIN "Task" t ON t."projectId" = p.id AND t."deletedAt" IS NULL
      ${
        accountId
          ? Prisma.sql`JOIN "TaskAssignment" ta ON ta."taskId" = t.id AND ta."accountId" = ${accountId}`
          : Prisma.empty
      }
      WHERE 1=1
        ${rawDateFilter}
      GROUP BY p.id, p.name
      ORDER BY total DESC
      LIMIT 20
    `;

    /* ══════════════════════════════════════════════════════════
       SECTION K — Overdue age buckets
       How long overdue tasks have been sitting
    ══════════════════════════════════════════════════════════ */
    const overdueBucketRows = await prisma.$queryRaw<
      { bucket: string; count: bigint }[]
    >`
      SELECT
        CASE
          WHEN NOW() - t."dueDate" <= INTERVAL '1 day'   THEN '< 1 day'
          WHEN NOW() - t."dueDate" <= INTERVAL '3 days'  THEN '1-3 days'
          WHEN NOW() - t."dueDate" <= INTERVAL '7 days'  THEN '4-7 days'
          WHEN NOW() - t."dueDate" <= INTERVAL '14 days' THEN '1-2 weeks'
          WHEN NOW() - t."dueDate" <= INTERVAL '30 days' THEN '2-4 weeks'
          ELSE '> 1 month'
        END AS bucket,
        COUNT(*)::bigint AS count
      FROM "Task" t
      WHERE t."deletedAt" IS NULL
        AND t."dueDate" IS NOT NULL
        AND t."dueDate" < NOW()
        AND t.status NOT IN ('COMPLETED','CANCELLED')
        ${rawDateFilter}
        ${rawProjectFilter}
        ${
          accountId
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM "TaskAssignment" ta
                WHERE ta."taskId" = t.id AND ta."accountId" = ${accountId}
              )`
            : Prisma.empty
        }
      GROUP BY 1
      ORDER BY MIN(NOW() - t."dueDate") ASC
    `;

    /* ══════════════════════════════════════════════════════════
       SECTION L — Recurring task stats
    ══════════════════════════════════════════════════════════ */
    const [totalRecurring, recurringCompleted] = await prisma.$transaction([
      prisma.task.count({
        where: { ...taskWhere, isRecurring: true, recurrenceParentId: null },
      }),
      prisma.task.count({
        where: {
          ...taskWhere,
          isRecurring: true,
          recurrenceParentId: { not: null },
          status: "COMPLETED",
        },
      }),
    ]);

    /* ══════════════════════════════════════════════════════════
       SECTION M — Individual employee deep-dive
       Only returned when accountId is provided
    ══════════════════════════════════════════════════════════ */
    let individualProfile: Record<string, any> | null = null;

    if (accountId) {
      const [account, recentTasks, statusHistory] = await Promise.all([
        // Employee info
        prisma.account.findUnique({
          where: { id: accountId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
            contactEmail: true,
            contactPhone: true,
            joinedAt: true,
            isBusy: true,
            isAvailable: true,
          },
        }),

        // 10 most recent tasks
        prisma.task.findMany({
          where: {
            deletedAt: null,
            assignments: { some: { accountId } },
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
            createdAt: true,
            project: { select: { id: true, name: true } },
          },
        }),

        // Status breakdown for this individual (raw for filter within assignment)
        prisma.$queryRaw<{ status: string; count: bigint }[]>`
          SELECT t.status, COUNT(*)::bigint AS count
          FROM "Task" t
          JOIN "TaskAssignment" ta ON ta."taskId" = t.id
          WHERE ta."accountId" = ${accountId}
            AND t."deletedAt" IS NULL
            ${rawDateFilter}
          GROUP BY t.status
        `,
      ]);

      // Weekly completion velocity (last 8 weeks)
      const weeklyVelocity = await prisma.$queryRaw<
        { week: string; completed: bigint }[]
      >`
        SELECT
          TO_CHAR(DATE_TRUNC('week', t."completedAt"), 'YYYY-MM-DD') AS week,
          COUNT(*)::bigint AS completed
        FROM "Task" t
        JOIN "TaskAssignment" ta ON ta."taskId" = t.id
        WHERE ta."accountId" = ${accountId}
          AND t."deletedAt"   IS NULL
          AND t.status        = 'COMPLETED'
          AND t."completedAt" >= NOW() - INTERVAL '8 weeks'
        GROUP BY 1
        ORDER BY 1 ASC
      `;

      individualProfile = {
        account,
        recentTasks,
        statusBreakdown: statusHistory.map((r) => ({
          status: r.status,
          count: Number(r.count),
        })),
        weeklyVelocity: weeklyVelocity.map((r) => ({
          week: r.week,
          completed: Number(r.completed),
        })),
      };
    }

    /* ══════════════════════════════════════════════════════════
       SECTION N — Top overdue employees
       Who has the most overdue tasks right now
    ══════════════════════════════════════════════════════════ */
    const topOverdueRows = await prisma.$queryRaw<
      {
        account_id: string;
        first_name: string;
        last_name: string;
        avatar: string | null;
        overdue_count: bigint;
      }[]
    >`
      SELECT
        a.id            AS account_id,
        a."firstName"   AS first_name,
        a."lastName"    AS last_name,
        a.avatar        AS avatar,
        COUNT(DISTINCT t.id)::bigint AS overdue_count
      FROM "Account" a
      JOIN "TaskAssignment" ta ON ta."accountId" = a.id
      JOIN "Task" t ON t.id = ta."taskId"
                   AND t."deletedAt" IS NULL
                   AND t."dueDate" < NOW()
                   AND t.status NOT IN ('COMPLETED','CANCELLED')
      WHERE a."isActive" = TRUE
        ${rawProjectFilter}
      GROUP BY a.id, a."firstName", a."lastName", a.avatar
      ORDER BY overdue_count DESC
      LIMIT 10
    `;

    /* ══════════════════════════════════════════════════════════
       ASSEMBLE RESPONSE
    ══════════════════════════════════════════════════════════ */
    return sendSuccessResponse(res, 200, "Employee task analytics fetched", {
      filters: {
        fromDate: fromDate ?? null,
        toDate: toDate ?? null,
        accountId: accountId ?? null,
        projectId: projectId ?? null,
        status: statusFilter ?? null,
      },

      summary: {
        totalTasks,
        completedTasks,
        inProgressTasks,
        pendingTasks,
        cancelledTasks,
        blockedTasks,
        overdueTasks,
        completionRate,
        overdueRate,
        avgCompletionHours,
        selfTaskCount,
        assignedTaskCount,
        newThisMonth,
        completedThisMonth,
        mom: {
          created: mom_created,
          completed: mom_completed,
        },
      },

      statusBreakdown: {
        PENDING: pendingTasks,
        IN_PROGRESS: inProgressTasks,
        BLOCKED: blockedTasks,
        COMPLETED: completedTasks,
        CANCELLED: cancelledTasks,
        OVERDUE: overdueTasks,
      },

      priorityBreakdown: priorityGroups.map((g) => ({
        priority: g.priority,
        count: g._count.id,
      })),

      checklist: {
        total: totalChecklist,
        completed: completedChecklist,
        completionRate: checklistCompletionRate,
      },

      timeLogs: {
        totalEntries: Number(timeLogs?.total_entries ?? 0),
        totalMinutes: Number(timeLogs?.total_minutes ?? 0),
        totalHours: parseFloat(
          (Number(timeLogs?.total_minutes ?? 0) / 60).toFixed(2),
        ),
        avgMinutesPerEntry: timeLogs?.avg_minutes_per_task
          ? Number(timeLogs.avg_minutes_per_task)
          : 0,
        employeesLogging: Number(timeLogs?.employees_logging ?? 0),
      },

      recurring: {
        totalDefinitions: totalRecurring,
        instancesCompleted: recurringCompleted,
      },

      overdueBuckets: overdueBucketRows.map((r) => ({
        bucket: r.bucket,
        count: Number(r.count),
      })),

      trends: {
        creation: creationTrend.map((r) => ({
          month: r.month,
          count: Number(r.count),
        })),
        completion: completionTrend.map((r) => ({
          month: r.month,
          count: Number(r.count),
        })),
      },

      leaderboard,

      topOverdueEmployees: topOverdueRows.map((r) => ({
        accountId: r.account_id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        avatar: r.avatar,
        overdueCount: Number(r.overdue_count),
      })),

      commentActivity: commentActivityRows.map((r) => ({
        accountId: r.account_id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        commentCount: Number(r.comment_count),
      })),

      projectBreakdown: projectBreakdownRows.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        total: Number(r.total),
        completed: Number(r.completed),
        inProgress: Number(r.in_progress),
        pending: Number(r.pending),
        overdue: Number(r.overdue),
        completionRate:
          Number(r.total) === 0
            ? 0
            : parseFloat(
                ((Number(r.completed) / Number(r.total)) * 100).toFixed(1),
              ),
        avgCompletionHours: r.avg_completion_hours
          ? Number(r.avg_completion_hours)
          : null,
      })),

      // Only present when a specific employee is requested
      ...(individualProfile ? { individualProfile } : {}),
    });
  } catch (err: any) {
    console.error("[getEmployeeTaskAnalytics] error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch employee analytics",
    );
  }
}