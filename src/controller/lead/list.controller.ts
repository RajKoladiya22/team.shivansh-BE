// src/controller/lead/list.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { Lead_Status } from "@prisma/client";
/**
 * GET /admin/leads
 */
export async function listLeadsAdmin(req: Request, res: Response) {
    try {
        const {
            status,
            source,
            search,
            assignedToAccountId,
            assignedToTeamId,
            helperAccountId,
            helperRole,
            fromDate,
            toDate,
            demoFromDate,
            demoToDate,
            demoStatus,
            page = "1",
            limit = "20",
            followUpStatus,
            followUpType,
            followUpRange,
            followUpFromDate,
            followUpToDate,
            isImportant,
        } = req.query as Record<string, string>;

        const pageNumber = Math.max(Number(page), 1);
        const pageSize = Math.min(Number(limit), 100);
        const skip = (pageNumber - 1) * pageSize;

        const where: any = {};

        if (status) where.status = status;
        if (source) where.source = source;
        if (isImportant === "true") where.isImportant = true;

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt.gte = new Date(fromDate);
            if (toDate) {
                const end = new Date(toDate);
                end.setDate(end.getDate() + 1);
                where.createdAt.lt = end;
            }
        }

        if (demoFromDate || demoToDate) {
            where.demoScheduledAt = {};
            if (demoFromDate) where.demoScheduledAt.gte = new Date(demoFromDate);
            if (demoToDate) where.demoScheduledAt.lte = new Date(demoToDate);
        }

        if (demoStatus) {
            const now = new Date();
            if (demoStatus === "scheduled") {
                where.demoScheduledAt = { not: null };
                where.demoDoneAt = null;
            }
            if (demoStatus === "done") where.demoDoneAt = { not: null };
            if (demoStatus === "overdue") {
                where.demoScheduledAt = { lt: now };
                where.demoDoneAt = null;
            }
            if (demoStatus === "upcoming") {
                where.demoScheduledAt = { gt: now };
                where.demoDoneAt = null;
            }
        }

        if (search) {
            const tokens = search.trim().split(/\s+/).filter(Boolean);
            const searchConditions = tokens.map((word) => ({
                OR: [
                    { customerName: { contains: word, mode: "insensitive" } },
                    { customerCompanyName: { contains: word, mode: "insensitive" } },
                    { mobileNumber: { contains: word } },
                    { productTitle: { contains: word, mode: "insensitive" } },
                ],
            }));
            where.AND = [...(where.AND || []), ...searchConditions];
        }

        if (assignedToAccountId || assignedToTeamId) {
            where.assignments = {
                some: {
                    isActive: true,
                    ...(assignedToAccountId ? { accountId: assignedToAccountId } : {}),
                    ...(assignedToTeamId ? { teamId: assignedToTeamId } : {}),
                },
            };
        }

        if (helperAccountId || helperRole) {
            where.leadHelpers = {
                some: {
                    isActive: true,
                    ...(helperAccountId ? { accountId: helperAccountId } : {}),
                    ...(helperRole ? { role: helperRole as any } : {}),
                },
            };
        }

        if (
            followUpStatus ||
            followUpType ||
            followUpRange ||
            followUpFromDate ||
            followUpToDate
        ) {
            const followUpWhere: any = {};
            if (followUpStatus) followUpWhere.status = followUpStatus;
            if (followUpType) followUpWhere.type = followUpType;

            if (followUpRange) {
                const now = new Date();
                if (followUpRange === "today") {
                    const start = new Date(now); start.setHours(0, 0, 0, 0);
                    const end = new Date(now); end.setHours(23, 59, 59, 999);
                    followUpWhere.scheduledAt = { gte: start, lte: end };
                } else if (followUpRange === "tomorrow") {
                    const start = new Date(now); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
                    const end = new Date(start); end.setHours(23, 59, 59, 999);
                    followUpWhere.scheduledAt = { gte: start, lte: end };
                } else if (followUpRange === "week") {
                    const start = new Date(now); start.setHours(0, 0, 0, 0);
                    const end = new Date(now); end.setDate(end.getDate() + 7); end.setHours(23, 59, 59, 999);
                    followUpWhere.scheduledAt = { gte: start, lte: end };
                } else if (followUpRange === "overdue") {
                    followUpWhere.status = "PENDING";
                    followUpWhere.scheduledAt = { lt: now };
                } else if (followUpRange === "upcoming") {
                    followUpWhere.status = "PENDING";
                    followUpWhere.scheduledAt = { gt: now };
                } else if (followUpRange === "custom") {
                    followUpWhere.scheduledAt = {};
                    if (followUpFromDate) followUpWhere.scheduledAt.gte = new Date(followUpFromDate);
                    if (followUpToDate) {
                        const end = new Date(followUpToDate); end.setHours(23, 59, 59, 999);
                        followUpWhere.scheduledAt.lte = end;
                    }
                }
            } else if (followUpFromDate || followUpToDate) {
                followUpWhere.scheduledAt = {};
                if (followUpFromDate) followUpWhere.scheduledAt.gte = new Date(followUpFromDate);
                if (followUpToDate) {
                    const end = new Date(followUpToDate); end.setHours(23, 59, 59, 999);
                    followUpWhere.scheduledAt.lte = end;
                }
            }

            where.followUps = { some: followUpWhere };
        }

        const orderBy = [
            { isWorking: "desc" as const },
            { status: "asc" as const },
            { createdAt: "desc" as const },
        ];

        const [total, leads] = await Promise.all([
            prisma.lead.count({ where }),
            prisma.lead.findMany({
                where,
                orderBy,
                skip,
                take: pageSize,
                select: {
                    id: true,
                    source: true,
                    type: true,
                    status: true,
                    customerName: true,
                    mobileNumber: true,
                    productTitle: true,
                    product: true,
                    cost: true,
                    remark: true,
                    isWorking: true,
                    demoScheduledAt: true,
                    demoDoneAt: true,
                    demoCount: true,
                    statusMark: true,
                    totalWorkSeconds: true,
                    states: true,
                    createdAt: true,
                    updatedAt: true,
                    isImportant: true,
                    productCatalogId: true,
                    productCatalog: true,
                    followUps: {
                        where: { status: "PENDING" },
                        orderBy: { scheduledAt: "asc" },
                        select: {
                            id: true,
                            type: true,
                            status: true,
                            scheduledAt: true,
                            remark: true,
                        },
                    },
                    assignments: {
                        where: { isActive: true },
                        select: {
                            id: true,
                            type: true,
                            isActive: true,
                            assignedAt: true,
                            remark: true,
                            account: {
                                select: { id: true, firstName: true, lastName: true, contactPhone: true, avatar: true },
                            },
                            team: { select: { id: true, name: true } },
                        },
                    },
                    leadHelpers: {
                        where: { isActive: true },
                        select: {
                            role: true,
                            isActive: true,
                            remark: true,
                            account: {
                                select: { id: true, firstName: true, lastName: true, designation: true, contactPhone: true, avatar: true },
                            },
                        },
                    },
                    customer: {
                        select: {
                            id: true,
                            name: true,
                            mobile: true,
                            customerCompanyName: true,
                            products: true,
                            customerCategory: true,
                        },
                    },
                },
            }),
        ]);

        return sendSuccessResponse(res, 200, "Leads fetched", {
            data: leads,
            meta: {
                page: pageNumber,
                limit: pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
                hasNext: pageNumber * pageSize < total,
                hasPrev: pageNumber > 1,
            },
        });
    } catch (err: any) {
        console.error("List leads error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
    }
}



