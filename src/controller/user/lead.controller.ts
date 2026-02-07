// src/controller/user/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";

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

async function assertLeadAccessForUser(leadId: string, accountId: string) {
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
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
    },
    select: { id: true },
  });

  if (!lead) {
    throw new Error("ACCESS_DENIED");
  }

  return lead;
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

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { activeLeadId: true },
    });

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

    const [total, leads] = await Promise.all([
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
          leadHelpers: {
            where: { isActive: true },
            include: {
              account: {
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
        orderBy,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const activeLeadId = account?.activeLeadId;

    // Status priority map
    const STATUS_PRIORITY: Record<string, number> = {
      PENDING: 1,
      IN_PROGRESS: 2,
      DONE: 3,
      CLOSED: 3,
    };

    leads.sort((a, b) => {
      // ⭐ 1. Active working lead always first
      if (a.id === activeLeadId) return -1;
      if (b.id === activeLeadId) return 1;

      // ⭐ 2. Status priority sorting
      const aPriority = STATUS_PRIORITY[a.status] ?? 99;
      const bPriority = STATUS_PRIORITY[b.status] ?? 99;

      if (aPriority !== bPriority) return aPriority - bPriority;

      // ⭐ 3. Fallback → keep DB sort order (createdAt etc)
      return 0;
    });

    const MyleadsData = leads.map((lead) => ({
      ...lead,
      isWorking: lead.id === activeLeadId,
    }));

    return sendSuccessResponse(res, 200, "My leads fetched", {
      data: MyleadsData,
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
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch DSU leads",
    );
  }
}

/**
 * POST /user/leads/:id/helpers
 * Add helper/export employee to lead
 */
export async function addLeadHelper(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const performerAccountId = await getAccountIdFromReqUser(userId);
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session");

    const { id: leadId } = req.params;
    const { accountId, role = "SUPPORT" } = req.body;

    if (!accountId) {
      return sendErrorResponse(res, 400, "accountId is required");
    }

    // 🔐 ACCESS CHECK (admin OR assignee)
    if (!req.user?.roles?.includes("ADMIN")) {
      try {
        await assertLeadAccessForUser(leadId, performerAccountId);
      } catch {
        return sendErrorResponse(res, 403, "Access denied");
      }
    }

    // ensure lead exists
    const leadExists = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!leadExists) {
      return sendErrorResponse(res, 404, "Lead not found");
    }

    const helper = await prisma.leadHelper.upsert({
      where: {
        leadId_accountId: {
          leadId,
          accountId,
        },
      },
      update: {
        isActive: true,
        removedAt: null,
        role,
      },
      create: {
        leadId,
        accountId,
        role,
        addedBy: performerAccountId,
      },
    });

    const helperSnapshot = await resolveAssigneeSnapshot({ accountId });

    await prisma.leadActivityLog.create({
      data: {
        leadId,
        action: "HELPER_ADDED",
        performedBy: performerAccountId,
        meta: {
          initialAssignment: helperSnapshot,
          role,
        },
      },
    });

    return sendSuccessResponse(res, 200, "Helper added to Lead", helper);
  } catch (err: any) {
    console.error("addLeadHelper error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to add helper");
  }
}

/**
 * DELETE /user/leads/:id/helpers/:accountId"
 * Remove helper/export employee from lead
 */

export async function removeLeadHelper(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const performerAccountId = await getAccountIdFromReqUser(userId);
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session");

    const { id: leadId, accountId } = req.params;

    // 🔐 ACCESS CHECK (admin OR assignee)
    if (!req.user?.roles?.includes("ADMIN")) {
      try {
        await assertLeadAccessForUser(leadId, performerAccountId);
      } catch {
        return sendErrorResponse(res, 403, "Access denied");
      }
    }

    const updated = await prisma.leadHelper.updateMany({
      where: {
        leadId,
        accountId,
        isActive: true,
      },
      data: {
        isActive: false,
        removedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return sendErrorResponse(res, 404, "Helper not found or already removed");
    }

    const helperSnapshot = await resolveAssigneeSnapshot({ accountId });

    await prisma.leadActivityLog.create({
      data: {
        leadId,
        action: "HELPER_REMOVED",
        performedBy: performerAccountId,
        meta: {
          initialAssignment: helperSnapshot,
        },
      },
    });

    return sendSuccessResponse(res, 200, "Helper removed");
  } catch (err: any) {
    console.error("removeLeadHelper error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to remove helper",
    );
  }
}

export async function startLeadWork(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

    const { id: leadId } = req.params;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { activeLeadId: true },
    });

    if (account?.activeLeadId) {
      return sendErrorResponse(res, 409, "Already working on another lead");
    }

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: accountId,
    });

    // await prisma.$transaction([
    await Promise.all([
      prisma.account.update({
        where: { id: accountId },
        data: {
          isBusy: true,
          activeLeadId: leadId,
        },
      }),

      prisma.lead.update({
        where: { id: leadId },
        data: { status: "IN_PROGRESS" },
      }),

      prisma.leadActivityLog.create({
        data: {
          leadId,
          action: "WORK_STARTED",
          performedBy: accountId,
          meta: {
            initialAssignment: initialAssignee,
            startedAt: new Date().toISOString(),
          },
        },
      }),

      prisma.busyActivityLog.create({
        data: {
          accountId: accountId,
          fromBusy: true,
          toBusy: false,
          reason: "WORK_STARTED",
        },
      }),
    ]);

    const io = getIo();
    io.emit("busy:changed", {
      accountId: accountId,
      isBusy: true,
      source: "WORK_STARTED",
    });

    return sendSuccessResponse(res, 200, "Work started", { leadId });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function stopLeadWork(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

    // fetch account with activeLeadId (we need activeLeadId before we clear it)
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { activeLeadId: true },
    });

    const leadId = account?.activeLeadId;
    if (!leadId) {
      return sendErrorResponse(res, 404, "No active work");
    }

    // Find the most recent WORK_STARTED entry for this lead by this account
    const lastStart = await prisma.leadActivityLog.findFirst({
      where: {
        leadId,
        performedBy: accountId,
        action: "WORK_STARTED",
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    const now = new Date();
    let durationSeconds = 0;
    let startedAtIso: string | null = null;

    if (lastStart?.meta && typeof lastStart.meta === "object") {
      // prefer meta.startedAt if present, else fallback to createdAt
      startedAtIso =
        (lastStart.meta as any).startedAt ?? lastStart.createdAt.toISOString();
      if (startedAtIso) {
        const startedAtDate = new Date(startedAtIso);
        if (!isNaN(startedAtDate.getTime())) {
          durationSeconds = Math.max(
            0,
            Math.floor((now.getTime() - startedAtDate.getTime()) / 1000),
          );
        }
      }
    } else {
      // fallback: use createdAt from lastStart if present
      if (lastStart?.createdAt) {
        const startedAtDate = lastStart.createdAt;
        durationSeconds = Math.max(
          0,
          Math.floor((now.getTime() - startedAtDate.getTime()) / 1000),
        );
        startedAtIso = startedAtDate.toISOString();
      }
    }

    // Prepare meta for WORK_ENDED
    const endedAtIso = now.toISOString();
    const workEndMeta = {
      initialAssignment: await resolveAssigneeSnapshot({ accountId }),
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      durationSeconds,
    };

    // Transaction:
    // - clear account.activeLeadId, set isBusy false
    // - create WORK_ENDED log with duration
    // - increment lead.totalWorkSeconds by durationSeconds
    // - create busyActivityLog event
    const [updatedAccount, workLog, updatedLead] = await Promise.all([
      prisma.account.update({
        where: { id: accountId },
        data: {
          isBusy: false,
          activeLeadId: null,
        },
      }),

      prisma.leadActivityLog.create({
        data: {
          leadId,
          action: "WORK_ENDED",
          performedBy: accountId,
          meta: workEndMeta,
        },
      }),

      prisma.lead.update({
        where: { id: leadId },
        data: {
          totalWorkSeconds: { increment: durationSeconds },
        },
        select: { id: true, totalWorkSeconds: true },
      }),

      // create busyActivityLog (optional, can be part of separate array entry above)
    ]);

    // create busyActivityLog outside the above array (or include it in the transaction if preferred)
    await prisma.busyActivityLog.create({
      data: {
        accountId: accountId,
        fromBusy: true,
        toBusy: false,
        reason: "WORK_ENDED",
      },
    });

    const io = getIo();
    io.emit("busy:changed", {
      accountId,
      isBusy: false,
      source: "WORK_ENDED",
    });

    return sendSuccessResponse(res, 200, "Work stopped", {
      leadId,
      durationSeconds,
      totalWorkSeconds: (updatedLead as any)?.totalWorkSeconds ?? null,
      endedAt: endedAtIso,
    });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function getMyActiveWork(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

  const accountId = await getAccountIdFromReqUser(userId);
  if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: {
      activeLead: {
        select: {
          id: true,
          customerName: true,
          status: true,
          productTitle: true,
        },
      },
    },
  });

  if (!account?.activeLeadId) {
    return sendSuccessResponse(res, 200, "No active work", null);
  }

  return sendSuccessResponse(res, 200, "Active work", {
    leadId: account?.activeLead,
  });
}

// export async function stopLeadWork(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

//     const account = await prisma.account.findUnique({
//       where: { id: accountId },
//       select: { activeLeadId: true },
//     });

//     if (!account?.activeLeadId) {
//       return sendErrorResponse(res, 404, "No active work");
//     }

//     const initialAssignee = await resolveAssigneeSnapshot({
//       accountId: accountId,
//     });

//     await prisma.$transaction([
//       prisma.account.update({
//         where: { id: accountId },
//         data: {
//           isBusy: false,
//           activeLeadId: null,
//         },
//       }),

//       prisma.leadActivityLog.create({
//         data: {
//           leadId: account.activeLeadId,
//           action: "WORK_ENDED",
//           performedBy: accountId,
//           meta: {
//             initialAssignment: initialAssignee,
//             endedAt: new Date().toISOString(),
//           },
//         },
//       }),

//       prisma.busyActivityLog.create({
//         data: {
//           accountId: accountId,
//           fromBusy: false,
//           toBusy: true,
//           reason: "WORK_ENDED",
//         },
//       }),
//     ]);

//     const io = getIo();
//     io.emit("busy:changed", {
//       accountId: accountId,
//       isBusy: false,
//       source: "WORK_ENDED",
//     });

//     return sendSuccessResponse(res, 200, "Work stopped", {
//       leadId:account
//     });
//   } catch (err: any) {
//     return sendErrorResponse(res, 500, err.message);
//   }
// }

// export async function startLeadWork(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

//     const { id: leadId } = req.params;

//     // 🔐 ensure user has access (assignee OR team OR helper)
//     const hasAccess = await prisma.lead.findFirst({
//       where: {
//         id: leadId,
//         OR: [
//           {
//             assignments: {
//               some: {
//                 isActive: true,
//                 OR: [
//                   { accountId },
//                   { team: { members: { some: { accountId } } } },
//                 ],
//               },
//             },
//           },
//           {
//             leadHelpers: {
//               some: { accountId, isActive: true },
//             },
//           },
//         ],
//       },
//       select: { id: true },
//     });

//     if (!hasAccess) return sendErrorResponse(res, 403, "Access denied");

//     const active = await prisma.employeeLeadWork.findFirst({
//       where: { accountId, isActive: true },
//     });

//     if (active) {
//       return sendErrorResponse(
//         res,
//         409,
//         "You are already working on another lead",
//       );
//     }

//     const work = await prisma.$transaction(async (tx) => {
//       const w = await tx.employeeLeadWork.create({
//         data: {
//           accountId,
//           leadId,
//           startedFrom: "MANUAL",
//         },
//       });

//       // 🔁 auto busy ON
//       await tx.account.update({
//         where: { id: accountId },
//         data: { isBusy: true },
//       });

//       await tx.busyActivityLog.create({
//         data: {
//           accountId,
//           fromBusy: false,
//           toBusy: true,
//           reason: "LEAD_WORK_START",
//         },
//       });

//       const initialAssignee = await resolveAssigneeSnapshot({
//         accountId: accountId,
//       });

//       await tx.leadActivityLog.create({
//         data: {
//           leadId,
//           action: "WORK_STARTED",
//           performedBy: accountId,
//           meta: {
//             initialAssignment: initialAssignee,
//             startedAt: w.startedAt,
//           },
//         },
//       });

//       return w;
//     });

//     const io = getIo();
// io.emit("busy:changed", {
//   accountId: accountId,
//   isBusy: true,
//   source: "WORK_STARTED",
// });

//     return sendSuccessResponse(res, 200, "Work started", work);
//   } catch (err: any) {
//     console.error("startLeadWork error:", err);
//     return sendErrorResponse(res, 500, err.message);
//   }
// }

// export async function stopLeadWork(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

//     const active = await prisma.employeeLeadWork.findFirst({
//       where: { accountId, isActive: true },
//     });

//     if (!active) return sendErrorResponse(res, 404, "No active work");

//     console.log("\n\nactive------------------------->\n", active);
//     console.log("\naccountId------------------------->\n", accountId);

//     await prisma.$transaction(async (tx) => {
//       await tx.employeeLeadWork.updateMany({
//         where: {
//           id: active.id,
//           accountId,
//           isActive: true,
//           endedAt: null
//         },
//         data: {
//           isActive: false,
//           endedAt: new Date(),
//         },
//       });

//       await tx.account.update({
//         where: { id: accountId },
//         data: { isBusy: false },
//       });

//       await tx.busyActivityLog.create({
//         data: {
//           accountId,
//           fromBusy: true,
//           toBusy: false,
//           reason: "LEAD_WORK_END",
//         },
//       });

// const initialAssignee = await resolveAssigneeSnapshot({
//   accountId: accountId,
// });

//       await tx.leadActivityLog.create({
//         data: {
//           leadId: active.leadId,
//           action: "WORK_ENDED",
//           performedBy: accountId,
//           meta: {
//             initialAssignment: initialAssignee,
//             endedAt: new Date().toISOString(),
//           },
//         },
//       });
//     });

//     const io = getIo();
//     io.emit("busy:changed", {
//       accountId: accountId,
//       isBusy: false,
//       source: "WORK_ENDED",
//     });

//     return sendSuccessResponse(res, 200, "Work stopped");
//   } catch (err: any) {
//     console.error("stopLeadWork error:", err);
//     return sendErrorResponse(res, 500, err.message);
//   }
// }

// export async function getMyActiveWork(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) {
//       return sendErrorResponse(res, 401, "Unauthorized");
//     }

//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) {
//       return sendErrorResponse(res, 401, "Invalid user");
//     }

//     const work = await prisma.employeeLeadWork.findFirst({
//       where: { accountId, isActive: true },
//       include: {
//         lead: {
//           select: {
//             id: true,
//             customerName: true,
//             status: true,
//             productTitle: true,
//           },
//         },
//       },
//     });

//     return sendSuccessResponse(res, 200, "Active work", work);
//   } catch (error) {
//     console.error("Error in getMyActiveWork:", error);
//     return sendErrorResponse(res, 500, "Failed to get active work");
//   }
// }
