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
      ${accountId
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
        ${accountId
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
      ${accountId
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
        ${accountId
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


// /* ═══════════════════════════════════════════════════════════════
//    HELPERS
// ═══════════════════════════════════════════════════════════════ */

// // Utility: get array of the last N month boundaries
// function getLastNMonths(n: number): { start: Date; end: Date }[] {
//     const months: { start: Date; end: Date }[] = [];
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     for (let i = 0; i < n; i++) {
//         const year = today.getFullYear();
//         const month = today.getMonth() - i;
//         const start = new Date(year, month, 1);
//         start.setHours(0, 0, 0, 0);
//         const end = new Date(year, month + 1, 0);
//         end.setHours(23, 59, 59, 999);
//         months.push({ start, end });
//     }
//     return months.reverse(); // oldest first
// }

// // Utility: compute Month-over-Month growth percentage
// function momGrowth(current: number, previous: number): number | null {
//     if (previous === 0) return current > 0 ? 100 : 0;
//     return ((current - previous) / previous) * 100;
// }

// // Utility: simple send helpers
// function sendSuccess(res: Response, data: any) {
//     res.status(200).json(data);
// }
// function sendError(res: Response, code: number, message: string) {
//     res.status(code).json({ error: message });
// }

// /**
//  * GET /admin/analytics/employees/detailed
//  * 
//  * Comprehensive employee analytics including:
//  * - Attendance metrics
//  * - Lead/CRM performance
//  * - Task completion & productivity
//  * - Efficiency scoring
//  * - Individual & team comparisons
//  * - fromDate / toDate (inclusive)
//  * - Per‑employee detail (when accountId supplied)
//  * - Summary KPIs (totals, completion rate, overdue rate)
//  * - Month‑over‑month growth
//  * - Per‑status breakdown
//  * - Priority breakdown
//  * - Per‑employee leaderboard (top performers)
//  * - Monthly trend (last 13 months)
//  */
// export async function getEmployeeAnalyticsV2(req: Request, res: Response) {
//     try {
//         // ── 1. Auth guard ──
//         if (!req.user?.roles?.includes?.('ADMIN')) {
//             return sendError(res, 403, 'Admin access required');
//         }

//         // ── 2. Parse query params ──
//         const rawFrom = req.query.fromDate as string | undefined;
//         const rawTo = req.query.toDate as string | undefined;
//         const accountId = req.query.accountId as string | undefined;
//         const department = req.query.department as string | undefined;

//         const fromDate = new Date(rawFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
//         const toDate = new Date(rawTo || new Date());
//         fromDate.setHours(0, 0, 0, 0);
//         toDate.setHours(23, 59, 59, 999);

//         if (fromDate > toDate) {
//             return sendError(res, 400, "'fromDate' must be before 'toDate'");
//         }

//         // ── 3. Previous period for MoM growth ──
//         const periodLengthMs = toDate.getTime() - fromDate.getTime();
//         const prevEnd = new Date(fromDate.getTime() - 1);
//         const prevStart = new Date(prevEnd.getTime() - periodLengthMs);
//         prevStart.setHours(0, 0, 0, 0);
//         prevEnd.setHours(23, 59, 59, 999);

//         // ── 4. Fetch employees ──
//         const employees = await prisma.account.findMany({
//             where: {
//                 isActive: true,
//                 ...(accountId && { id: accountId }),
//                 ...(department && { designation: department }),
//             },
//             select: {
//                 id: true,
//                 firstName: true,
//                 lastName: true,
//                 avatar: true,
//                 designation: true,
//                 contactEmail: true,
//                 contactPhone: true,
//                 joinedAt: true,
//                 jobType: true,
//                 isBusy: true,
//                 isAvailable: true,
//                 salaryStructure: { select: { baseSalary: true } },
//             },
//         });

//         if (employees.length === 0) {
//             return sendSuccess(res, {
//                 dateRange: { from: fromDate, to: toDate },
//                 summary: { totalEmployees: 0, averagePerformanceScore: 0 },
//                 employees: [],
//                 leaderboard: [],
//                 monthOverMonth: null,
//                 statusBreakdowns: { leads: {}, tasks: {} },
//                 priorityBreakdown: {},
//                 monthlyTrend: [],
//             });
//         }

//         // ── 5. Parallel analytics for each employee ──
//         const detailed = await Promise.all(employees.map(emp => getEmployeeMetrics(emp, fromDate, toDate, prevStart, prevEnd)));

//         // ── 6. Aggregates for summary ──
//         const totalEmployees = detailed.length;
//         const avgPerformance = totalEmployees > 0
//             ? detailed.reduce((s, e) => s + e.performanceScore, 0) / totalEmployees
//             : 0;

//         const totalRevenue = detailed.reduce((s, e) => s + e.leads.revenue, 0);
//         const totalWorkHours = detailed.reduce((s, e) => s + e.productivity.totalWorkHours, 0);
//         const totalTasksCompleted = detailed.reduce((s, e) => s + e.tasks.completed, 0);

//         // ── 7. Status breakdowns (overall) ──
//         const leadStatusBreakdown = {};
//         const taskStatusBreakdown = {};
//         detailed.forEach(e => {
//             for (const [status, count] of Object.entries(e.leads.statusBreakdown)) {
//                 leadStatusBreakdown[status] = (leadStatusBreakdown[status] || 0) + count;
//             }
//             for (const [status, count] of Object.entries(e.tasks.statusBreakdown)) {
//                 taskStatusBreakdown[status] = (taskStatusBreakdown[status] || 0) + count;
//             }
//         });

//         // ── 8. Task priority breakdown ──
//         const priorityBreakdown = {
//             NONE: 0,
//             LOW: 0,
//             MEDIUM: 0,
//             HIGH: 0,
//             URGENT: 0,
//         };
//         detailed.forEach(e => {
//             for (const [priority, count] of Object.entries(e.tasks.priorityBreakdown)) {
//                 if (priority in priorityBreakdown) {
//                     priorityBreakdown[priority] += count;
//                 }
//             }
//         });

//         // ── 9. Leaderboard ──
//         const leaderboard = [...detailed]
//             .sort((a, b) => b.performanceScore - a.performanceScore)
//             .map(e => ({
//                 accountId: e.accountId,
//                 name: e.name,
//                 designation: e.designation,
//                 performanceScore: e.performanceScore,
//                 grade: e.productivity.grade,
//                 tasksCompleted: e.tasks.completed,
//                 revenue: e.leads.revenue,
//             }));

//         // ── 10. MoM growth (company-wide) ──
//         const prevMetrics = await getAggregateMetrics(employees.map(e => e.id), prevStart, prevEnd);
//         const currMetrics = {
//             revenue: totalRevenue,
//             tasksCompleted: totalTasksCompleted,
//             leadsConverted: detailed.reduce((s, e) => s + e.leads.converted, 0),
//             attendanceRate: detailed.length > 0
//                 ? detailed.reduce((s, e) => s + e.attendance.attendanceRate, 0) / detailed.length
//                 : 0,
//         };

//         const monthOverMonth = {
//             revenueGrowth: momGrowth(currMetrics.revenue, prevMetrics.revenue),
//             tasksCompletedGrowth: momGrowth(currMetrics.tasksCompleted, prevMetrics.tasksCompleted),
//             leadsConvertedGrowth: momGrowth(currMetrics.leadsConverted, prevMetrics.leadsConverted),
//             attendanceRateChange: prevMetrics.avgAttendanceRate !== null
//                 ? +(currMetrics.attendanceRate - prevMetrics.avgAttendanceRate).toFixed(2)
//                 : null,
//         };

//         // ── 11. Monthly trend (last 13 months) ──
//         // const monthlyTrend = await getMonthlyTrend(
//         //     employees.map(e => e.id),
//         //     detailed.length > 1 ? null : accountId // if single employee, show personal trend
//         // );

//         const monthlyTrend = await getMonthlyTrend(
//             employees.map(e => e.id),
//             detailed.length > 1 ? undefined : accountId
//         );

//         // ── 12. Final response ──
//         sendSuccess(res, {
//             dateRange: {
//                 from: fromDate,
//                 to: toDate,
//             },
//             filters: {
//                 accountId: accountId || null,
//                 department: department || null,
//             },
//             summary: {
//                 totalEmployees,
//                 averagePerformanceScore: Math.round(avgPerformance * 100) / 100,
//                 totalRevenue: Math.round(totalRevenue * 100) / 100,
//                 totalWorkHours: Math.round(totalWorkHours * 100) / 100,
//                 totalTasksCompleted,
//                 topPerformer: leaderboard[0] || null,
//                 performanceDistribution: {
//                     'A+': detailed.filter(e => e.productivity.grade === 'A+').length,
//                     'A': detailed.filter(e => e.productivity.grade === 'A').length,
//                     'A-': detailed.filter(e => e.productivity.grade === 'A-').length,
//                     'B+': detailed.filter(e => e.productivity.grade === 'B+').length,
//                     'B': detailed.filter(e => e.productivity.grade === 'B').length,
//                     'B-': detailed.filter(e => e.productivity.grade === 'B-').length,
//                     'C+': detailed.filter(e => e.productivity.grade === 'C+').length,
//                     'C': detailed.filter(e => e.productivity.grade === 'C').length,
//                     'D': detailed.filter(e => e.productivity.grade === 'D').length,
//                     'F': detailed.filter(e => e.productivity.grade === 'F').length,
//                 },
//             },
//             employees: detailed,             // full per‑employee breakdown
//             leaderboard,
//             monthOverMonth,
//             statusBreakdowns: {
//                 leads: leadStatusBreakdown,
//                 tasks: taskStatusBreakdown,
//             },
//             priorityBreakdown,               // task priority counts
//             monthlyTrend,
//         });
//     } catch (err: any) {
//         console.error('[EmployeeAnalyticsV2]', err);
//         sendError(res, 500, err?.message || 'Internal server error');
//     }
// }

// // ══════════════════════════════════════════════════════════
// //  Per‑employee metrics calculator
// // ══════════════════════════════════════════════════════════
// async function getEmployeeMetrics(
//     emp: any,
//     from: Date,
//     to: Date,
//     prevFrom: Date,
//     prevTo: Date
// ) {
//     const acctId = emp.id;

//     // ── A. Attendance ──
//     const logs = await prisma.attendanceLog.findMany({
//         where: { accountId: acctId, date: { gte: from, lte: to } },
//     });

//     const present = logs.filter(l => l.status === 'PRESENT').length;
//     const half = logs.filter(l => l.status === 'HALF_DAY').length;
//     const absent = logs.filter(l => l.status === 'ABSENT').length;
//     const wfh = logs.filter(l => l.isWFH).length;
//     const late = logs.filter(l => l.firstCheckIn &&
//         (l.firstCheckIn.getHours() > 10 || (l.firstCheckIn.getHours() === 10 && l.firstCheckIn.getMinutes() > 0))
//     ).length;

//     const totalWorkMinutes = logs.reduce((s, l) => s + l.totalWorkMinutes, 0);
//     const totalWorkHours = totalWorkMinutes / 60;

//     const workingDays = getWorkingDaysBetween(from, to);
//     const attendanceRate = workingDays > 0 ? ((present + half * 0.5) / workingDays) * 100 : 0;

//     // ── B. Leads ──
//     const leads = await prisma.lead.findMany({
//         where: {
//             assignments: { some: { accountId: acctId, isActive: true } },
//             createdAt: { gte: from, lte: to },
//         },
//         include: {
//             assignments: { where: { accountId: acctId }, select: { WorkSeconds: true } },
//             followUps: { where: { createdAt: { gte: from, lte: to } }, select: { status: true } },
//         },
//     });

//     const leadStatuses = leads.map(l => l.status);
//     const converted = leadStatuses.filter(s => s === 'CONVERTED').length;
//     const totalLeads = leads.length;
//     const conversionRate = totalLeads > 0 ? (converted / totalLeads) * 100 : 0;
//     const revenue = leads.filter(l => l.status === 'CONVERTED').reduce((s, l) => s + Number(l.cost || 0), 0);
//     const leadWorkSec = leads.reduce((s, l) => s + (l.totalWorkSeconds || 0), 0);
//     const leadWorkHours = leadWorkSec / 3600;
//     const followUpTotal = leads.flatMap(l => l.followUps).length;
//     const followUpDone = leads.flatMap(l => l.followUps.filter(f => f.status === 'DONE')).length;
//     const followUpRate = followUpTotal > 0 ? (followUpDone / followUpTotal) * 100 : 0;

//     const leadStatusBreakdown = {};
//     for (const s of leadStatuses) {
//         leadStatusBreakdown[s] = (leadStatusBreakdown[s] || 0) + 1;
//     }

//     // ── C. Tasks ──
//     const tasks = await prisma.task.findMany({
//         where: {
//             assignments: { some: { accountId: acctId } },
//             OR: [
//                 { createdAt: { gte: from, lte: to } },
//                 { completedAt: { gte: from, lte: to } },
//             ],
//             deletedAt: null,
//         },
//         include: {
//             checklist: true,
//             timeEntries: { where: { startedAt: { gte: from, lte: to } } },
//         },
//     });

//     const taskStatuses = tasks.map(t => t.status);
//     const pending = taskStatuses.filter(s => s === 'PENDING').length;
//     const inProgress = taskStatuses.filter(s => s === 'IN_PROGRESS').length;
//     const inReview = taskStatuses.filter(s => s === 'IN_REVIEW').length;
//     const blocked = taskStatuses.filter(s => s === 'BLOCKED').length;
//     const completed = taskStatuses.filter(s => s === 'COMPLETED').length;
//     const cancelled = taskStatuses.filter(s => s === 'CANCELLED').length;
//     const totalTasks = tasks.length;
//     const completionRate = totalTasks > 0 ? (completed / totalTasks) * 100 : 0;

//     // overdue tasks
//     const now = new Date();
//     const overdue = tasks.filter(t =>
//         t.status !== 'COMPLETED' && t.status !== 'CANCELLED' &&
//         t.dueDate && new Date(t.dueDate) < now
//     ).length;

//     // on‑time completion
//     const completedOnTime = tasks.filter(t =>
//         t.status === 'COMPLETED' && t.dueDate && t.completedAt &&
//         new Date(t.completedAt) <= new Date(t.dueDate)
//     ).length;
//     const onTimeRate = completed > 0 ? (completedOnTime / completed) * 100 : 0;

//     // Time tracking
//     const estimatedHours = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0) / 60;
//     const loggedHours = tasks.reduce((s, t) => s + (t.loggedMinutes || 0), 0) / 60;
//     const timeAccuracy = estimatedHours > 0 ? (loggedHours / estimatedHours) * 100 : 0;

//     // Checklist
//     const checklistItems = tasks.flatMap(t => t.checklist);
//     const checklistDone = checklistItems.filter(c => c.status === 'COMPLETED').length;
//     const checklistRate = checklistItems.length > 0 ? (checklistDone / checklistItems.length) * 100 : 0;

//     // Priority breakdown
//     const priorityBreakdown = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
//     for (const t of tasks) {
//         priorityBreakdown[t.priority] = (priorityBreakdown[t.priority] || 0) + 1;
//     }

//     // ── D. Efficiency scoring ──
//     const weights = {
//         conversion: 0.35,
//         tasks: 0.30,
//         attendance: 0.15,
//         timeAccuracy: 0.10,
//         checklist: 0.05,
//         followUp: 0.05,
//     };
//     const score =
//         conversionRate * weights.conversion +
//         completionRate * weights.tasks +
//         attendanceRate * weights.attendance +
//         Math.min(timeAccuracy, 100) * weights.timeAccuracy +
//         checklistRate * weights.checklist +
//         followUpRate * weights.followUp;

//     const grade = score >= 90 ? 'A+' : score >= 85 ? 'A' : score >= 80 ? 'A-'
//         : score >= 75 ? 'B+' : score >= 70 ? 'B' : score >= 65 ? 'B-'
//             : score >= 60 ? 'C+' : score >= 55 ? 'C' : score >= 50 ? 'D' : 'F';

//     // revenue per hour
//     const totalWorkHrs = totalWorkHours + leadWorkHours;
//     const revPerHour = totalWorkHrs > 0 ? revenue / totalWorkHrs : 0;

//     return {
//         accountId: acctId,
//         name: `${emp.firstName} ${emp.lastName}`,
//         avatar: emp.avatar,
//         designation: emp.designation || 'Not Specified',
//         contactEmail: emp.contactEmail,
//         contactPhone: emp.contactPhone,
//         joinedAt: emp.joinedAt,
//         jobType: emp.jobType,
//         currentStatus: { isBusy: emp.isBusy, isAvailable: emp.isAvailable },

//         attendance: {
//             workingDays,
//             presentDays: present,
//             halfDays: half,
//             absentDays: absent,
//             wfhDays: wfh,
//             lateDays: late,
//             attendanceRate: Math.round(attendanceRate * 100) / 100,
//             totalWorkHours: Math.round(totalWorkHours * 100) / 100,
//             avgDailyHours: present > 0 ? Math.round((totalWorkHours / present) * 100) / 100 : 0,
//         },

//         leads: {
//             totalAssigned: totalLeads,
//             statusBreakdown: leadStatusBreakdown,
//             converted,
//             conversionRate: Math.round(conversionRate * 100) / 100,
//             followUpCompletionRate: Math.round(followUpRate * 100) / 100,
//             revenue: Math.round(revenue * 100) / 100,
//             revenuePerHour: Math.round(revPerHour * 100) / 100,
//             workHours: Math.round(leadWorkHours * 100) / 100,
//             avgHoursPerLead: totalLeads > 0 ? Math.round((leadWorkHours / totalLeads) * 100) / 100 : 0,
//         },

//         tasks: {
//             totalAssigned: totalTasks,
//             statusBreakdown: {
//                 PENDING: pending,
//                 IN_PROGRESS: inProgress,
//                 IN_REVIEW: inReview,
//                 BLOCKED: blocked,
//                 COMPLETED: completed,
//                 CANCELLED: cancelled,
//             },
//             completed,
//             pending: pending + inProgress,
//             overdue,
//             completedOnTime,
//             onTimeRate: Math.round(onTimeRate * 100) / 100,
//             completionRate: Math.round(completionRate * 100) / 100,
//             estimatedHours: Math.round(estimatedHours * 100) / 100,
//             loggedHours: Math.round(loggedHours * 100) / 100,
//             timeAccuracy: Math.round(timeAccuracy * 100) / 100,
//             checklistCompletionRate: Math.round(checklistRate * 100) / 100,
//             priorityBreakdown,
//         },

//         productivity: {
//             totalWorkHours: Math.round((totalWorkHours + leadWorkHours + loggedHours) * 100) / 100,
//             score: Math.round(score * 100) / 100,
//             grade,
//             revenueGenerated: Math.round(revenue * 100) / 100,
//             tasksPerDay: workingDays > 0 ? Math.round((completed / workingDays) * 100) / 100 : 0,
//         },

//         performanceScore: Math.round(score * 100) / 100,
//     };
// }

// // ══════════════════════════════════════════════════════════
// //  Aggregate helpers
// // ══════════════════════════════════════════════════════════

// function getWorkingDaysBetween(start: Date, end: Date): number {
//     let count = 0;
//     const d = new Date(start);
//     while (d <= end) {
//         if (d.getDay() !== 0) count++; // exclude Sundays
//         d.setDate(d.getDate() + 1);
//     }
//     return count;
// }

// async function getAggregateMetrics(accountIds: string[], from: Date, to: Date) {
//     if (accountIds.length === 0) return { revenue: 0, tasksCompleted: 0, leadsConverted: 0, avgAttendanceRate: null };

//     // revenue from converted leads
//     const leads = await prisma.lead.findMany({
//         where: {
//             assignments: { some: { accountId: { in: accountIds }, isActive: true } },
//             status: 'CONVERTED',
//             createdAt: { gte: from, lte: to },
//         },
//         select: { cost: true },
//     });
//     const revenue = leads.reduce((s, l) => s + Number(l.cost || 0), 0);

//     // tasks completed
//     const tasks = await prisma.task.findMany({
//         where: {
//             assignments: { some: { accountId: { in: accountIds } } },
//             status: 'COMPLETED',
//             completedAt: { gte: from, lte: to },
//             deletedAt: null,
//         },
//     });
//     const tasksCompleted = tasks.length;

//     // attendance rates (simple average across employees for the period)
//     // Not implemented fully for brevity; you could add avgAttendanceRate by fetching logs similarly.

//     return { revenue, tasksCompleted, leadsConverted: 0, avgAttendanceRate: null }; // adjust as needed
// }

// // ══════════════════════════════════════════════════════════
// //  Monthly trend generator (last 13 months)
// // ══════════════════════════════════════════════════════════
// async function getMonthlyTrend(accountIds: string[], singleAccountId?: string) {
//     const months = getLastNMonths(13);
//     const trend: any[] = [];

//     for (const { start, end } of months) {
//         // For each month, compute aggregate metrics for the given employee(s)
//         const tasks = await prisma.task.count({
//             where: {
//                 assignments: { some: { accountId: { in: accountIds } } },
//                 status: 'COMPLETED',
//                 completedAt: { gte: start, lte: end },
//                 deletedAt: null,
//             },
//         });

//         const leads = await prisma.lead.count({
//             where: {
//                 assignments: { some: { accountId: { in: accountIds }, isActive: true } },
//                 status: 'CONVERTED',
//                 createdAt: { gte: start, lte: end },
//             },
//         });

//         const revenueResult = await prisma.lead.aggregate({
//             _sum: { cost: true },
//             where: {
//                 assignments: { some: { accountId: { in: accountIds }, isActive: true } },
//                 status: 'CONVERTED',
//                 createdAt: { gte: start, lte: end },
//             },
//         });

//         trend.push({
//             month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
//             tasksCompleted: tasks,
//             leadsConverted: leads,
//             revenue: Number(revenueResult._sum.cost || 0),
//             // attendance rate can be added if needed
//         });
//     }

//     return trend;
// }




// ══════════════════════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════════════════════

type LeadStatusBreakdown = Partial<
    Record<'PENDING' | 'IN_PROGRESS' | 'FOLLOW_UPS' | 'DEMO_DONE' | 'INTERESTED' | 'CONVERTED' | 'CLOSED', number>
>;

type TaskStatusBreakdown = Partial<
    Record<'PENDING' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED', number>
>;

type PriorityBreakdown = Record<'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT', number>;

type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'D' | 'F';

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

/** Compute working days between two dates.
 *  Excludes Sunday by default. Pass `excludeSaturday = true` for a 5-day week. */
function getWorkingDaysBetween(start: Date, end: Date, excludeSaturday = false): number {
    let count = 0;
    const d = new Date(start);
    d.setHours(0, 0, 0, 0);
    const endCopy = new Date(end);
    endCopy.setHours(23, 59, 59, 999);
    while (d <= endCopy) {
        const day = d.getDay();
        if (day !== 0 && (!excludeSaturday || day !== 6)) count++;
        d.setDate(d.getDate() + 1);
    }
    return count;
}

/** MoM growth %. Returns null only when previous period had no data at all. */
function momGrowth(current: number, previous: number): number | null {
    if (previous === 0) return current > 0 ? 100 : null;
    return +((current - previous) / Math.abs(previous) * 100).toFixed(2);
}

/** Derive the immediately preceding calendar period of equal length. */
function previousPeriod(from: Date, to: Date): { prevStart: Date; prevEnd: Date } {
    const ms = to.getTime() - from.getTime();
    const prevEnd = new Date(from.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - ms);
    prevStart.setHours(0, 0, 0, 0);
    prevEnd.setHours(23, 59, 59, 999);
    return { prevStart, prevEnd };
}

/** Last N calendar months (oldest first). */
function getLastNMonths(n: number): { start: Date; end: Date; label: string }[] {
    const months: { start: Date; end: Date; label: string }[] = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
        end.setHours(23, 59, 59, 999);
        months.push({
            start,
            end,
            label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
        });
    }
    return months;
}

function scoreToGrade(score: number): Grade {
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'A-';
    if (score >= 75) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 65) return 'B-';
    if (score >= 60) return 'C+';
    if (score >= 55) return 'C';
    if (score >= 50) return 'D';
    return 'F';
}

function sendSuccess(res: Response, data: unknown) {
    res.status(200).json(data);
}

function sendError(res: Response, code: number, message: string) {
    res.status(code).json({ error: message });
}

// ══════════════════════════════════════════════════════════════
//  MAIN HANDLER
//  GET /admin/analytics/employees/detailed
//
//  Query params
//  ─────────────────────────────────────────────────────────────
//  fromDate       ISO date string  (default: start of current month)
//  toDate         ISO date string  (default: today)
//  accountId      filter to one employee
//  department     filter by designation
//  excludeSaturday  "true" to use a 5-day working-week
// ══════════════════════════════════════════════════════════════

export async function getEmployeeAnalyticsV2(req: Request, res: Response) {
    try {
        // ── 1. Auth ──────────────────────────────────────────
        if (!req.user?.roles?.includes?.('ADMIN')) {
            return sendError(res, 403, 'Admin access required');
        }

        // ── 2. Parse + validate params ────────────────────────
        const rawFrom = req.query.fromDate as string | undefined;
        const rawTo   = req.query.toDate   as string | undefined;
        const accountId     = req.query.accountId     as string | undefined;
        const department    = req.query.department    as string | undefined;
        const excludeSat    = req.query.excludeSaturday === 'true';

        const fromDate = new Date(rawFrom ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        const toDate   = new Date(rawTo   ?? new Date());
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            return sendError(res, 400, 'Invalid date format. Use ISO 8601 strings.');
        }
        if (fromDate > toDate) {
            return sendError(res, 400, "'fromDate' must be before 'toDate'");
        }

        // ── 3. Previous period for MoM ────────────────────────
        const { prevStart, prevEnd } = previousPeriod(fromDate, toDate);

        // ── 4. Fetch employees ────────────────────────────────
        const employees = await prisma.account.findMany({
            where: {
                isActive: true,
                // BUG FIX #7: when an accountId is supplied we still enforce isActive
                ...(accountId   && { id: accountId }),
                ...(department  && { designation: department }),
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
                designation: true,
                contactEmail: true,
                contactPhone: true,
                joinedAt: true,
                jobType: true,
                isBusy: true,
                isAvailable: true,
                salaryStructure: { select: { baseSalary: true } },
            },
        });

        if (employees.length === 0) {
            return sendSuccess(res, emptyResponse(fromDate, toDate, accountId, department));
        }

        const accountIds = employees.map(e => e.id);

        // ── 5. Per-employee detail (in parallel) ──────────────
        const detailed = await Promise.all(
            employees.map(emp => getEmployeeMetrics(emp, fromDate, toDate, excludeSat))
        );

        // ── 6. Company-wide aggregates ────────────────────────
        const totalEmployees      = detailed.length;
        const totalRevenue        = detailed.reduce((s, e) => s + e.leads.revenue, 0);
        const totalWorkHours      = detailed.reduce((s, e) => s + e.attendance.totalWorkHours, 0);
        const totalTasksCompleted = detailed.reduce((s, e) => s + e.tasks.completed, 0);
        const totalLeadsConverted = detailed.reduce((s, e) => s + e.leads.converted, 0);
        const avgPerformance      = totalEmployees > 0
            ? detailed.reduce((s, e) => s + e.performanceScore, 0) / totalEmployees
            : 0;
        const avgAttendanceRate   = totalEmployees > 0
            ? detailed.reduce((s, e) => s + e.attendance.attendanceRate, 0) / totalEmployees
            : 0;

        // ── 7. Overall status / priority breakdowns ───────────
        const leadStatusBreakdown: LeadStatusBreakdown = {};
        const taskStatusBreakdown: TaskStatusBreakdown = {};
        const priorityBreakdown: PriorityBreakdown = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };

        for (const e of detailed) {
            for (const [k, v] of Object.entries(e.leads.statusBreakdown) as [keyof LeadStatusBreakdown, number][]) {
                leadStatusBreakdown[k] = (leadStatusBreakdown[k] ?? 0) + v;
            }
            for (const [k, v] of Object.entries(e.tasks.statusBreakdown) as [keyof TaskStatusBreakdown, number][]) {
                taskStatusBreakdown[k] = (taskStatusBreakdown[k] ?? 0) + v;
            }
            for (const [k, v] of Object.entries(e.tasks.priorityBreakdown) as [keyof PriorityBreakdown, number][]) {
                priorityBreakdown[k] += v;
            }
        }

        // ── 8. Leaderboard ────────────────────────────────────
        const leaderboard = [...detailed]
            .sort((a, b) => b.performanceScore - a.performanceScore)
            .map(e => ({
                accountId:        e.accountId,
                name:             e.name,
                designation:      e.designation,
                avatar:           e.avatar,
                performanceScore: e.performanceScore,
                grade:            e.productivity.grade,
                tasksCompleted:   e.tasks.completed,
                revenue:          e.leads.revenue,
                attendanceRate:   e.attendance.attendanceRate,
            }));

        // ── 9. MoM growth ─────────────────────────────────────
        // BUG FIX #1: previous period now includes leadsConverted + avgAttendanceRate
        const prev = await getAggregateMetrics(accountIds, prevStart, prevEnd);
        const monthOverMonth = {
            revenueGrowth:        momGrowth(totalRevenue,        prev.revenue),
            tasksCompletedGrowth: momGrowth(totalTasksCompleted, prev.tasksCompleted),
            leadsConvertedGrowth: momGrowth(totalLeadsConverted, prev.leadsConverted),
            attendanceRateChange: prev.avgAttendanceRate !== null
                ? +(avgAttendanceRate - prev.avgAttendanceRate).toFixed(2)
                : null,
        };

        // ── 10. Monthly trend (last 13 months, batched) ───────
        // BUG FIX #2 + #3: respects singleAccountId, batches all months in ~3 queries
        const monthlyTrend = await getMonthlyTrend(
            accountIds,
            // BUG FIX #2: pass the individual account if only one employee is in scope
            detailed.length === 1 ? detailed[0].accountId : undefined
        );

        // ── 11. Performance distribution ──────────────────────
        const allGrades: Grade[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];
        const performanceDistribution = Object.fromEntries(
            allGrades.map(g => [g, detailed.filter(e => e.productivity.grade === g).length])
        );

        // ── 12. Final response ────────────────────────────────
        return sendSuccess(res, {
            dateRange: { from: fromDate, to: toDate },
            filters: {
                accountId:       accountId       ?? null,
                department:      department      ?? null,
                excludeSaturday: excludeSat,
            },
            summary: {
                totalEmployees,
                averagePerformanceScore: round(avgPerformance),
                totalRevenue:            round(totalRevenue),
                totalWorkHours:          round(totalWorkHours),
                totalTasksCompleted,
                totalLeadsConverted,
                avgAttendanceRate:       round(avgAttendanceRate),
                topPerformer:            leaderboard[0] ?? null,
                performanceDistribution,
            },
            employees:   detailed,
            leaderboard,
            monthOverMonth,
            statusBreakdowns: {
                leads: leadStatusBreakdown,
                tasks: taskStatusBreakdown,
            },
            priorityBreakdown,
            monthlyTrend,
        });

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        console.error('[EmployeeAnalyticsV2]', err);
        return sendError(res, 500, message);
    }
}

// ══════════════════════════════════════════════════════════════
//  PER-EMPLOYEE METRICS
// ══════════════════════════════════════════════════════════════

async function getEmployeeMetrics(
    emp: {
        id: string; firstName: string; lastName: string; avatar: string | null;
        designation: string | null; contactEmail: string; contactPhone: string;
        joinedAt: Date | null; jobType: string | null; isBusy: boolean; isAvailable: boolean;
    },
    from: Date,
    to:   Date,
    excludeSat: boolean
) {
    const id = emp.id;

    // ── A. Attendance ─────────────────────────────────────────
    const logs = await prisma.attendanceLog.findMany({
        where: { accountId: id, date: { gte: from, lte: to } },
    });

    const present    = logs.filter(l => l.status === 'PRESENT').length;
    const half       = logs.filter(l => l.status === 'HALF_DAY').length;
    const absent     = logs.filter(l => l.status === 'ABSENT').length;
    const wfh        = logs.filter(l => l.isWFH).length;
    const late       = logs.filter(l =>
        l.firstCheckIn && (
            l.firstCheckIn.getHours() > 10 ||
            (l.firstCheckIn.getHours() === 10 && l.firstCheckIn.getMinutes() > 0)
        )
    ).length;

    const totalWorkMinutes = logs.reduce((s, l) => s + l.totalWorkMinutes, 0);
    const totalWorkHours   = totalWorkMinutes / 60;

    const workingDays    = getWorkingDaysBetween(from, to, excludeSat);
    const attendanceRate = workingDays > 0
        ? ((present + half * 0.5) / workingDays) * 100
        : 0;

    // ── B. Leads ──────────────────────────────────────────────
    // BUG FIX #5: filter by assignment activity window, not lead createdAt,
    // so we capture leads created before the period but worked on during it.
    const leads = await prisma.lead.findMany({
        where: {
            assignments: {
                some: {
                    accountId: id,
                    isActive:  true,
                    // Include leads assigned before `from` that are still active,
                    // and leads assigned during the window
                    assignedAt: { lte: to },
                },
            },
            // Optionally also restrict to leads updated/created in range so
            // stale ancient leads don't inflate numbers:
            updatedAt: { gte: from, lte: to },
            isActive: true,
        },
        include: {
            assignments: { where: { accountId: id } },
            followUps:   {
                where: { scheduledAt: { gte: from, lte: to } },
                select: { status: true },
            },
        },
    });

    const leadStatusBreakdown: LeadStatusBreakdown = {};
    let converted    = 0;
    let revenue      = 0;
    let leadWorkSec  = 0;
    let followUpDone = 0;
    let followUpTot  = 0;

    for (const l of leads) {
        const s = l.status as keyof LeadStatusBreakdown;
        leadStatusBreakdown[s] = (leadStatusBreakdown[s] ?? 0) + 1;
        if (l.status === 'CONVERTED') {
            converted++;
            revenue += Number(l.cost ?? 0);
        }
        leadWorkSec  += l.totalWorkSeconds ?? 0;
        followUpTot  += l.followUps.length;
        followUpDone += l.followUps.filter(f => f.status === 'DONE').length;
    }

    const totalLeads     = leads.length;
    const conversionRate = totalLeads > 0 ? (converted / totalLeads) * 100 : 0;
    const leadWorkHours  = leadWorkSec / 3600;
    const followUpRate   = followUpTot > 0 ? (followUpDone / followUpTot) * 100 : 0;
    const revPerHour     = leadWorkHours > 0 ? revenue / leadWorkHours : 0;

    // ── C. Tasks ──────────────────────────────────────────────
    const tasks = await prisma.task.findMany({
        where: {
            assignments: { some: { accountId: id } },
            OR: [
                { createdAt:   { gte: from, lte: to } },
                { completedAt: { gte: from, lte: to } },
                { updatedAt:   { gte: from, lte: to } },
            ],
            deletedAt: null,
        },
        include: {
            checklist:   true,
            timeEntries: { where: { startedAt: { gte: from, lte: to } } },
        },
    });

    const taskStatusBreakdown: TaskStatusBreakdown = {
        PENDING: 0, IN_PROGRESS: 0, IN_REVIEW: 0, BLOCKED: 0, COMPLETED: 0, CANCELLED: 0,
    };
    const priorityBreakdown: PriorityBreakdown = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };

    let completed  = 0;
    let overdue    = 0;
    let completedOnTime = 0;
    let estimatedMin = 0;
    let loggedMin    = 0;
    const now = new Date();

    for (const t of tasks) {
        const st = t.status as keyof TaskStatusBreakdown;
        taskStatusBreakdown[st] = (taskStatusBreakdown[st] ?? 0) + 1;
        priorityBreakdown[t.priority as keyof PriorityBreakdown]++;

        if (t.status === 'COMPLETED') {
            completed++;
            if (t.dueDate && t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate)) {
                completedOnTime++;
            }
        }
        if (
            t.status !== 'COMPLETED' && t.status !== 'CANCELLED' &&
            t.dueDate && new Date(t.dueDate) < now
        ) overdue++;

        estimatedMin += t.estimatedMinutes ?? 0;
        loggedMin    += t.loggedMinutes     ?? 0;
    }

    const totalTasks      = tasks.length;
    const completionRate  = totalTasks  > 0 ? (completed / totalTasks)  * 100 : 0;
    const onTimeRate      = completed   > 0 ? (completedOnTime / completed) * 100 : 0;
    const estimatedHours  = estimatedMin / 60;
    const loggedHours     = loggedMin    / 60;

    // BUG FIX #8: cap raw timeAccuracy at 200% for display, and cap at 100 for scoring
    const rawTimeAccuracy  = estimatedHours > 0 ? (loggedHours / estimatedHours) * 100 : 0;
    const cappedForDisplay = Math.min(rawTimeAccuracy, 200);

    const checklistItems = tasks.flatMap(t => t.checklist);
    const checklistDone  = checklistItems.filter(c => c.status === 'COMPLETED').length;
    const checklistRate  = checklistItems.length > 0
        ? (checklistDone / checklistItems.length) * 100
        : 0;

    // ── D. Performance score ──────────────────────────────────
    const WEIGHTS = {
        conversion:   0.35,
        tasks:        0.30,
        attendance:   0.15,
        timeAccuracy: 0.10,
        checklist:    0.05,
        followUp:     0.05,
    } as const;

    const score =
        conversionRate                     * WEIGHTS.conversion  +
        completionRate                     * WEIGHTS.tasks        +
        attendanceRate                     * WEIGHTS.attendance   +
        Math.min(rawTimeAccuracy, 100)     * WEIGHTS.timeAccuracy + // cap at 100 for score
        checklistRate                      * WEIGHTS.checklist    +
        followUpRate                       * WEIGHTS.followUp;

    const grade = scoreToGrade(score);

    return {
        accountId:     id,
        name:          `${emp.firstName} ${emp.lastName}`,
        avatar:        emp.avatar,
        designation:   emp.designation ?? 'Not Specified',
        contactEmail:  emp.contactEmail,
        contactPhone:  emp.contactPhone,
        joinedAt:      emp.joinedAt,
        jobType:       emp.jobType,
        currentStatus: { isBusy: emp.isBusy, isAvailable: emp.isAvailable },

        attendance: {
            workingDays,
            presentDays:     present,
            halfDays:        half,
            absentDays:      absent,
            wfhDays:         wfh,
            lateDays:        late,
            attendanceRate:  round(attendanceRate),
            totalWorkHours:  round(totalWorkHours),
            avgDailyHours:   present > 0 ? round(totalWorkHours / present) : 0,
        },

        leads: {
            totalAssigned:            totalLeads,
            statusBreakdown:          leadStatusBreakdown,
            converted,
            conversionRate:           round(conversionRate),
            followUpCompletionRate:   round(followUpRate),
            revenue:                  round(revenue),
            revenuePerHour:           round(revPerHour),
            workHours:                round(leadWorkHours),
            avgHoursPerLead:          totalLeads > 0 ? round(leadWorkHours / totalLeads) : 0,
        },

        tasks: {
            totalAssigned:             totalTasks,
            statusBreakdown:           taskStatusBreakdown,
            completed,
            pending:                   (taskStatusBreakdown.PENDING  ?? 0) +
                                       (taskStatusBreakdown.IN_PROGRESS ?? 0),
            overdue,
            completedOnTime,
            onTimeRate:                round(onTimeRate),
            completionRate:            round(completionRate),
            estimatedHours:            round(estimatedHours),
            loggedHours:               round(loggedHours),
            timeAccuracy:              round(cappedForDisplay),  // BUG FIX #8
            checklistCompletionRate:   round(checklistRate),
            priorityBreakdown,
        },

        productivity: {
            totalWorkHours:    round(totalWorkHours + leadWorkHours + loggedHours),
            score:             round(score),
            grade,
            revenueGenerated:  round(revenue),
            tasksPerDay:       workingDays > 0 ? round(completed / workingDays) : 0,
        },

        performanceScore: round(score),
    };
}

