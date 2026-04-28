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
// ══════════════════════════════════════════════════════════════
//  TYPES & INTERFACES
// ══════════════════════════════════════════════════════════════

type LeadStatusBreakdown = Partial<
    Record<
        | 'PENDING'
        | 'IN_PROGRESS'
        | 'FOLLOW_UPS'
        | 'DEMO_DONE'
        | 'INTERESTED'
        | 'CONVERTED'
        | 'CLOSED',
        number
    >
>;

type TaskStatusBreakdown = Partial<
    Record<
        'PENDING' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED',
        number
    >
>;

type PriorityBreakdown = Record<'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT', number>;

type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'D' | 'F';

// ══════════════════════════════════════════════════════════════
//  INTERFACES
// ══════════════════════════════════════════════════════════════

interface AttendanceMetrics {
    workingDays: number;
    presentDays: number;
    halfDays: number;
    absentDays: number;
    wfhDays: number;
    lateDays: number;
    attendanceRate: number;
    totalWorkHours: number;
    avgDailyHours: number;
}

interface LeadMetrics {
    totalAssigned: number;
    statusBreakdown: LeadStatusBreakdown;
    converted: number;
    conversionRate: number;
    followUpCompletionRate: number;
    revenue: number;
    revenuePerHour: number;
    workHours: number;
    avgHoursPerLead: number;
    // demoCount removed — demo tracking belongs on the lead record, not a derived metric
    // demoConversionRate removed — leads can convert without a demo, the ratio is misleading
}

interface TaskMetrics {
    totalAssigned: number;
    statusBreakdown: TaskStatusBreakdown;
    completed: number;
    pending: number;
    overdue: number;
    completedOnTime: number;
    onTimeRate: number;
    completionRate: number;
    estimatedHours: number;
    loggedHours: number;
    timeAccuracy: number;
    checklistCompletionRate: number;
    priorityBreakdown: PriorityBreakdown;
    avgCompletionTime: number;
}

interface ProductivityMetrics {
    // Only attendance hours — lead work hours and task logged hours are already
    // broken out in their own sections; summing all three would triple-count time.
    attendanceWorkHours: number;
    score: number;
    grade: Grade;
    revenueGenerated: number;
    tasksPerDay: number;
    leadsPerDay: number;
}

interface EmployeeDetailedMetrics {
    accountId: string;
    name: string;
    avatar: string | null;
    designation: string;
    contactEmail: string;
    contactPhone: string;
    joinedAt: Date | null;
    jobType: string | null;
    currentStatus: { isBusy: boolean; isAvailable: boolean };
    attendance: AttendanceMetrics;
    leads: LeadMetrics;
    tasks: TaskMetrics;
    productivity: ProductivityMetrics;
    performanceScore: number;
    riskFactors: string[];
    recommendations: string[];
}

interface MonthlyTrendPoint {
    month: string;
    tasksCompleted: number;
    leadsConverted: number;
    revenue: number;
    attendanceRate: number | null;
    workHours: number;
}

interface LeaderboardEntry {
    accountId: string;
    name: string;
    designation: string;
    avatar: string | null;
    performanceScore: number;
    grade: Grade;
    tasksCompleted: number;
    revenue: number;
    attendanceRate: number;
    conversionRate: number;
}

interface CompanyWideSummary {
    totalEmployees: number;
    averagePerformanceScore: number;
    totalRevenue: number;
    totalWorkHours: number;
    totalTasksCompleted: number;
    totalLeadsConverted: number;
    avgAttendanceRate: number;
    topPerformer: LeaderboardEntry | null;
    performanceDistribution: Record<Grade, number>;
    totalLeads: number;
    overallConversionRate: number;
}

interface MonthOverMonth {
    revenueGrowth: number | null;
    tasksCompletedGrowth: number | null;
    leadsConvertedGrowth: number | null;
    attendanceRateChange: number | null;
    workHoursGrowth: number | null;
}

interface AnalyticsResponse {
    dateRange: { from: Date; to: Date };
    filters: {
        accountId: string | null;
        department: string | null;
        excludeSaturday: boolean;
        minPerformanceScore: number | null;
    };
    summary: CompanyWideSummary;
    employees: EmployeeDetailedMetrics[];
    leaderboard: LeaderboardEntry[];
    monthOverMonth: MonthOverMonth | null;
    statusBreakdowns: {
        leads: LeadStatusBreakdown;
        tasks: TaskStatusBreakdown;
    };
    priorityBreakdown: PriorityBreakdown;
    monthlyTrend: MonthlyTrendPoint[];
    departmentBreakdown: Record<string, CompanyWideSummary>;
    riskAnalysis: {
        lowPerformers: LeaderboardEntry[];
        highAbsenteeism: Array<{ accountId: string; name: string; attendanceRate: number }>;
        overdueTasks: Array<{ accountId: string; name: string; count: number }>;
        lowConversion: Array<{ accountId: string; name: string; rate: number }>;
    };
    insights: string[];
}

