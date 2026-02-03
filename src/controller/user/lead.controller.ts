// src/controller/user/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * Helpers (kept local so this file is self-contained)
 */
const getAccountIdFromReqUser = async (userId?: string | null) => {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true },
  });
  return u?.accountId ?? null;
};

const normalizeMobile = (m: unknown) => String(m ?? "").replace(/\D/g, "");

async function resolveAssigneeSnapshot(input: {
  accountId?: string | null;
  teamId?: string | null;
}) {
  if (input.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, firstName: true, lastName: true },
    });
    return acc
      ? {
          type: "ACCOUNT",
          id: acc.id,
          name: `${acc.firstName} ${acc.lastName}`,
        }
      : null;
  }

  if (input.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      select: { id: true, name: true },
    });
    return team ? { type: "TEAM", id: team.id, name: team.name } : null;
  }

  return null;
}

async function resolvePerformerSnapshot(accountId: string | null) {
  if (!accountId) return null;
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
      contactPhone: true,
    },
  });

  if (!acc) return null;

  return {
    id: acc.id,
    name: `${acc.firstName} ${acc.lastName}`,
    designation: acc.designation ?? null,
    contactPhone: acc.contactPhone ?? null,
  };
}

/* ==========================
   USER (EMPLOYEE) CONTROLLER
   ========================== */

/**
 * GET /leads/my
 * List leads assigned to the current user's account or teams
 */
export async function listMyLeads(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      status,
      source,
      search,
      fromDate,
      toDate,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);

    const where: any = {
      assignments: {
        some: {
          isActive: true,
          OR: [
            { accountId: accountId },
            {
              team: {
                members: {
                  some: { accountId: accountId },
                },
              },
            },
          ],
        },
      },
    };

    if (status) where.status = status;
    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: "insensitive" } },
        { mobileNumber: { contains: search } },
        { productTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    // sanitize sortBy
    const allowedSortFields = new Set([
      "createdAt",
      "updatedAt",
      "closedAt",
      "customerName",
      "status",
    ]);
    const sortField = allowedSortFields.has(sortBy) ? sortBy : "createdAt";
    const orderBy: any = {};
    orderBy[sortField] = sortOrder === "asc" ? "asc" : "desc";

    const [total, leads] = await prisma.$transaction([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                },
              },
              team: { select: { id: true, name: true } },
            },
          },
        },
        orderBy,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return sendSuccessResponse(res, 200, "My leads fetched", {
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
    console.error("List my leads error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
  }
}

/**
 * GET /leads/my/:id
 * Get lead detail visible to current assignee (includes assignments history & activity summary)
 */
export async function getMyLeadById(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const lead = await prisma.lead.findFirst({
      where: {
        id,
        assignments: {
          some: {
            isActive: true,
            OR: [
              { accountId: accountId },
              {
                team: {
                  members: {
                    some: { accountId: accountId },
                  },
                },
              },
            ],
          },
        },
      },
      include: {
        // include all assignments (active + history) so UI can show reassign history
        assignments: {
          orderBy: { assignedAt: "desc" },
          include: {
            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                contactPhone: true,
                designation: true,
              },
            },
            team: { select: { id: true, name: true } },
            assignedByAcc: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        activity: {
          orderBy: { createdAt: "desc" },
          take: 100, // limit to latest 100 for payload safety
          include: {
            performedByAccount: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactPhone: true,
              },
            },
          },
        },
      },
    });

    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    return sendSuccessResponse(res, 200, "Lead fetched", lead);
  } catch (err: any) {
    console.error("Get my lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead");
  }
}

/**
 * PATCH /leads/my/:id/status
 * Update status/remark as the assignee (account or team member)
 */