// ══════════════════════════════════════════════════════════════
//  AGGREGATE METRICS (for MoM comparison)
//  BUG FIX #1: now correctly computes leadsConverted + avgAttendanceRate
// ══════════════════════════════════════════════════════════════

async function getAggregateMetrics(ids: string[], from: Date, to: Date) {
    if (ids.length === 0) {
        return { revenue: 0, tasksCompleted: 0, leadsConverted: 0, avgAttendanceRate: null };
    }

    const [leads, tasks, attendanceLogs] = await Promise.all([
        prisma.lead.findMany({
            where: {
                assignments: { some: { accountId: { in: ids }, isActive: true } },
                status:      'CONVERTED',
                updatedAt:   { gte: from, lte: to },
            },
            select: { cost: true },
        }),
        prisma.task.count({
            where: {
                assignments: { some: { accountId: { in: ids } } },
                status:      'COMPLETED',
                completedAt: { gte: from, lte: to },
                deletedAt:   null,
            },
        }),
        // BUG FIX #1: fetch attendance logs so we can compute avgAttendanceRate
        prisma.attendanceLog.findMany({
            where: { accountId: { in: ids }, date: { gte: from, lte: to } },
            select: { accountId: true, status: true },
        }),
    ]);

    const revenue         = leads.reduce((s, l) => s + Number(l.cost ?? 0), 0);
    const leadsConverted  = leads.length;
    const tasksCompleted  = tasks;

    // Average attendance rate across all employees in the period
    let avgAttendanceRate: number | null = null;
    if (attendanceLogs.length > 0) {
        const workingDays = getWorkingDaysBetween(from, to);
        if (workingDays > 0) {
            const rateByEmp = new Map<string, { present: number; half: number }>();
            for (const log of attendanceLogs) {
                if (!rateByEmp.has(log.accountId)) rateByEmp.set(log.accountId, { present: 0, half: 0 });
                const r = rateByEmp.get(log.accountId)!;
                if (log.status === 'PRESENT')  r.present++;
                if (log.status === 'HALF_DAY') r.half++;
            }
            const rates = [...rateByEmp.values()].map(r =>
                ((r.present + r.half * 0.5) / workingDays) * 100
            );
            avgAttendanceRate = rates.length > 0
                ? rates.reduce((a, b) => a + b, 0) / rates.length
                : 0;
        }
    }

    return { revenue, tasksCompleted, leadsConverted, avgAttendanceRate };
}