// ══════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════

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

function momGrowth(current: number, previous: number): number | null {
    if (previous === 0) return current > 0 ? 100 : null;
    return +((((current - previous) / Math.abs(previous)) * 100).toFixed(2));
}

function previousPeriod(from: Date, to: Date): { prevStart: Date; prevEnd: Date } {
    const ms = to.getTime() - from.getTime();
    const prevEnd = new Date(from.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - ms);
    prevStart.setHours(0, 0, 0, 0);
    prevEnd.setHours(23, 59, 59, 999);
    return { prevStart, prevEnd };
}

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

function round(n: number, decimals = 2): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

function sendSuccess(res: Response, data: unknown) {
    res.status(200).json(data);
}

function sendError(res: Response, code: number, message: string) {
    res.status(code).json({ error: message });
}

// ══════════════════════════════════════════════════════════════
//  MODULE 1 — ATTENDANCE
// ══════════════════════════════════════════════════════════════

/**
 * Fetches and computes all attendance-related metrics for one employee.
 *
 * Working days are calendar-based (Mon–Fri, optionally excl. Sat).
 * lateDays = first check-in after 10:00 AM.
 * attendanceRate = (present + 0.5 * halfDays) / workingDays * 100.
 */
async function computeAttendanceMetrics(
    accountId: string,
    from: Date,
    to: Date,
    excludeSat: boolean
): Promise<AttendanceMetrics> {
    const logs = await prisma.attendanceLog.findMany({
        where: { accountId, date: { gte: from, lte: to } },
    });

    const present = logs.filter((l) => l.status === 'PRESENT').length;
    const half = logs.filter((l) => l.status === 'HALF_DAY').length;
    const absent = logs.filter((l) => l.status === 'ABSENT').length;
    const wfh = logs.filter((l) => l.isWFH).length;

    // Late = first check-in strictly after 10:00 AM
    const late = logs.filter((l) => {
        if (!l.firstCheckIn) return false;
        const h = l.firstCheckIn.getHours();
        const m = l.firstCheckIn.getMinutes();
        return h > 10 || (h === 10 && m > 0);
    }).length;

    const totalWorkMinutes = logs.reduce((s, l) => s + (l.totalWorkMinutes ?? 0), 0);
    const totalWorkHours = totalWorkMinutes / 60;

    const workingDays = getWorkingDaysBetween(from, to, excludeSat);
    const attendanceRate = workingDays > 0 ? ((present + half * 0.5) / workingDays) * 100 : 0;

    return {
        workingDays,
        presentDays: present,
        halfDays: half,
        absentDays: absent,
        wfhDays: wfh,
        lateDays: late,
        attendanceRate: round(attendanceRate),
        totalWorkHours: round(totalWorkHours),
        // avgDailyHours only counts days the employee actually came in
        avgDailyHours: present > 0 ? round(totalWorkHours / present) : 0,
    };
}

// ══════════════════════════════════════════════════════════════
//  MODULE 2 — LEADS
// ══════════════════════════════════════════════════════════════

/**
 * Fetches and computes all lead-related metrics for one employee.
 *
 * A lead is "in scope" when:
 *   - its active assignment was created on or before `to`  (employee was assigned)
 *   - the lead itself was last updated within [from, to]   (there was activity in the window)
 *   - isActive = true
 *
 * This is stricter than the original which used `updatedAt` only — a lead
 * assigned months ago but untouched in the window won't pollute the numbers.
 *
 * workHours = sum of totalWorkSeconds logged against the lead (converted to hours).
 * revenue   = sum of `cost` for CONVERTED leads only.
 * revenuePerHour = revenue / leadWorkHours (0 when no time logged).
 */