/**
 * GET /admin/leads/stats/status
 */
export async function getLeadCountByStatusAdmin(req: Request, res: Response) {
    try {
        const { fromDate, toDate, source, accountId, demoFromDate, demoToDate, demoStatus, isImportant } =
            req.query as Record<string, string>;

        const where: any = {};
        const now = new Date();

        if (source) where.source = source;
        if (isImportant === "true") where.isImportant = true;

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
            if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
        }

        if (demoFromDate || demoToDate) {
            where.demoScheduledAt = {
                ...(demoFromDate && { gte: new Date(`${demoFromDate}T00:00:00.000+05:30`) }),
                ...(demoToDate && { lte: new Date(`${demoToDate}T23:59:59.999+05:30`) }),
            };
        }

        if (demoStatus === "overdue") { where.demoScheduledAt = { lt: now }; where.demoDoneAt = null; }
        if (demoStatus === "upcoming") { where.demoScheduledAt = { gt: now }; where.demoDoneAt = null; }
        if (demoStatus === "done") where.demoDoneAt = { not: null };

        if (accountId) {
            where.assignments = { some: { accountId, isActive: true } };
        }

        const grouped = await prisma.lead.groupBy({
            by: ["status"],
            where,
            _count: { _all: true },
        });

        const result = {
            PENDING: 0, IN_PROGRESS: 0, FOLLOW_UPS: 0, DEMO_DONE: 0,
            INTERESTED: 0, CONVERTED: 0, CLOSED: 0, TOTAL: 0,
        };

        for (const row of grouped) {
            result[row.status as keyof typeof result] = row._count._all;
            result.TOTAL += row._count._all;
        }

        return sendSuccessResponse(res, 200, "Lead counts fetched", result);
    } catch (err: any) {
        console.error("Lead count by status error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead counts");
    }
}