// ══════════════════════════════════════════════════════════════
//  MONTHLY TREND — last 13 months
//  BUG FIX #2: respects singleAccountId
//  BUG FIX #3: uses 3 bulk queries instead of 39 sequential queries
// ══════════════════════════════════════════════════════════════

async function getMonthlyTrend(allAccountIds: string[], singleAccountId?: string) {
    const months = getLastNMonths(13);
    const first  = months[0].start;
    const last   = months[months.length - 1].end;

    // The effective scope: one employee or all
    const scopeIds = singleAccountId ? [singleAccountId] : allAccountIds;

    // Bulk-fetch all tasks completed in the 13-month window once
    const completedTasks = await prisma.task.findMany({
        where: {
            assignments: { some: { accountId: { in: scopeIds } } },
            status:      'COMPLETED',
            completedAt: { gte: first, lte: last },
            deletedAt:   null,
        },
        select: { completedAt: true },
    });

    // Bulk-fetch all converted leads and their revenue in the window
    const convertedLeads = await prisma.lead.findMany({
        where: {
            assignments: { some: { accountId: { in: scopeIds }, isActive: true } },
            status:      'CONVERTED',
            updatedAt:   { gte: first, lte: last },
        },
        select: { updatedAt: true, cost: true },
    });

    // Bulk-fetch attendance for attendance rate trend
    const attendanceLogs = await prisma.attendanceLog.findMany({
        where: {
            accountId: { in: scopeIds },
            date:      { gte: first, lte: last },
        },
        select: { date: true, status: true },
    });

    // Bucket into months
    return months.map(({ start, end, label }) => {
        const tasksCompleted = completedTasks.filter(t =>
            t.completedAt && t.completedAt >= start && t.completedAt <= end
        ).length;

        const monthLeads = convertedLeads.filter(l =>
            l.updatedAt >= start && l.updatedAt <= end
        );
        const leadsConverted = monthLeads.length;
        const revenue        = monthLeads.reduce((s, l) => s + Number(l.cost ?? 0), 0);

        const monthLogs  = attendanceLogs.filter(l => l.date >= start && l.date <= end);
        const workingDays = getWorkingDaysBetween(start, end);
        const present    = monthLogs.filter(l => l.status === 'PRESENT').length;
        const half       = monthLogs.filter(l => l.status === 'HALF_DAY').length;
        const attendanceRate = workingDays > 0 && monthLogs.length > 0
            ? round(((present + half * 0.5) / workingDays) * 100)
            : null;

        return { month: label, tasksCompleted, leadsConverted, revenue: round(revenue), attendanceRate };
    });
}

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════

function round(n: number, decimals = 2): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

function emptyResponse(from: Date, to: Date, accountId?: string, department?: string) {
    return {
        dateRange: { from, to },
        filters:   { accountId: accountId ?? null, department: department ?? null },
        summary: {
            totalEmployees: 0,
            averagePerformanceScore: 0,
            totalRevenue: 0,
            totalWorkHours: 0,
            totalTasksCompleted: 0,
            totalLeadsConverted: 0,
            avgAttendanceRate: 0,
            topPerformer: null,
            performanceDistribution: {},
        },
        employees:   [],
        leaderboard: [],
        monthOverMonth: null,
        statusBreakdowns: { leads: {}, tasks: {} },
        priorityBreakdown: { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
        monthlyTrend: [],
    };
}