async function computeLeadMetrics(
    accountId: string,
    from: Date,
    to: Date
): Promise<LeadMetrics> {
    const leads = await prisma.lead.findMany({
        where: {
            isActive: true,
            assignments: {
                some: {
                    accountId,
                    isActive: true,
                    assignedAt: { lte: to },   // was assigned before/during the window
                },
            },
            OR: [
                { createdAt: { gte: from, lte: to } },
                { closedAt: { gte: from, lte: to } },
            ]
        },
        include: {
            // Only follow-ups scheduled within the window
            followUps: {
                where: { scheduledAt: { gte: from, lte: to } },
                select: { status: true },
            },
            assignments: {
                where: {
                    accountId,
                },
                select: {
                    WorkSeconds: true,
                    assignedAt: true,
                    unassignedAt: true,
                }
            }
        },
    });

    const toNumber = (val: Prisma.Decimal | null | undefined) =>
        val ? Number(val.toString()) : 0;

    const statusBreakdown: LeadStatusBreakdown = {};
    let converted = 0;
    let revenue = 0;
    let leadWorkSec = 0;
    let followUpDone = 0;
    let followUpTotal = 0;

    for (const lead of leads) {
        const s = lead.status as keyof LeadStatusBreakdown;
        statusBreakdown[s] = (statusBreakdown[s] ?? 0) + 1;

        if (
            lead.status === "CONVERTED" &&
            lead.closedAt &&
            lead.closedAt >= from &&
            lead.closedAt <= to
        ) {
            converted++;
            revenue += toNumber(lead.cost);
        }

        for (const a of lead.assignments ?? []) {
            if (!a.assignedAt) continue;

            const overlapStart = Math.max(a.assignedAt.getTime(), from.getTime());
            const overlapEnd = Math.min(
                (a.unassignedAt ?? to).getTime(),
                to.getTime()
            );

            if (overlapStart < overlapEnd) {
                leadWorkSec += a.WorkSeconds ?? 0;
            }
        }
        followUpTotal += lead.followUps.length;
        followUpDone += lead.followUps.filter((f) => f.status === 'DONE').length;
    }

    const totalAssigned = leads.length;
    const leadWorkHours = leadWorkSec / 3600;
    const conversionRate = totalAssigned > 0 ? (converted / totalAssigned) * 100 : 0;
    const followUpRate = followUpTotal > 0 ? (followUpDone / followUpTotal) * 100 : 0;
    const revenuePerHour = leadWorkHours > 0 ? revenue / leadWorkHours : 0;

    return {
        totalAssigned,
        statusBreakdown,
        converted,
        conversionRate: round(conversionRate),
        followUpCompletionRate: round(followUpRate),
        revenue: round(revenue),
        revenuePerHour: round(revenuePerHour),
        workHours: round(leadWorkHours),
        avgHoursPerLead: totalAssigned > 0 ? round(leadWorkHours / totalAssigned) : 0,
    };
}

// ══════════════════════════════════════════════════════════════
//  MODULE 3 — TASKS
// ══════════════════════════════════════════════════════════════

/**
 * Fetches and computes all task-related metrics for one employee.
 *
 * Scope: tasks assigned to the employee that were either
 *   - created in the window, OR
 *   - completed in the window.
 * We intentionally exclude the broad `updatedAt` filter from the original
 * because a task updated merely by a comment edit would skew totals.
 *
 * overdue    = not COMPLETED / CANCELLED, dueDate is in the past right now.
 * onTimeRate = completedOnTime / completed (not totalTasks, avoids division by
 *              incomplete tasks dragging the rate down unfairly).
 * timeAccuracy is capped at 200 % for display but raw value drives the score.
 * loggedHours = sum of loggedMinutes on the task record (pre-aggregated by DB).
 */
async function computeTaskMetrics(
    accountId: string,
    from: Date,
    to: Date
): Promise<TaskMetrics> {
    const tasks = await prisma.task.findMany({
        where: {
            deletedAt: null,
            assignments: { some: { accountId } },
            OR: [
                { createdAt: { gte: from, lte: to } },
                { completedAt: { gte: from, lte: to } },
            ],
        },
        include: {
            checklist: true,
        },
    });

    const statusBreakdown: TaskStatusBreakdown = {
        PENDING: 0,
        IN_PROGRESS: 0,
        IN_REVIEW: 0,
        BLOCKED: 0,
        COMPLETED: 0,
        CANCELLED: 0,
    };
    const priorityBreakdown: PriorityBreakdown = {
        NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0,
    };

    let completed = 0;
    let overdue = 0;
    let completedOnTime = 0;
    let estimatedMin = 0;
    let loggedMin = 0;
    let totalCompletionMs = 0;
    const now = new Date();

    for (const task of tasks) {
        // Status & priority tallies
        const st = task.status as keyof TaskStatusBreakdown;
        if (st in statusBreakdown) statusBreakdown[st] = (statusBreakdown[st] ?? 0) + 1;

        const pr = task.priority as keyof PriorityBreakdown;
        if (pr in priorityBreakdown) priorityBreakdown[pr]++;

        // Completion metrics
        if (task.status === 'COMPLETED') {
            completed++;
            if (task.dueDate && task.completedAt) {
                if (new Date(task.completedAt) <= new Date(task.dueDate)) completedOnTime++;
                totalCompletionMs += task.completedAt.getTime() - task.createdAt.getTime();
            }
        }

        // Overdue = active task whose due date has already passed
        if (
            task.status !== 'COMPLETED' &&
            task.status !== 'CANCELLED' &&
            task.dueDate &&
            new Date(task.dueDate) < now
        ) {
            overdue++;
        }

        // Time tracking (use pre-aggregated field on the task — no extra query)
        estimatedMin += task.estimatedMinutes ?? 0;
        loggedMin += task.loggedMinutes ?? 0;
    }

    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? (completed / totalTasks) * 100 : 0;
    const onTimeRate = completed > 0 ? (completedOnTime / completed) * 100 : 0;
    const estimatedHours = estimatedMin / 60;
    const loggedHours = loggedMin / 60;
    const avgCompletionTime = completed > 0 ? totalCompletionMs / completed / (1000 * 60 * 60) : 0;

    // rawTimeAccuracy > 100 % means over-logged (more time than estimated)
    const rawTimeAccuracy = estimatedHours > 0 ? (loggedHours / estimatedHours) * 100 : 0;
    const cappedForDisplay = Math.min(rawTimeAccuracy, 200);

    const checklistItems = tasks.flatMap((t) => t.checklist);
    const checklistDone = checklistItems.filter((c) => c.status === 'COMPLETED').length;
    const checklistRate = checklistItems.length > 0
        ? (checklistDone / checklistItems.length) * 100
        : 0;

    return {
        totalAssigned: totalTasks,
        statusBreakdown,
        completed,
        // pending = actively not-done (PENDING + IN_PROGRESS)
        pending: (statusBreakdown.PENDING ?? 0) + (statusBreakdown.IN_PROGRESS ?? 0),
        overdue,
        completedOnTime,
        onTimeRate: round(onTimeRate),
        completionRate: round(completionRate),
        estimatedHours: round(estimatedHours),
        loggedHours: round(loggedHours),
        timeAccuracy: round(cappedForDisplay),   // display value
        checklistCompletionRate: round(checklistRate),
        priorityBreakdown,
        avgCompletionTime: round(avgCompletionTime),
    };
}

