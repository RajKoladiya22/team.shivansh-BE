// src/controller/user/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import { randomUUID } from "node:crypto";

/**
 * Helpers (kept local so this file is self-contained)
 */
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

async function stopWorkIfActive(tx: any, accountId: string, leadId: string) {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { activeLeadId: true },
  });

  // Only stop if user is working on THIS lead
  if (account?.activeLeadId !== leadId) return;

  const lastStart = await tx.leadActivityLog.findFirst({
    where: {
      leadId,
      performedBy: accountId,
      action: "WORK_STARTED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!lastStart) return;

  const now = new Date();
  const startedAtIso =
    (lastStart.meta as any)?.startedAt ?? lastStart.createdAt.toISOString();

  const durationSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(startedAtIso).getTime()) / 1000),
  );

  // WORK_ENDED log
  await tx.leadActivityLog.create({
    data: {
      leadId,
      action: "WORK_ENDED",
      performedBy: accountId,
      meta: {
        startedAt: startedAtIso,
        endedAt: now.toISOString(),
        durationSeconds,
        reason: "LEAD_STATUS_TERMINAL",
      },
    },
  });

  // increment lead work time
  await tx.lead.update({
    where: { id: leadId },
    data: {
      totalWorkSeconds: { increment: durationSeconds },
      isWorking: false,
    },
  });

  // clear busy state.   const Acc =
  await tx.account.update({
    where: { id: accountId },
    data: {
      isBusy: false,
      activeLeadId: null,
    },
  });

  // console.log("\n\n\n\n\n\nAcc\n", Acc, "\n\n\n\n\n\n\n");

  const io = getIo();
  io.emit("busy:changed", {
    accountId,
    leadId: leadId,
    isBusy: false,
    source: "WORK_ENDED",
  });
}

/* ==========================
   USER (EMPLOYEE) CONTROLLER
   ========================== */

/**
 * POST /leads/my
 * User creates lead and auto-assigns to self
 */