/**
 * GET /admin/lead/stats/leads/value
 */
export async function getLeadValueStatsAdmin(req: Request, res: Response) {
    try {
        const { fromDate, toDate, source, accountId } = req.query as Record<string, string>;

        const where: any = {};
        if (source) where.source = source;

        if (fromDate || toDate) {
            where.createdAt = {};
            if (fromDate) { const s = new Date(fromDate); s.setHours(0, 0, 0, 0); where.createdAt.gte = s; }
            if (toDate) { const e = new Date(toDate); e.setHours(23, 59, 59, 999); where.createdAt.lte = e; }
        }

        if (accountId) {
            where.assignments = { some: { accountId, isActive: true } };
        }

        const grouped = await prisma.lead.groupBy({
            by: ["status"],
            where,
            _sum: { cost: true },
            _count: { _all: true },
        });

        const statuses: Lead_Status[] = [
            "PENDING", "IN_PROGRESS", "FOLLOW_UPS", "DEMO_DONE",
            "INTERESTED", "CONVERTED", "CLOSED",
        ];

        const byStatus = statuses.reduce(
            (acc, status) => {
                const row = grouped.find((r) => r.status === status);
                acc[status] = {
                    totalValue: row?._sum?.cost ? Number(row._sum.cost) : 0,
                    count: row?._count?._all ?? 0,
                };
                return acc;
            },
            {} as Record<string, { totalValue: number; count: number }>,
        );

        const grandTotal = grouped.reduce((sum, row) => sum + Number(row._sum?.cost), 0);
        const totalCount = grouped.reduce((sum, row) => sum + (row._count?._all ?? 0), 0);

        return sendSuccessResponse(res, 200, "Lead value stats fetched", {
            byStatus,
            total: { totalValue: grandTotal, count: totalCount },
        });
    } catch (err: any) {
        console.error("Lead value stats error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead value stats");
    }
}

/**
 * GET /admin/leads/:id/activity
 */
export async function getLeadActivityTimelineAdmin(req: Request, res: Response) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const leadExists = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!leadExists) return sendErrorResponse(res, 404, "Lead not found");

    const activity = await prisma.leadActivityLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      include: {
        performedByAccount: {
          select: { id: true, firstName: true, avatar: true, lastName: true, designation: true, contactPhone: true },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Lead activity timeline fetched", {
      leadId: id,
      total: activity.length,
      activity,
    });
  } catch (err: any) {
    console.error("Admin lead activity timeline error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead activity");
  }
}