// ══════════════════════════════════════════════════════════════
//  MODULE 4 — PERFORMANCE SCORE
// ══════════════════════════════════════════════════════════════

/**
 * Weighted score (0–100) combining the five metric areas.
 *
 * timeAccuracy: perfect = 100 % (logged == estimated).
 *   Values above 100 % (over-logged) or below 50 % (under-logged) both penalise.
 *   Score contribution = 100 - |rawAccuracy - 100|, floored at 0.
 */
function computePerformanceScore(
    conversionRate: number,
    completionRate: number,
    attendanceRate: number,
    rawTimeAccuracy: number,  // UN-capped value for scoring
    checklistRate: number,
    followUpRate: number
): number {
    const WEIGHTS = {
        conversion: 0.35,
        tasks: 0.30,
        attendance: 0.15,
        timeAccuracy: 0.10,
        checklist: 0.05,
        followUp: 0.05,
    } as const;

    // Time accuracy score: 100 when logged == estimated, degrades symmetrically
    const timeAccuracyScore = Math.max(0, 100 - Math.abs(rawTimeAccuracy - 100));

    return round(
        conversionRate * WEIGHTS.conversion +
        completionRate * WEIGHTS.tasks +
        attendanceRate * WEIGHTS.attendance +
        timeAccuracyScore * WEIGHTS.timeAccuracy +
        checklistRate * WEIGHTS.checklist +
        followUpRate * WEIGHTS.followUp,
        2
    );
}

// ══════════════════════════════════════════════════════════════
//  MODULE 5 — RISK FACTORS & RECOMMENDATIONS
// ══════════════════════════════════════════════════════════════

function computeRiskAndRecommendations(
    attendance: AttendanceMetrics,
    leads: LeadMetrics,
    tasks: TaskMetrics,
    performanceScore: number
): { riskFactors: string[]; recommendations: string[] } {
    const riskFactors: string[] = [];
    const recommendations: string[] = [];

    if (attendance.attendanceRate < 75) {
        riskFactors.push('Low attendance rate');
        recommendations.push('Review attendance with employee');
    }
    if (leads.conversionRate < 20) {
        riskFactors.push('Low lead conversion rate');
        recommendations.push('Provide sales training or mentoring');
    }
    if (tasks.overdue > 0) {
        riskFactors.push(`${tasks.overdue} overdue task${tasks.overdue > 1 ? 's' : ''}`);
        recommendations.push('Prioritize task completion and deadline management');
    }
    if (tasks.completionRate < 70) {
        riskFactors.push('Low task completion rate');
        recommendations.push('Assist with task prioritization and workload management');
    }

    // Raw time accuracy: flag both extremes (under-estimated AND over-logged)
    const rawAcc = tasks.estimatedHours > 0
        ? (tasks.loggedHours / tasks.estimatedHours) * 100
        : 0;
    if (rawAcc > 0 && (rawAcc < 50 || rawAcc > 150)) {
        recommendations.push('Review time estimation process');
    }

    if (performanceScore < 60) {
        recommendations.push('Schedule performance review meeting');
    }

    return { riskFactors, recommendations };
}

// ══════════════════════════════════════════════════════════════
//  MAIN PER-EMPLOYEE ORCHESTRATOR
// ══════════════════════════════════════════════════════════════

/**
 * Calls each module in parallel (attendance + leads + tasks simultaneously)
 * and combines results. This halves DB round-trips versus the original sequential approach.
 */
