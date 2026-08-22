// src/controller/project/projectAnalytics.controller.ts
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

async function getAccountIdFromReqUser(user: any): Promise<string | null> {
  if (!user) return null;
  if (user.accountId) return user.accountId;
  if (user.id) {
    const acc = await prisma.account.findFirst({
      where: { user: { id: user.id } },
      select: { id: true },
    });
    return acc?.id || user.id;
  }
  return null;
}

/**
 * GET /projects/analytics
 * GET /api/v1/projects/analytics
 */
export async function getProjectAnalyticsDashboard(req: Request, res: Response): Promise<any> {
  try {
    const {
      fromDate,
      toDate,
      creatorId,
      memberId,
      status,
      projectType,
      projectSource = "INHOUSE",
      priority,
      onWork,
      search,
    } = req.query;

    const user = (req as any).user;
    const accountId = await getAccountIdFromReqUser(user);
    const isAdmin = Boolean(
      user?.role === "ADMIN" ||
      user?.roles?.includes("ADMIN") ||
      user?.roles?.includes("SUPER_ADMIN") ||
      user?.isSuperAdmin
    );

    // Access control
    const accessWhere = isAdmin
      ? {}
      : {
        OR: [
          { visibility: "PUBLIC" as const },
          { visibility: "TEAM" as const },
          {
            visibility: "PRIVATE" as const,
            OR: [
              ...(accountId ? [{ createdBy: accountId }] : []),
              ...(user?.id ? [{ createdBy: user.id }] : []),
              ...(accountId ? [{ members: { some: { accountId } } }] : []),
            ],
          },
        ],
      };

    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...accessWhere,
    };

    // Project Source Filter (Default: INHOUSE, or OUTSOURCE, or ALL)
    if (projectSource && projectSource !== "ALL" && projectSource !== "all") {
      const normalizedSource = String(projectSource).toUpperCase() === "OUTSOURCE" ? "OUTSOURCE" : "INHOUSE";
      where.projectSource = normalizedSource as any;
    }

    // Status Filter
    if (status && status !== "ALL" && status !== "all") {
      where.status = String(status).toUpperCase() as any;
    }

    // Project Type Filter
    if (projectType && projectType !== "ALL" && projectType !== "all") {
      const typeStr = String(projectType).toUpperCase();
      if (typeStr === "NEW" || typeStr === "NEW_PROJECT") {
        where.projectType = "NEW_PROJECT";
      } else if (typeStr === "UPDATES" || typeStr === "UPDATE") {
        where.projectType = "UPDATES";
      }
    }

    // Priority Filter
    if (String(priority) === "true") {
      where.priority = true;
    } else if (String(priority) === "false") {
      where.priority = false;
    }

    // OnWork Filter
    if (String(onWork) === "true") {
      where.onWork = true;
    } else if (String(onWork) === "false") {
      where.onWork = false;
    }

    // Creator / Owner Filter (supports accountId or outsourceDeveloperId)
    if (creatorId && creatorId !== "ALL" && creatorId !== "all") {
      if (String(projectSource).toUpperCase() === "OUTSOURCE") {
        where.OR = [
          { outsourceDeveloperId: String(creatorId) },
          { createdBy: String(creatorId) },
        ];
      } else {
        where.createdBy = String(creatorId);
      }
    }

    // Member Filter
    if (memberId && memberId !== "ALL" && memberId !== "all") {
      where.members = {
        some: { accountId: String(memberId) },
      };
    }

    // Search Filter
    if (search) {
      where.name = { contains: String(search), mode: "insensitive" };
    }

    // Date Range Filter
    if (fromDate || toDate) {
      const from = fromDate ? new Date(fromDate as string) : undefined;
      if (from) from.setHours(0, 0, 0, 0);
      const to = toDate ? new Date(toDate as string) : undefined;
      if (to) to.setHours(23, 59, 59, 999);

      where.OR = [
        {
          createdAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        },
        {
          startDate: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        },
        {
          startedAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        },
        {
          completedAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        },
        {
          cancelledAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        },
        {
          endDate: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        },
      ];
    }

    // Fetch projects
    const projects = (await prisma.project.findMany({
      where,
      include: {
        outsourceDeveloper: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            skills: true,
          },
        },
        members: {
          select: {
            accountId: true,
            role: true,
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
                designation: true,
              },
            },
          },
        },
        lead: {
          select: {
            id: true,
            customerName: true,
            productTitle: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            customerCompanyName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })) as any[];

    // Helpers to resolve dates considering startDate, endDate, startedAt, completedAt, cancelledAt
    const getEffectiveStartDate = (p: any): Date => {
      if (p.startedAt) return new Date(p.startedAt);
      if (p.startDate) return new Date(p.startDate);
      return new Date(p.createdAt);
    };

    const getEffectiveCompletedDate = (p: any): Date | null => {
      if (p.completedAt) return new Date(p.completedAt);
      if (p.status === "COMPLETED") {
        if (p.endDate) return new Date(p.endDate);
        return new Date(p.updatedAt || p.createdAt);
      }
      return null;
    };

    const getEffectiveCancelledDate = (p: any): Date | null => {
      if (p.cancelledAt) return new Date(p.cancelledAt);
      if (p.status === "CANCELLED") {
        return new Date(p.updatedAt || p.createdAt);
      }
      return null;
    };

    // Fetch all creator Accounts to enrich creator names
    const creatorIds = Array.from(new Set(projects.map((p) => p.createdBy).filter(Boolean))) as string[];
    const creatorAccounts = creatorIds.length > 0
      ? await prisma.account.findMany({
        where: { id: { in: creatorIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
          designation: true,
          contactEmail: true,
        },
      })
      : [];

    const creatorAccountMap = new Map(creatorAccounts.map((a) => [a.id, a]));

    // Fetch all active Outsource Developers (for Outsource view leaderboard & filters)
    const allOutsourceDevs = await prisma.outsourceDeveloper.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        skills: true,
      },
    });

    // Fetch all active internal employees (for Employee breakdown)
    const allEmployees = await prisma.account.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatar: true,
        designation: true,
        contactEmail: true,
      },
    });

    // ── 1. Calculate Summary KPIs ──
    const now = new Date();
    let activeProjects = 0;
    let completedProjects = 0;
    let onHoldProjects = 0;
    let draftProjects = 0;
    let cancelledProjects = 0;
    let archivedProjects = 0;
    let priorityProjects = 0;
    let onWorkProjects = 0;
    let overdueProjects = 0;
    let inhouseCount = 0;
    let outsourceCount = 0;
    let totalCompletionDurationDays = 0;
    let completedProjectsWithDuration = 0;

    const statusBreakdown: Record<string, number> = {
      ACTIVE: 0,
      COMPLETED: 0,
      ON_HOLD: 0,
      DRAFT: 0,
      CANCELLED: 0,
      ARCHIVED: 0,
    };

    const projectTypeBreakdown: Record<string, number> = {};

    for (const p of projects) {
      if (statusBreakdown[p.status] !== undefined) {
        statusBreakdown[p.status]++;
      } else {
        statusBreakdown[p.status] = 1;
      }

      const pType = p.projectType || "UPDATES";
      projectTypeBreakdown[pType] = (projectTypeBreakdown[pType] || 0) + 1;

      if (p.projectSource === "OUTSOURCE") {
        outsourceCount++;
      } else {
        inhouseCount++;
      }

      if (p.priority) priorityProjects++;
      if (p.onWork) onWorkProjects++;

      const sDate = getEffectiveStartDate(p);
      const cDate = getEffectiveCompletedDate(p);

      if (p.status === "ACTIVE") {
        activeProjects++;
        if (p.endDate && new Date(p.endDate) < now) {
          overdueProjects++;
        }
      } else if (p.status === "COMPLETED") {
        completedProjects++;
        if (cDate && sDate) {
          const diffDays = (cDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays >= 0) {
            totalCompletionDurationDays += diffDays;
            completedProjectsWithDuration++;
          }
        }
      } else if (p.status === "ON_HOLD") {
        onHoldProjects++;
      } else if (p.status === "DRAFT") {
        draftProjects++;
      } else if (p.status === "CANCELLED") {
        cancelledProjects++;
      } else if (p.status === "ARCHIVED") {
        archivedProjects++;
      }
    }

    const totalProjects = projects.length;
    const effectiveTotal = totalProjects - draftProjects - cancelledProjects;
    const completionRate = effectiveTotal > 0 ? Math.round((completedProjects / effectiveTotal) * 100) : 0;
    const overdueRate = activeProjects > 0 ? Math.round((overdueProjects / activeProjects) * 100) : 0;
    const avgCompletionDays = completedProjectsWithDuration > 0 ? Math.round((totalCompletionDurationDays / completedProjectsWithDuration) * 10) / 10 : 0;

    // ── 2. Month-over-Month Growth Calculation ──
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    let createdThisMonth = 0;
    let createdLastMonth = 0;
    let completedThisMonth = 0;
    let completedLastMonth = 0;

    for (const p of projects) {
      const sDate = getEffectiveStartDate(p);
      if (sDate >= currentMonthStart) {
        createdThisMonth++;
      } else if (sDate >= lastMonthStart && sDate <= lastMonthEnd) {
        createdLastMonth++;
      }

      const compDate = getEffectiveCompletedDate(p);
      if (compDate) {
        if (compDate >= currentMonthStart) {
          completedThisMonth++;
        } else if (compDate >= lastMonthStart && compDate <= lastMonthEnd) {
          completedLastMonth++;
        }
      }
    }

    const momCreated = createdLastMonth > 0 ? Math.round(((createdThisMonth - createdLastMonth) / createdLastMonth) * 100) : (createdThisMonth > 0 ? 100 : 0);
    const momCompleted = completedLastMonth > 0 ? Math.round(((completedThisMonth - completedLastMonth) / completedLastMonth) * 100) : (completedThisMonth > 0 ? 100 : 0);

    // ── 3. Monthly Trends (Dynamic Range based on fromDate / toDate or 12-Month Rolling) ──
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyTrends: Array<{
      month: string;
      monthKey: string;
      created: number;
      completed: number;
      active: number;
    }> = [];

    const monthBuckets: Array<{ mYear: number; mMonth: number }> = [];

    if (fromDate && toDate) {
      const fDate = new Date(fromDate as string);
      const tDate = new Date(toDate as string);
      let curYear = fDate.getFullYear();
      let curMonth = fDate.getMonth();
      const endYear = tDate.getFullYear();
      const endMonth = tDate.getMonth();

      while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
        monthBuckets.push({ mYear: curYear, mMonth: curMonth });
        curMonth++;
        if (curMonth > 11) {
          curMonth = 0;
          curYear++;
        }
      }
    } else if (fromDate) {
      const fDate = new Date(fromDate as string);
      let curYear = fDate.getFullYear();
      let curMonth = fDate.getMonth();
      const endYear = now.getFullYear();
      const endMonth = now.getMonth();

      while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
        monthBuckets.push({ mYear: curYear, mMonth: curMonth });
        curMonth++;
        if (curMonth > 11) {
          curMonth = 0;
          curYear++;
        }
      }
    } else if (toDate) {
      const tDate = new Date(toDate as string);
      const endYear = tDate.getFullYear();
      const endMonth = tDate.getMonth();
      for (let i = 11; i >= 0; i--) {
        const mDate = new Date(endYear, endMonth - i, 1);
        monthBuckets.push({ mYear: mDate.getFullYear(), mMonth: mDate.getMonth() });
      }
    } else {
      // Default: 12-Month Rolling up to now
      for (let i = 11; i >= 0; i--) {
        const mDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthBuckets.push({ mYear: mDate.getFullYear(), mMonth: mDate.getMonth() });
      }
    }

    if (monthBuckets.length === 0) {
      monthBuckets.push({ mYear: now.getFullYear(), mMonth: now.getMonth() });
    }

    for (const { mYear, mMonth } of monthBuckets) {
      const mKey = `${mYear}-${String(mMonth + 1).padStart(2, "0")}`;
      const mLabel = `${monthNames[mMonth]} ${mYear}`;

      const mStart = new Date(mYear, mMonth, 1);
      const mEnd = new Date(mYear, mMonth + 1, 0, 23, 59, 59, 999);

      let mCreated = 0;
      let mCompleted = 0;
      let mActive = 0;

      for (const p of projects) {
        const sDate = getEffectiveStartDate(p);
        const compDate = getEffectiveCompletedDate(p);
        const cancDate = getEffectiveCancelledDate(p);

        if (sDate >= mStart && sDate <= mEnd) {
          mCreated++;
        }
        if (compDate && compDate >= mStart && compDate <= mEnd) {
          mCompleted++;
        }
        // Project was active in this month if started on/before this month end, and (completed on/after this month start OR still not completed) and not cancelled before this month start
        if (
          sDate <= mEnd &&
          (!compDate || compDate >= mStart) &&
          (!cancDate || cancDate >= mStart) &&
          p.status !== "CANCELLED" &&
          p.status !== "DRAFT"
        ) {
          mActive++;
        }
      }

      monthlyTrends.push({
        month: mLabel,
        monthKey: mKey,
        created: mCreated,
        completed: mCompleted,
        active: mActive,
      });
    }

    // ── 4. Creator / Owner Leaderboard (Adapts to Inhouse vs Outsource) ──
    const isOutsource = String(projectSource).toUpperCase() === "OUTSOURCE";

    let creatorLeaderboard: Array<any> = [];

    if (isOutsource) {
      // Outsource view: Group by OutsourceDeveloper
      const devStatsMap = new Map<string, any>();

      // Initialize all outsource developers
      for (const dev of allOutsourceDevs) {
        devStatsMap.set(dev.id, {
          id: dev.id,
          name: dev.name,
          email: dev.email,
          phone: dev.phone,
          skills: dev.skills,
          total: 0,
          active: 0,
          completed: 0,
          onHold: 0,
          priority: 0,
          onWork: 0,
        });
      }

      // Add unassigned outsource bucket
      const UNASSIGNED_ID = "unassigned_outsource";
      devStatsMap.set(UNASSIGNED_ID, {
        id: UNASSIGNED_ID,
        name: "Unassigned Developer",
        email: null,
        phone: null,
        skills: "Pending Assignment",
        total: 0,
        active: 0,
        completed: 0,
        onHold: 0,
        priority: 0,
        onWork: 0,
        newProjects: 0,
        updatesProjects: 0,
      });

      for (const p of projects) {
        const devId = p.outsourceDeveloperId || UNASSIGNED_ID;
        let stat = devStatsMap.get(devId);
        if (!stat) {
          stat = {
            id: devId,
            name: p.outsourceDeveloper?.name || "Unknown Developer",
            email: p.outsourceDeveloper?.email || null,
            phone: p.outsourceDeveloper?.phone || null,
            skills: p.outsourceDeveloper?.skills || null,
            total: 0,
            active: 0,
            completed: 0,
            onHold: 0,
            priority: 0,
            onWork: 0,
            newProjects: 0,
            updatesProjects: 0,
          };
          devStatsMap.set(devId, stat);
        }

        stat.total++;
        if (p.projectType === "NEW_PROJECT") stat.newProjects++;
        if (p.projectType === "UPDATES") stat.updatesProjects++;
        if (p.status === "ACTIVE") stat.active++;
        if (p.status === "COMPLETED") stat.completed++;
        if (p.status === "ON_HOLD") stat.onHold++;
        if (p.priority) stat.priority++;
        if (p.onWork) stat.onWork++;
      }

      creatorLeaderboard = Array.from(devStatsMap.values())
        .filter((d) => d.total > 0 || d.id !== UNASSIGNED_ID)
        .map((d) => ({
          ...d,
          completionRate: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total || b.completed - a.completed);
    } else {
      // Inhouse view: Group by CreatedBy account
      const creatorStatsMap = new Map<string, any>();

      for (const emp of allEmployees) {
        const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
        creatorStatsMap.set(emp.id, {
          id: emp.id,
          name: fullName,
          avatar: emp.avatar,
          designation: emp.designation,
          email: emp.contactEmail || null,
          total: 0,
          active: 0,
          completed: 0,
          onHold: 0,
          priority: 0,
          onWork: 0,
          newProjects: 0,
          updatesProjects: 0,
        });
      }

      for (const p of projects) {
        if (!p.createdBy) continue;
        let stat = creatorStatsMap.get(p.createdBy);
        if (!stat) {
          const acc = creatorAccountMap.get(p.createdBy);
          const name = acc ? `${acc.firstName || ""} ${acc.lastName || ""}`.trim() : "Unknown Account";
          stat = {
            id: p.createdBy,
            name,
            avatar: acc?.avatar || null,
            designation: acc?.designation || null,
            email: acc?.contactEmail || null,
            total: 0,
            active: 0,
            completed: 0,
            onHold: 0,
            priority: 0,
            onWork: 0,
            newProjects: 0,
            updatesProjects: 0,
          };
          creatorStatsMap.set(p.createdBy, stat);
        }

        stat.total++;
        if (p.projectType === "NEW_PROJECT") stat.newProjects++;
        if (p.projectType === "UPDATES") stat.updatesProjects++;
        if (p.status === "ACTIVE") stat.active++;
        if (p.status === "COMPLETED") stat.completed++;
        if (p.status === "ON_HOLD") stat.onHold++;
        if (p.priority) stat.priority++;
        if (p.onWork) stat.onWork++;
      }

      creatorLeaderboard = Array.from(creatorStatsMap.values())
        .filter((c) => c.total > 0)
        .map((c) => ({
          ...c,
          completionRate: c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total || b.completed - a.completed);
    }

    // ── 5. Employee Matrix (Projects created vs Member in) ──
    const employeeMatrixMap = new Map<string, any>();

    for (const emp of allEmployees) {
      const name = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
      employeeMatrixMap.set(emp.id, {
        id: emp.id,
        name,
        avatar: emp.avatar,
        designation: emp.designation,
        email: emp.contactEmail || null,
        createdTotal: 0,
        createdActive: 0,
        createdCompleted: 0,
        newProjects: 0,
        updatesProjects: 0,
        memberInProjects: 0,
        memberActiveProjects: 0,
        onWorkCount: 0,
      });
    }

    for (const p of projects) {
      // Creator stats
      if (p.createdBy && employeeMatrixMap.has(p.createdBy)) {
        const cStat = employeeMatrixMap.get(p.createdBy);
        cStat.createdTotal++;
        if (p.projectType === "NEW_PROJECT") cStat.newProjects++;
        if (p.projectType === "UPDATES") cStat.updatesProjects++;
        if (p.status === "ACTIVE") cStat.createdActive++;
        if (p.status === "COMPLETED") cStat.createdCompleted++;
        if (p.onWork) cStat.onWorkCount++;
      }

      // Member stats
      if (p.members) {
        for (const m of p.members) {
          if (employeeMatrixMap.has(m.accountId)) {
            const mStat = employeeMatrixMap.get(m.accountId);
            mStat.memberInProjects++;
            if (p.status === "ACTIVE") mStat.memberActiveProjects++;
          }
        }
      }
    }

    const employeeMatrix = Array.from(employeeMatrixMap.values())
      .filter((e) => e.createdTotal > 0 || e.memberInProjects > 0)
      .map((e) => ({
        ...e,
        totalInvolvement: e.createdTotal + e.memberInProjects,
        creatorCompletionRate: e.createdTotal > 0 ? Math.round((e.createdCompleted / e.createdTotal) * 100) : 0,
      }))
      .sort((a, b) => b.createdTotal - a.createdTotal || b.createdCompleted - a.createdCompleted || b.memberInProjects - a.memberInProjects);

    // ── 6. All Filtered Projects (for Explorer & Recent Milestones) ──
    const recentProjects = projects.map((p) => {
      const creatorAcc = p.createdBy ? creatorAccountMap.get(p.createdBy) : null;

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        projectType: p.projectType,
        projectSource: p.projectSource,
        priority: p.priority,
        onWork: p.onWork,
        color: p.color,
        icon: p.icon,
        startDate: p.startDate,
        endDate: p.endDate,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
        cancelledAt: p.cancelledAt,
        createdAt: p.createdAt,
        lead: p.lead ? { id: p.lead.id, customerName: p.lead.customerName, productTitle: p.lead.productTitle } : null,
        customer: p.customer ? { id: p.customer.id, name: p.customer.name, companyName: p.customer.customerCompanyName } : null,
        outsourceDeveloper: p.outsourceDeveloper,
        creator: creatorAcc
          ? {
            id: creatorAcc.id,
            name: `${creatorAcc.firstName || ""} ${creatorAcc.lastName || ""}`.trim(),
            avatar: creatorAcc.avatar,
            designation: creatorAcc.designation,
          }
          : null,
        membersCount: p.members?.length || 0,
      };
    });

    return sendSuccessResponse(res, 200, "Project analytics dashboard fetched successfully", {
      filters: {
        projectSource: isOutsource ? "OUTSOURCE" : (projectSource === "ALL" ? "ALL" : "INHOUSE"),
        status: status || "ALL",
        projectType: projectType || "ALL",
        creatorId: creatorId || "ALL",
        memberId: memberId || "ALL",
        fromDate: fromDate || null,
        toDate: toDate || null,
      },
      summary: {
        totalProjects,
        activeProjects,
        completedProjects,
        onHoldProjects,
        draftProjects,
        cancelledProjects,
        archivedProjects,
        priorityProjects,
        onWorkProjects,
        overdueProjects,
        inhouseCount,
        outsourceCount,
        completionRate,
        overdueRate,
        avgCompletionDays,
        mom: {
          created: momCreated,
          completed: momCompleted,
          createdThisMonth,
          createdLastMonth,
          completedThisMonth,
          completedLastMonth,
        },
      },
      statusBreakdown,
      projectTypeBreakdown,
      sourceBreakdown: {
        inhouse: inhouseCount,
        outsource: outsourceCount,
      },
      monthlyTrends,
      creatorLeaderboard,
      employeeMatrix,
      recentProjects,
    });
  } catch (err: any) {
    console.error("Project analytics dashboard error:", err);
    return sendErrorResponse(res, 500, err?.message || "Failed to fetch project analytics");
  }
}