export async function updateMyLeadStatus(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { status, remark, cost, customerName } = req.body as {
      status?: "PENDING" | "IN_PROGRESS" | "CLOSED" | "CONVERTED";
      remark?: string;
      cost?: number;
      customerName?: string;
    };

    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    if (
      typeof status === "undefined" &&
      typeof remark === "undefined" &&
      typeof cost === "undefined" &&
      typeof customerName === "undefined"
    ) {
      return sendErrorResponse(res, 400, "Nothing to update");
    }

    // verify access: ensure the lead is currently assigned to this user (directly or via team)
    const lead = await prisma.lead.findFirst({
      where: {
        id,
        assignments: {
          some: {
            isActive: true,
            OR: [
              { accountId: accountId },
              {
                team: {
                  members: {
                    some: { accountId: accountId },
                  },
                },
              },
            ],
          },
        },
      },
    });

    if (!lead) return sendErrorResponse(res, 403, "Access denied");

    const performerSnapshot = await resolvePerformerSnapshot(accountId);

    const updated = await prisma.$transaction(async (tx) => {
      // prepare update payload
      const data: any = {};
      if (typeof status !== "undefined") data.status = status;
      if (typeof remark !== "undefined") data.remark = remark;
      if (typeof cost !== "undefined") data.cost = cost;
      if (typeof customerName !== "undefined") data.customerName = customerName;
      if (data.status === "CLOSED" || data.status === "CONVERTED") {
        data.closedAt = new Date();
      }

      // perform update
      const updatedLead = await tx.lead.update({
        where: { id },
        data,
      });

      // build snapshots and diffs
      const fromState = {
        id: lead.id,
        status: lead.status,
        remark: lead.remark ?? null,
        cost: lead.cost ?? null,
        customerName: lead.customerName ?? null,
      };

      const toState = {
        id: updatedLead.id,
        status: updatedLead.status,
        remark: updatedLead.remark ?? null,
        cost: updatedLead.cost ?? null,
        customerName: updatedLead.customerName ?? null,
      };

      // Detect what changed
      const changedFields: Record<string, { from: any; to: any }> = {};
      if (fromState.status !== toState.status)
        changedFields.status = { from: fromState.status, to: toState.status };
      if ((fromState.remark ?? null) !== (toState.remark ?? null))
        changedFields.remark = { from: fromState.remark, to: toState.remark };
      // careful with Decimal types — convert to string/number for comparison
      const prevCost = fromState.cost == null ? null : Number(fromState.cost);
      const newCost = toState.cost == null ? null : Number(toState.cost);
      if (prevCost !== newCost)
        changedFields.cost = { from: prevCost, to: newCost };
      if ((fromState.customerName ?? null) !== (toState.customerName ?? null))
        changedFields.customerName = {
          from: fromState.customerName,
          to: toState.customerName,
        };

      // Create activity logs depending on changes
      // 1) STATUS_CHANGED (if status changed)
      if (changedFields.status) {
        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "STATUS_CHANGED",
            performedBy: accountId,
            meta: {
              fromState: lead,
              toState: updatedLead,
            },
          },
        });
      }

      // 2) UPDATED (if non-status fields changed: cost, customerName, remark)
      const nonStatusKeys = ["cost", "customerName", "remark"];
      const hasNonStatusChange = nonStatusKeys.some((k) =>
        Object.prototype.hasOwnProperty.call(changedFields, k),
      );
      if (hasNonStatusChange) {
        // include only the changed fields in meta to keep payload compact
        const changes: Record<string, any> = {};
        for (const k of nonStatusKeys) {
          if (changedFields[k]) changes[k] = changedFields[k];
        }

        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "UPDATED",
            performedBy: accountId,
            meta: {
              fromState: lead,
              toState: updatedLead,
            },
          },
        });
      }

      // 3) CLOSED (if lead became CLOSED) — separate explicit log
      const becameClosed =
        changedFields.status && changedFields.status.to === "CLOSED";
      if (becameClosed) {
        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "CLOSED",
            performedBy: accountId,
            meta: {
              closedBy: performerSnapshot,
              closedAt: new Date().toISOString(),
            },
          },
        });
      }

      return updatedLead;
    });

    return sendSuccessResponse(res, 200, "Lead updated", updated);
  } catch (err: any) {
    console.error("Update lead status error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update lead");
  }
}

/**
 * GET /leads/my/:id/activity
 * Get activity timeline for a lead (only if user has access)
 */
export async function getMyLeadActivity(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const hasAccess = await prisma.lead.findFirst({
      where: {
        id,
        assignments: {
          some: {
            isActive: true,
            OR: [
              { accountId: accountId },
              {
                team: {
                  members: {
                    some: { accountId: accountId },
                  },
                },
              },
            ],
          },
        },
      },
      select: { id: true },
    });

    if (!hasAccess) return sendErrorResponse(res, 403, "Access denied");

    const activity = await prisma.leadActivityLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      include: {
        performedByAccount: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            contactPhone: true,
          },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Activity fetched", activity);
  } catch (err: any) {
    console.error("Get my lead activity error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch activity",
    );
  }
}


/**
 * GET /leads/my/stats/status
 * Lead counts by status for current user
 */
export async function getMyLeadStatusStats(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const baseWhere = {
      assignments: {
        some: {
          isActive: true,
          OR: [
            { accountId },
            {
              team: {
                members: {
                  some: { accountId },
                },
              },
            },
          ],
        },
      },
    };

    const statuses = ["PENDING", "IN_PROGRESS", "CLOSED", "CONVERTED"] as const;

    const counts = await prisma.$transaction(
      statuses.map((status) =>
        prisma.lead.count({
          where: {
            ...baseWhere,
            status,
          },
        }),
      ),
    );

    const data = {
      PENDING: counts[0],
      IN_PROGRESS: counts[1],
      CLOSED: counts[2],
      CONVERTED: counts[3],
      TOTAL: counts.reduce((a, b) => a + b, 0),
    };

    return sendSuccessResponse(res, 200, "My lead counts fetched", data);
  } catch (err: any) {
    console.error("My lead stats error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead stats",
    );
  }
}



/**
 * GET /leads/my/dsu
 * Employee DSU view:
 * - Pending & In-Progress → all
 * - Closed & Converted → today only
 */
export async function listMyDsuLeads(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      search,
      source,
      sortBy = "updatedAt",
      sortOrder = "desc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);

    /** Today window */
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    /** Base assignment scope */
    const where: any = {
      isActive: true,
      assignments: {
        some: {
          isActive: true,
          OR: [
            { accountId },
            {
              team: {
                members: {
                  some: { accountId },
                },
              },
            },
          ],
        },
      },
      OR: [
        // Pending & In Progress → always visible
        { status: { in: ["PENDING", "IN_PROGRESS"] } },

        // Closed → today only
        {
          status: "CLOSED",
          closedAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },

        // Converted → today only
        {
          status: "CONVERTED",
          updatedAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      ],
    };

    if (source) where.source = source;

    if (search) {
      where.AND = [
        {
          OR: [
            { customerName: { contains: search, mode: "insensitive" } },
            { mobileNumber: { contains: search } },
            { productTitle: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    /** Sorting */
    const allowedSortFields = new Set([
      "createdAt",
      "updatedAt",
      "closedAt",
      "customerName",
      "status",
    ]);

    const sortField = allowedSortFields.has(sortBy) ? sortBy : "updatedAt";
    const orderBy: any = { [sortField]: sortOrder === "asc" ? "asc" : "desc" };

    const [total, leads] = await prisma.$transaction([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                },
              },
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "My DSU leads fetched", {
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
    console.error("List my DSU leads error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch DSU leads");
  }
}