async function getEmployeeMetrics(
    emp: {
        id: string;
        firstName: string;
        lastName: string;
        avatar: string | null;
        designation: string | null;
        contactEmail: string;
        contactPhone: string;
        joinedAt: Date | null;
        jobType: string | null;
        isBusy: boolean;
        isAvailable: boolean;
    },
    from: Date,
    to: Date,
    excludeSat: boolean
): Promise<EmployeeDetailedMetrics> {
    // Run all three DB-heavy modules in parallel
    const [attendance, leads, tasks] = await Promise.all([
        computeAttendanceMetrics(emp.id, from, to, excludeSat),
        computeLeadMetrics(emp.id, from, to),
        computeTaskMetrics(emp.id, from, to),
    ]);

    // Raw (uncapped) time accuracy needed for the score formula
    const rawTimeAccuracy = tasks.estimatedHours > 0
        ? (tasks.loggedHours / tasks.estimatedHours) * 100
        : 0;

    const performanceScore = computePerformanceScore(
        leads.conversionRate,
        tasks.completionRate,
        attendance.attendanceRate,
        rawTimeAccuracy,
        tasks.checklistCompletionRate,
        leads.followUpCompletionRate
    );

    const grade = scoreToGrade(performanceScore);

    const { riskFactors, recommendations } = computeRiskAndRecommendations(
        attendance, leads, tasks, performanceScore
    );

    return {
        accountId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        avatar: emp.avatar,
        designation: emp.designation ?? 'Not Specified',
        contactEmail: emp.contactEmail,
        contactPhone: emp.contactPhone,
        joinedAt: emp.joinedAt,
        jobType: emp.jobType,
        currentStatus: { isBusy: emp.isBusy, isAvailable: emp.isAvailable },

        attendance,
        leads,
        tasks,

        productivity: {
            // Only attendance clock hours — avoids triple-counting with leads.workHours
            // and tasks.loggedHours which are already surfaced in their own sections.
            attendanceWorkHours: attendance.totalWorkHours,
            score: performanceScore,
            grade,
            revenueGenerated: leads.revenue,
            tasksPerDay: attendance.workingDays > 0
                ? round(tasks.completed / attendance.workingDays)
                : 0,
            leadsPerDay: attendance.workingDays > 0
                ? round(leads.totalAssigned / attendance.workingDays)
                : 0,
        },

        performanceScore,
        riskFactors,
        recommendations,
    };
}

// ══════════════════════════════════════════════════════════════
//  AGGREGATE HELPERS (unchanged logic, same correctness fixes)
// ══════════════════════════════════════════════════════════════

async function getAggregateMetrics(
    ids: string[],
    from: Date,
    to: Date,
    excludeSat = false
) {
    if (ids.length === 0) {
        return { revenue: 0, tasksCompleted: 0, leadsConverted: 0, avgAttendanceRate: null, workHours: 0 };
    }

    const [leads, tasksCompleted, attendanceLogs] = await Promise.all([
        prisma.lead.findMany({
            where: {
                isActive: true,
                assignments: { some: { accountId: { in: ids }, isActive: true, assignedAt: { lte: to } } },
                status: 'CONVERTED',
                updatedAt: { gte: from, lte: to },
            },
            select: { cost: true },
        }),
        prisma.task.count({
            where: {
                assignments: { some: { accountId: { in: ids } } },
                status: 'COMPLETED',
                completedAt: { gte: from, lte: to },
                deletedAt: null,
            },
        }),
        prisma.attendanceLog.findMany({
            where: { accountId: { in: ids }, date: { gte: from, lte: to } },
            select: { accountId: true, status: true, totalWorkMinutes: true },
        }),
    ]);

    const revenue = leads.reduce((s, l) => s + Number(l.cost ?? 0), 0);
    const leadsConverted = leads.length;

    let avgAttendanceRate: number | null = null;
    if (attendanceLogs.length > 0) {
        const workingDays = getWorkingDaysBetween(from, to, excludeSat);
        if (workingDays > 0) {
            const byEmp = new Map<string, { present: number; half: number }>();
            for (const log of attendanceLogs) {
                if (!byEmp.has(log.accountId)) byEmp.set(log.accountId, { present: 0, half: 0 });
                const r = byEmp.get(log.accountId)!;
                if (log.status === 'PRESENT') r.present++;
                if (log.status === 'HALF_DAY') r.half++;
            }
            const rates = [...byEmp.values()].map((r) => ((r.present + r.half * 0.5) / workingDays) * 100);
            avgAttendanceRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
        }
    }

    // workHours from attendance logs (clock hours — consistent with productivity.attendanceWorkHours)
    const workHours = attendanceLogs.reduce((s, l) => s + (l.totalWorkMinutes ?? 0), 0) / 60;

    return { revenue, tasksCompleted, leadsConverted, avgAttendanceRate, workHours };
}

