import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * GET /common/dashboard/stats
 * Universal stats for all roles — scopes automatically by role
 */
export async function getDashboardStats(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    const roles: string[] = req.user?.roles ?? [];
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "MANAGER", "SALES"];
    const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r.toUpperCase()));

    /* ─── Date helpers ─── */
    const now = new Date();

    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* ─── Lead scope ─── */
    const leadScope = isAdmin
      ? {}
      : {
          assignments: {
            some: { accountId, isActive: true },
          },
        };

    /* ─── Run all queries in parallel ─── */
    const [
      // Customers (admin sees all, user sees leads' customers)
      totalCustomers,
      newCustomersThisMonth,
      newCustomersLastMonth,

      // Leads
      totalLeads,
      newLeadsThisMonth,
      newLeadsLastMonth,

      // Lead status breakdown
      leadsByStatus,

      // Lead value
      leadValueGrouped,

      // Demo stats
      upcomingDemos,
      overdueDemos,

      // Conversion
      convertedLeads,
      convertedLeadsLastMonth,
    
      // ── Today's leads ──
      todayLeads,

      // Active employees (admin only meaningful, but safe for all)
      activeEmployees,

      // Today's check-ins (admin only)
      todayCheckIns,

      // Teams (admin only)
      totalTeams,
    ] = await Promise.all([
      // ── Customers ──
      isAdmin
        ? prisma.customer.count({ where: { isActive: true } })
        : prisma.customer.count({
            where: {
              isActive: true,
              leads: { some: { assignments: { some: { accountId, isActive: true } } } },
            },
          }),

      isAdmin
        ? prisma.customer.count({ where: { isActive: true, createdAt: { gte: startOfThisMonth } } })
        : prisma.customer.count({
            where: {
              isActive: true,
              createdAt: { gte: startOfThisMonth },
              leads: { some: { assignments: { some: { accountId, isActive: true } } } },
            },
          }),

      isAdmin
        ? prisma.customer.count({ where: { isActive: true, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } })
        : prisma.customer.count({
            where: {
              isActive: true,
              createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
              leads: { some: { assignments: { some: { accountId, isActive: true } } } },
            },
          }),

      // ── Leads ──
      prisma.lead.count({ where: { ...leadScope } }),

      prisma.lead.count({ where: { ...leadScope, createdAt: { gte: startOfThisMonth } } }),

      prisma.lead.count({ where: { ...leadScope, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }),

      // ── Lead status breakdown ──
      prisma.lead.groupBy({
        by: ["status"],
        where: { ...leadScope },
        _count: { _all: true },
      }),

      // ── Lead value grouped by status ──
      prisma.lead.groupBy({
        by: ["status"],
        where: { ...leadScope },
        _sum: { cost: true },
        _count: { _all: true },
      }),

      // ── Upcoming demos (next 7 days) ──
      prisma.lead.count({
        where: {
          ...leadScope,
          demoScheduledAt: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
          demoDoneAt: null,
        },
      }),

      // ── Overdue demos ──
      prisma.lead.count({
        where: {
          ...leadScope,
          demoScheduledAt: { lt: now },
          demoDoneAt: null,
        },
      }),

      // ── Converted this month ──
      prisma.lead.count({
        where: { ...leadScope, status: "CONVERTED", updatedAt: { gte: startOfThisMonth } },
      }),

      // ── Converted last month ──
      prisma.lead.count({
        where: {
          ...leadScope,
          status: "CONVERTED",
          updatedAt: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
      }),

      // ── Today's leads ──
      isAdmin
       ?
       prisma.lead.count({
        where: {
          ...leadScope,
          createdAt: { gte: startOfToday },
        },
      })
      : Promise.resolve(null)
      ,
      // ── Active employees ──
      isAdmin
        ? prisma.account.count({ where: { isActive: true } })
        : Promise.resolve(null),

      // ── Today's check-ins ──
      isAdmin
        ? prisma.checkLog.count({
            where: { type: "CHECK_IN", checkedAt: { gte: startOfToday } },
          })
        : Promise.resolve(null),

      // ── Total teams ──
      isAdmin
        ? prisma.team.count({ where: { isActive: true } })
        : Promise.resolve(null),
    ]);

    /* ─── Normalize lead status counts ─── */
    const STATUS_LIST = ["PENDING", "IN_PROGRESS", "FOLLOW_UPS", "DEMO_DONE", "INTERESTED", "CONVERTED", "CLOSED"] as const;

    const leadStatusCounts = STATUS_LIST.reduce(
      (acc, status) => {
        const row = leadsByStatus.find((r) => r.status === status);
        acc[status] = row?._count._all ?? 0;
        return acc;
      },
      {} as Record<string, number>,
    );
    leadStatusCounts["TOTAL"] = Object.values(leadStatusCounts).reduce((a, b) => a + b, 0);

    /* ─── Normalize lead value ─── */
    const leadValueByStatus = STATUS_LIST.reduce(
      (acc, status) => {
        const row = leadValueGrouped.find((r) => r.status === status);
        acc[status] = {
          totalValue: row?._sum?.cost ? Number(row._sum.cost) : 0,
          count: row?._count?._all ?? 0,
        };
        return acc;
      },
      {} as Record<string, { totalValue: number; count: number }>,
    );

    const totalLeadValue = leadValueGrouped.reduce(
      (sum, row) => sum + (row._sum?.cost ? Number(row._sum.cost) : 0),
      0,
    );

    /* ─── Growth helpers ─── */
    function growthPct(current: number, previous: number): number | null {
      if (previous === 0) return current > 0 ? 100 : null;
      return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    }

    /* ─── Build response ─── */
    const data: Record<string, any> = {
      customers: {
        total: totalCustomers,
        newThisMonth: newCustomersThisMonth,
        newLastMonth: newCustomersLastMonth,
        growth: growthPct(newCustomersThisMonth, newCustomersLastMonth),
      },
      leads: {
        total: totalLeads,
        newThisMonth: newLeadsThisMonth,
        newLastMonth: newLeadsLastMonth,
        growth: growthPct(newLeadsThisMonth, newLeadsLastMonth),
        byStatus: leadStatusCounts,
      },
      leadValue: {
        total: totalLeadValue,
        byStatus: leadValueByStatus,
      },
      demos: {
        upcoming: upcomingDemos,
        overdue: overdueDemos,
      },
      conversions: {
        thisMonth: convertedLeads,
        lastMonth: convertedLeadsLastMonth,
        growth: growthPct(convertedLeads, convertedLeadsLastMonth),
        rate: totalLeads > 0
          ? Math.round((leadStatusCounts["CONVERTED"] / totalLeads) * 100 * 10) / 10
          : 0,
      },
    };

    // Admin-only fields
    if (isAdmin) {
      data.employees = {
        total: activeEmployees,
        checkedInToday: todayCheckIns,
      };
      data.teams = {
        total: totalTeams,
      };
      data.todayLeads  = todayLeads;
    }

    return sendSuccessResponse(res, 200, "Dashboard stats fetched", data);
  } catch (err: any) {
    console.error("Dashboard stats error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch dashboard stats");
  }
}