export async function createMyLead(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      source = "MANUAL",
      type = "LEAD",
      customerName,
      mobileNumber,
      product,
      productTitle,
      cost,
      remark,
      demoDate,
    } = req.body as Record<string, any>;

    if (!customerName || !mobileNumber)
      return sendErrorResponse(
        res,
        400,
        "Customer name and mobile are required",
      );

    const normalizedMobile = normalizeMobile(mobileNumber);

    const resolvedProduct = product
      ? {
          id: product.id || randomUUID(),
          slug: product.slug ?? null,
          link: product.link ?? null,
          title: product.title ?? null,
        }
      : undefined;

    const finalProductTitle = resolvedProduct?.title ?? productTitle ?? null;

    const now = new Date();

    const newLead = await prisma.$transaction(async (tx) => {
      /* -------------------------
         1️⃣ Upsert Customer
      ------------------------- */

      const customer = await tx.customer.upsert({
        where: { normalizedMobile },
        create: {
          name: customerName,
          mobile: mobileNumber,
          normalizedMobile,
          createdBy: accountId,
        },
        update: {
          name: customerName,
        },
      });

      /* -------------------------
         2️⃣ Create Lead
      ------------------------- */

      const lead = await tx.lead.create({
        data: {
          source,
          type,
          customerId: customer.id,
          customerName,
          mobileNumber: normalizedMobile,
          product: resolvedProduct,
          productTitle: finalProductTitle,
          cost: cost ?? undefined,
          remark: remark ?? undefined,
          createdBy: accountId,

          demoScheduledAt: demoDate ? new Date(demoDate) : undefined,
          demoCount: demoDate ? 1 : 0,
          demoMeta: demoDate
            ? {
                history: [
                  {
                    type: "SCHEDULED",
                    at: new Date(demoDate),
                    by: accountId,
                  },
                ],
              }
            : undefined,
        },
      });

      /* -------------------------
         3️⃣ Self Assignment
      ------------------------- */

      await tx.leadAssignment.create({
        data: {
          leadId: lead.id,
          type: "ACCOUNT",
          accountId,
          isActive: true,
          assignedBy: accountId,
          assignedAt: now,
        },
      });

      /* -------------------------
         4️⃣ Activity Log
      ------------------------- */

      const initialAssignee = await resolveAssigneeSnapshot({
        accountId,
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: lead.id,
          action: "CREATED",
          performedBy: accountId,
          meta: {
            source,
            type,
            selfAssigned: true,
            initialAssignment: initialAssignee,
            demoScheduledAt: demoDate ?? null,
          },
        },
      });

      return lead;
    });

    /* -------------------------
       🔔 Socket Emit (Minimal)
    ------------------------- */

    try {
      const io = getIo();

      const payload = {
        id: newLead.id,
        customerName: newLead.customerName,
        status: newLead.status,
        demoScheduledAt: newLead.demoScheduledAt,
        createdAt: newLead.createdAt,
      };

      io.to(`leads:user:${accountId}`).emit("lead:created", payload);
      io.to("leads:admin").emit("lead:created", payload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(
      res,
      201,
      "Lead created and assigned to you",
      newLead,
    );
  } catch (err: any) {
    console.error("Create my lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
  }
}

/**
 * GET /leads/my
 * List leads assigned to the current user's account or teams
 */
export async function listMyLeads(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      status,
      source,
      search,
      fromDate,
      toDate,
      sortBy = "createdAt",
      demoFromDate,
      demoToDate,
      demoStatus,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    const where: any = {
      OR: [
        {
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
        {
          leadHelpers: {
            some: {
              isActive: true,
              accountId,
            },
          },
        },
      ],
    };

    if (status) where.status = status;
    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { customerName: { contains: search, mode: "insensitive" } },
            { mobileNumber: { contains: search } },
            { productTitle: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    if (demoFromDate || demoToDate) {
      where.demoScheduledAt = {};
      if (demoFromDate) where.demoScheduledAt.gte = new Date(demoFromDate);
      if (demoToDate) where.demoScheduledAt.lte = new Date(demoToDate);
    }

    if (demoStatus) {
      const now = new Date();

      if (demoStatus === "overdue") {
        where.demoScheduledAt = { lt: now };
        where.demoDoneAt = null;
      }

      if (demoStatus === "upcoming") {
        where.demoScheduledAt = { gt: now };
        where.demoDoneAt = null;
      }

      if (demoStatus === "done") {
        where.demoDoneAt = { not: null };
      }
    }

    const orderBy = [
      { isWorking: "desc" as const }, // indexed boolean
      { status: "asc" as const }, // enum index
      { createdAt: "desc" as const }, // btree index
    ];

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
        skip,
        take: pageSize,
      }),
    ]);

    const enriched = leads.map((lead) => ({
      ...lead,
      isHelper: lead.leadHelpers.length > 0,
      isAssigned: lead.assignments.some(
        (a) => a.accountId === accountId || a.teamId !== null, // already filtered by team membership
      ),
    }));

    return sendSuccessResponse(res, 200, "My leads fetched", {
      data: enriched,
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
    const { id } = req.params;
    if (!id) return sendErrorResponse(res, 400, "Lead ID required");

    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const lead = await prisma.lead.findFirst({
      where: {
        id,
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
        leadHelpers: {
          where: { isActive: true },
          select: {
            role: true,
            addedAt: true,
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
    });

    if (!lead)
      return sendErrorResponse(res, 404, "Lead not found or not accessible");

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
    const { id } = req.params;
    const { status, remark, cost, customerName, demoScheduledAt } =
      req.body as {
        status?:
          | "PENDING"
          | "IN_PROGRESS"
          | "CLOSED"
          | "CONVERTED"
          | "DEMO_DONE"
          | "INTERESTED";
        remark?: string;
        cost?: number;
        customerName?: string;
        demoScheduledAt?: string;
      };
    // console.log("\n\n\n\n\n\n\n\n\n\n req.body:\n", req.body);

    // if (
    //   status === undefined &&
    //   remark === undefined &&
    //   cost === undefined &&
    //   customerName === undefined &&
    //   demoScheduledAt === undefined
    // ) {
    //   return sendErrorResponse(res, 400, "Nothing to update");
    // }

    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

    const TERMINAL_STATUSES = [
      "CLOSED",
      "DEMO_DONE",
      "CONVERTED",
      "PENDING",
    ] as const;

    const isTerminalStatus =
      typeof status !== "undefined" &&
      TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);

    // console.log("\n\n\nisTerminalStatus\n", isTerminalStatus);

    // if (
    //   typeof status === "undefined" &&
    //   typeof remark === "undefined" &&
    //   typeof cost === "undefined" &&
    //   typeof customerName === "undefined"
    // ) {
    //   return sendErrorResponse(res, 400, "Nothing to update");
    // }

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

    // console.log("\n\n\n\nLEAD\n", lead);

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
      // prepare statusMark safely
      const statusMark = {
        ...(lead.statusMark as Record<string, boolean> | null),
      };

      if (status === "CLOSED") {
        statusMark.close = true;
      }

      if (status === "DEMO_DONE") {
        statusMark.demo = true;
      }

      if (status === "CONVERTED") {
        statusMark.converted = true;
      }

      // only assign if something changed
      if (Object.keys(statusMark).length > 0) {
        data.statusMark = statusMark;
      }

      if (isTerminalStatus) {
        await stopWorkIfActive(tx, accountId, id);
      }

      // ── demo scheduling / rescheduling ───────────────────────────────────
      if (demoScheduledAt !== undefined) {
        const newDate = new Date(demoScheduledAt);

        const isNewDate =
          !lead.demoScheduledAt ||
          lead.demoScheduledAt.getTime() !== newDate.getTime();

        if (isNewDate) {
          data.demoScheduledAt = newDate;
          data.demoCount = { increment: 1 };

          // append to demoMeta.history
          const existingMeta = lead.demoMeta as any;
          const history: any[] = existingMeta?.history ?? [];
          data.demoMeta = {
            history: [
              ...history,
              {
                type: lead.demoScheduledAt ? "RESCHEDULED" : "SCHEDULED",
                at: newDate.toISOString(),
                by: accountId,
              },
            ],
          };
        }
      }

      // perform update
      const updatedLead = await tx.lead.update({
        where: { id },
        data,
        include: {
          assignments: {
            include: {
              account: true,
              team: true,
            },
          },
        },
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

    try {
      const io = getIo();

      const patchPayload = {
        id,
        patch: {
          status: updated.status,
          demoDoneAt: updated.demoDoneAt,
          updatedAt: updated.updatedAt,
        },
      };

      io.to(`leads:user:${accountId}`).emit("lead:patch", patchPayload);
      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

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
    const { id } = req.params;

    const accountId = req.user?.accountId;
    if (!accountId || !id)
      return sendErrorResponse(res, 401, "Invalid session user");

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
    const accountId = req.user?.accountId;
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

    const statuses = [
      "PENDING",
      "IN_PROGRESS",
      "DEMO_DONE",
      "INTERESTED",
      "CONVERTED",
      "CLOSED",
    ] as const;

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

    const data: Record<string, number> = {};
    statuses.forEach((status, index) => {
      data[status] = counts[index];
    });

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
    const accountId = await req.user?.accountId;
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
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session");

    const { id: leadId } = req.params;
    const { accountId, role = "EXPORT" } = req.body;

    if (!leadId || !accountId) {
      return sendErrorResponse(res, 400, "Invalid parameters");
    }

    // ensure lead exists
    const leadExists = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
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

    let recipientAccountIds: string[] = [accountId];

    if (leadExists.assignments[0]?.accountId) {
      recipientAccountIds.push(leadExists.assignments[0].accountId);
    } else if (leadExists.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: {
          teamId: leadExists.assignments[0].teamId,
          isActive: true,
        },
        select: { accountId: true },
      });
      recipientAccountIds.push(...members.map((m) => m.accountId));
    }

    recipientAccountIds = [...new Set(recipientAccountIds)];

    try {
      const io = getIo();

      const patchPayload = {
        id: leadId,
        patch: {
          helperAdded: {
            accountId,
            role,
            addedAt: new Date(),
          },
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

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
    const performerAccountId = req.user?.accountId;
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

    const existingLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });

    if (!existingLead) return sendErrorResponse(res, 404, "Lead not found");
    const helper = await prisma.leadHelper.findFirst({
      where: {
        leadId,
        accountId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!helper)
      return sendErrorResponse(res, 404, "Helper not found or already removed");

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

    let recipientAccountIds: string[] = [accountId];

    if (existingLead.assignments[0]?.accountId) {
      recipientAccountIds.push(existingLead.assignments[0].accountId);
    } else if (existingLead.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: {
          teamId: existingLead.assignments[0].teamId,
          isActive: true,
        },
        select: { accountId: true },
      });

      recipientAccountIds.push(...members.map((m) => m.accountId));
    }

    recipientAccountIds = [...new Set(recipientAccountIds)];

    try {
      const io = getIo();

      const patchPayload = {
        id: leadId,
        patch: {
          helperRemoved: {
            accountId,
            removedAt: new Date(),
          },
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

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
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

    const { id: leadId } = req.params;

    if (!leadId) return sendErrorResponse(res, 400, "Lead ID required");

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
        data: { status: "IN_PROGRESS", isWorking: true },
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
          fromBusy: false,
          toBusy: true,
          reason: "WORK_STARTED",
        },
      }),
    ]);

    try {
      const io = getIo();

      io.to(`leads:user:${accountId}`).emit("lead:patch", {
        id: leadId,
        patch: {
          status: "IN_PROGRESS",
          isWorking: true,
        },
      });
      io.to(`lead:${leadId}`).emit("lead:patch", {
        id: leadId,
        patch: {
          status: "IN_PROGRESS",
          isWorking: true,
        },
      });
      io.to("leads:admin").emit("lead:patch", {
        id: leadId,
        patch: {
          status: "IN_PROGRESS",
          isWorking: true,
        },
      });

      io.emit("busy:changed", {
        accountId,
        leadId,
        isBusy: true,
      });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Work started", { leadId });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

export async function stopLeadWork(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
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
          isWorking: false,
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

    try {
      const io = getIo();

      io.to(`leads:user:${accountId}`).emit("lead:patch", {
        id: leadId,
        patch: {
          isWorking: false,
        },
      });

      io.emit("busy:changed", {
        accountId,
        leadId: leadId,
        isBusy: false,
      });
    } catch {
      console.warn("Socket emit skipped");
    }

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

/**
 * GET /user/leads/work/current
 */
export async function getMyActiveWork(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    /* 1️⃣ Fetch Account (light select) */
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        activeLeadId: true,
      },
    });

    if (!account?.activeLeadId) {
      return sendSuccessResponse(res, 200, "No active work", null);
    }

    const leadId = account.activeLeadId;

    /* 2️⃣ Fetch Lead + Last Start */
    const [lead, lastStart] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          id: true,
          customerName: true,
          status: true,
          productTitle: true,
          isWorking: true,
          totalWorkSeconds: true,
        },
      }),

      prisma.leadActivityLog.findFirst({
        where: {
          leadId,
          performedBy: accountId,
          action: "WORK_STARTED",
        },
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          meta: true,
        },
      }),
    ]);

    if (!lead) {
      // Lead deleted or inconsistent state
      return sendSuccessResponse(res, 200, "No active work", null);
    }

    /* 3️⃣ Calculate Live Duration */
    let durationSeconds = 0;
    let startedAt: string | null = null;

    if (lastStart) {
      const startIso =
        (lastStart.meta as any)?.startedAt ?? lastStart.createdAt.toISOString();

      const startDate = new Date(startIso);
      if (!isNaN(startDate.getTime())) {
        durationSeconds = Math.max(
          0,
          Math.floor((Date.now() - startDate.getTime()) / 1000),
        );
        startedAt = startDate.toISOString();
      }
    }

    return sendSuccessResponse(res, 200, "Active work", {
      leadId: lead.id,
      customerName: lead.customerName,
      productTitle: lead.productTitle,
      status: lead.status,
      isWorking: lead.isWorking,
      totalWorkSeconds: lead.totalWorkSeconds,
      currentSessionSeconds: durationSeconds,
      startedAt,
    });
  } catch (err: any) {
    console.error("getMyActiveWork error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch active work",
    );
  }
}