async function getMonthlyTrend(
    allAccountIds: string[],
    singleAccountId?: string
): Promise<MonthlyTrendPoint[]> {
    const months = getLastNMonths(13);
    const first = months[0].start;
    const last = months[months.length - 1].end;
    const scopeIds = singleAccountId ? [singleAccountId] : allAccountIds;

    const [completedTasks, convertedLeads, attendanceLogs, attendanceSummaries] = await Promise.all([
        prisma.task.findMany({
            where: {
                assignments: { some: { accountId: { in: scopeIds } } },
                status: 'COMPLETED',
                completedAt: { gte: first, lte: last },
                deletedAt: null,
            },
            select: { completedAt: true },
        }),
        prisma.lead.findMany({
            where: {
                isActive: true,
                assignments: { some: { accountId: { in: scopeIds }, isActive: true } },
                status: 'CONVERTED',
                updatedAt: { gte: first, lte: last },
            },
            select: { updatedAt: true, cost: true },
        }),
        prisma.attendanceLog.findMany({
            where: { accountId: { in: scopeIds }, date: { gte: first, lte: last } },
            select: { date: true, status: true, totalWorkMinutes: true },
        }),
        // Separate query to get work hours from attendance minutes
        prisma.attendanceLog.findMany({
            where: { accountId: { in: scopeIds }, date: { gte: first, lte: last } },
            select: { date: true, totalWorkMinutes: true },
        }),
    ]);

    return months.map(({ start, end, label }) => {
        const tasksCompleted = completedTasks.filter(
            (t) => t.completedAt && t.completedAt >= start && t.completedAt <= end
        ).length;

        const monthLeads = convertedLeads.filter((l) => l.updatedAt >= start && l.updatedAt <= end);
        const leadsConverted = monthLeads.length;
        const revenue = monthLeads.reduce((s, l) => s + Number(l.cost ?? 0), 0);

        const monthLogs = attendanceLogs.filter((l) => l.date >= start && l.date <= end);
        const workingDays = getWorkingDaysBetween(start, end);
        const present = monthLogs.filter((l) => l.status === 'PRESENT').length;
        const half = monthLogs.filter((l) => l.status === 'HALF_DAY').length;
        const attendanceRate =
            workingDays > 0 && monthLogs.length > 0
                ? round(((present + half * 0.5) / workingDays) * 100)
                : null;

        const workHours = attendanceSummaries
            .filter((l) => l.date >= start && l.date <= end)
            .reduce((s, l) => s + (l.totalWorkMinutes ?? 0), 0) / 60;

        return {
            month: label,
            tasksCompleted,
            leadsConverted,
            revenue: round(revenue),
            attendanceRate,
            workHours: round(workHours),
        };
    });
}

// ══════════════════════════════════════════════════════════════
//  SUMMARY HELPERS
// ══════════════════════════════════════════════════════════════

function groupByDepartment(
    employees: EmployeeDetailedMetrics[]
): Record<string, EmployeeDetailedMetrics[]> {
    const grouped: Record<string, EmployeeDetailedMetrics[]> = {};
    for (const emp of employees) {
        const dept = emp.designation || 'Unassigned';
        if (!grouped[dept]) grouped[dept] = [];
        grouped[dept].push(emp);
    }
    return grouped;
}

function computeDepartmentSummary(employees: EmployeeDetailedMetrics[]): CompanyWideSummary {
    const totalEmployees = employees.length;
    const totalRevenue = employees.reduce((s, e) => s + e.leads.revenue, 0);
    const totalWorkHours = employees.reduce((s, e) => s + e.attendance.totalWorkHours, 0);
    const totalTasksCompleted = employees.reduce((s, e) => s + e.tasks.completed, 0);
    const totalLeads = employees.reduce((s, e) => s + e.leads.totalAssigned, 0);
    const totalLeadsConverted = employees.reduce((s, e) => s + e.leads.converted, 0);

    const avgPerformance = totalEmployees > 0
        ? employees.reduce((s, e) => s + e.performanceScore, 0) / totalEmployees
        : 0;
    const avgAttendanceRate = totalEmployees > 0
        ? employees.reduce((s, e) => s + e.attendance.attendanceRate, 0) / totalEmployees
        : 0;

    const allGrades: Grade[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];
    const performanceDistribution = allGrades.reduce<Record<Grade, number>>((acc, g) => {
        acc[g] = employees.filter((e) => e.productivity.grade === g).length;
        return acc;
    }, {} as Record<Grade, number>);

    // Use spread to avoid mutating the original array (was a bug in generateInsights too)
    const topEntry = [...employees].sort((a, b) => b.performanceScore - a.performanceScore)[0];
    const topPerformer: LeaderboardEntry | null = topEntry
        ? {
            accountId: topEntry.accountId,
            name: topEntry.name,
            designation: topEntry.designation,
            avatar: topEntry.avatar,
            performanceScore: topEntry.performanceScore,
            grade: topEntry.productivity.grade,
            tasksCompleted: topEntry.tasks.completed,
            revenue: topEntry.leads.revenue,
            attendanceRate: topEntry.attendance.attendanceRate,
            conversionRate: topEntry.leads.conversionRate,
        }
        : null;

    return {
        totalEmployees,
        averagePerformanceScore: round(avgPerformance),
        totalRevenue: round(totalRevenue),
        totalWorkHours: round(totalWorkHours),
        totalTasksCompleted,
        totalLeadsConverted,
        avgAttendanceRate: round(avgAttendanceRate),
        topPerformer,
        performanceDistribution,
        totalLeads,
        overallConversionRate: round(totalLeads > 0 ? (totalLeadsConverted / totalLeads) * 100 : 0),
    };
}

function generateInsights(
    employees: EmployeeDetailedMetrics[],
    summary: CompanyWideSummary,
    monthOverMonth: MonthOverMonth | null
): string[] {
    const insights: string[] = [];

    if (summary.averagePerformanceScore >= 80) {
        insights.push('🎯 Team performance is excellent with average score above 80');
    } else if (summary.averagePerformanceScore < 60) {
        insights.push('⚠️ Team performance needs improvement. Consider team training');
    }

    if (summary.avgAttendanceRate >= 95) {
        insights.push('✓ Excellent attendance rate across the team');
    } else if (summary.avgAttendanceRate < 80) {
        insights.push('⚠️ Attendance rate is below acceptable levels');
    }

    if (monthOverMonth?.revenueGrowth != null) {
        if (monthOverMonth.revenueGrowth > 10) {
            insights.push(`📈 Strong revenue growth of ${monthOverMonth.revenueGrowth}% MoM`);
        } else if (monthOverMonth.revenueGrowth < -10) {
            insights.push(`📉 Revenue declined by ${Math.abs(monthOverMonth.revenueGrowth)}% MoM`);
        }
    }

    if (summary.overallConversionRate >= 25) {
        insights.push('💰 Strong lead conversion rate indicates effective sales team');
    } else if (summary.overallConversionRate < 15) {
        insights.push('🔄 Low conversion rate - consider sales training or process review');
    }

    const avgTaskCompletion =
        employees.length > 0
            ? employees.reduce((s, e) => s + e.tasks.completionRate, 0) / employees.length
            : 0;
    if (avgTaskCompletion >= 80) {
        insights.push('✓ High task completion rate indicates good project execution');
    }

    // Use spread — do NOT mutate the original array
    const topPerformer = [...employees].sort((a, b) => b.performanceScore - a.performanceScore)[0];
    if (topPerformer) {
        insights.push(
            `⭐ ${topPerformer.name} is the top performer with grade ${topPerformer.productivity.grade}`
        );
    }

    return insights;
}

// ══════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ══════════════════════════════════════════════════════════════

export async function getEmployeeAnalyticsV3(req: Request, res: Response): Promise<void> {
    try {
        // ── 1. Auth ──────────────────────────────────────────
        if (!req.user?.roles?.includes?.('ADMIN')) {
            return sendError(res, 403, 'Admin access required');
        }

        // ── 2. Parse + validate params ────────────────────────
        const rawFrom = req.query.fromDate as string | undefined;
        const rawTo = req.query.toDate as string | undefined;
        const accountId = req.query.accountId as string | undefined;
        const department = req.query.department as string | undefined;
        const excludeSat = req.query.excludeSaturday === 'true';
        const minScore = req.query.minPerformanceScore
            ? parseFloat(req.query.minPerformanceScore as string)
            : null;

        const fromDate = new Date(
            rawFrom ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
        );
        const toDate = new Date(rawTo ?? new Date().toISOString());
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
                ...(accountId && { id: accountId }),
                ...(department && { designation: department }),
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
            return sendSuccess(
                res,
                getEmptyResponse(fromDate, toDate, accountId, department, minScore, excludeSat)
            );
        }

        const accountIds = employees.map((e) => e.id);

        // ── 5. Per-employee detail — all three modules run in parallel per employee
        const detailed = await Promise.all(
            employees.map((emp) => getEmployeeMetrics(emp, fromDate, toDate, excludeSat))
        );

        const filtered = minScore !== null
            ? detailed.filter((e) => e.performanceScore >= minScore)
            : detailed;

        // ── 6. Company-wide summary ───────────────────────────
        const summary = computeDepartmentSummary(filtered);

        // ── 7. Aggregated status / priority breakdowns ────────
        const leadStatusBreakdown: LeadStatusBreakdown = {};
        const taskStatusBreakdown: TaskStatusBreakdown = {};
        const priorityBreakdown: PriorityBreakdown = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };

        for (const e of filtered) {
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
        const leaderboard: LeaderboardEntry[] = [...filtered]
            .sort((a, b) => b.performanceScore - a.performanceScore)
            .map((e) => ({
                accountId: e.accountId,
                name: e.name,
                designation: e.designation,
                avatar: e.avatar,
                performanceScore: e.performanceScore,
                grade: e.productivity.grade,
                tasksCompleted: e.tasks.completed,
                revenue: e.leads.revenue,
                attendanceRate: e.attendance.attendanceRate,
                conversionRate: e.leads.conversionRate,
            }));

        // ── 9. MoM growth (pass excludeSat so working days match) ──
        const prev = await getAggregateMetrics(accountIds, prevStart, prevEnd, excludeSat);
        const monthOverMonth: MonthOverMonth = {
            revenueGrowth: momGrowth(summary.totalRevenue, prev.revenue),
            tasksCompletedGrowth: momGrowth(summary.totalTasksCompleted, prev.tasksCompleted),
            leadsConvertedGrowth: momGrowth(summary.totalLeadsConverted, prev.leadsConverted),
            attendanceRateChange: prev.avgAttendanceRate !== null
                ? +(summary.avgAttendanceRate - prev.avgAttendanceRate).toFixed(2)
                : null,
            workHoursGrowth: momGrowth(summary.totalWorkHours, prev.workHours),
        };

        // ── 10. Monthly trend (last 13 months) ────────────────
        const monthlyTrend = await getMonthlyTrend(
            accountIds,
            filtered.length === 1 ? filtered[0].accountId : undefined
        );

        // ── 11. Department breakdown ──────────────────────────
        const deptGrouped = groupByDepartment(filtered);
        const departmentBreakdown: Record<string, CompanyWideSummary> = {};
        for (const [dept, emps] of Object.entries(deptGrouped)) {
            departmentBreakdown[dept] = computeDepartmentSummary(emps);
        }

        // ── 12. Risk Analysis ─────────────────────────────────
        const riskAnalysis = {
            lowPerformers: leaderboard.filter((e) => e.performanceScore < 60).slice(0, 5),
            highAbsenteeism: filtered
                .filter((e) => e.attendance.attendanceRate < 75)
                .map((e) => ({ accountId: e.accountId, name: e.name, attendanceRate: e.attendance.attendanceRate }))
                .slice(0, 5),
            overdueTasks: filtered
                .filter((e) => e.tasks.overdue > 0)
                .map((e) => ({ accountId: e.accountId, name: e.name, count: e.tasks.overdue }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5),
            lowConversion: leaderboard
                .filter((e) => e.conversionRate < 15)
                .map((e) => ({ accountId: e.accountId, name: e.name, rate: e.conversionRate }))
                .slice(0, 5),
        };

        // ── 13. Insights ──────────────────────────────────────
        const insights = generateInsights(filtered, summary, monthOverMonth);

        // ── 14. Final response ────────────────────────────────
        const response: AnalyticsResponse = {
            dateRange: { from: fromDate, to: toDate },
            filters: {
                accountId: accountId ?? null,
                department: department ?? null,
                excludeSaturday: excludeSat,
                minPerformanceScore: minScore,
            },
            summary,
            employees: filtered,
            leaderboard,
            monthOverMonth,
            statusBreakdowns: { leads: leadStatusBreakdown, tasks: taskStatusBreakdown },
            priorityBreakdown,
            monthlyTrend,
            departmentBreakdown,
            riskAnalysis,
            insights,
        };

        return sendSuccess(res, response);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        console.error('[EmployeeAnalyticsV3]', err);
        return sendError(res, 500, message);
    }
}

// ══════════════════════════════════════════════════════════════
//  EMPTY RESPONSE HELPER
// ══════════════════════════════════════════════════════════════

function getEmptyResponse(
    from: Date,
    to: Date,
    accountId?: string,
    department?: string,
    minScore?: number | null,
    excludeSaturday = false
): AnalyticsResponse {
    const allGrades: Grade[] = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];
    return {
        dateRange: { from, to },
        filters: {
            accountId: accountId ?? null,
            department: department ?? null,
            excludeSaturday,
            minPerformanceScore: minScore ?? null,
        },
        summary: {
            totalEmployees: 0,
            averagePerformanceScore: 0,
            totalRevenue: 0,
            totalWorkHours: 0,
            totalTasksCompleted: 0,
            totalLeadsConverted: 0,
            avgAttendanceRate: 0,
            topPerformer: null,
            performanceDistribution: allGrades.reduce<Record<Grade, number>>((a, g) => { a[g] = 0; return a; }, {} as Record<Grade, number>),
            totalLeads: 0,
            overallConversionRate: 0,
        },
        employees: [],
        leaderboard: [],
        monthOverMonth: null,
        statusBreakdowns: { leads: {}, tasks: {} },
        priorityBreakdown: { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
        monthlyTrend: [],
        departmentBreakdown: {},
        riskAnalysis: {
            lowPerformers: [],
            highAbsenteeism: [],
            overdueTasks: [],
            lowConversion: [],
        },
        insights: [],
    };
}