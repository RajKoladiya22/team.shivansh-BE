// src/controller/admin/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { randomUUID } from "crypto";
import { triggerAssignmentNotification } from "../../services/notifications";
import { getIo } from "../../core/utils/socket";

/**
 * Helper: get accountId from req.user.id (user table -> accountId)
 */
const normalizeMobile = (m: unknown) => String(m ?? "").replace(/\D/g, "");

export async function getUserIdFromAccountId(
  accountId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: {
      accountId: accountId,
    },
    select: {
      id: true,
    },
  });

  return user?.id ?? null;
}

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
    return team
      ? {
          type: "TEAM",
          id: team.id,
          name: team.name,
        }
      : null;
  }

  return null;
}

async function resolvePerformerSnapshot(accountId: string) {
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
    },
  });

  if (!acc) return null;

  return {
    id: acc.id,
    name: `${acc.firstName} ${acc.lastName}`,
    designation: acc.designation ?? null,
  };
}

/* ==========================
   ADMIN CONTROLLER ACTIONS
   ========================== */

/**
 * POST /admin/leads
 */
export async function createLeadAdmin(req: Request, res: Response) {
  try {
    const creatorAccountId = req.user?.accountId;

    // guard: admin
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    // const creatorAccountId = await getAccountIdFromReqUser(adminUserId);
    if (!creatorAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    // Destructure with different name to avoid shadowing creator accountId
    const {
      source,
      type,
      customerName,
      mobileNumber,
      product,
      cost,
      remark,
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
      demoDate,
    } = req.body as Record<string, any>;

    // console.log("\n\n\n\ndemoDate:", demoDate);

    if (!source || !type)
      return sendErrorResponse(res, 400, "Lead source and type are required");
    if (!customerName || !mobileNumber)
      return sendErrorResponse(
        res,
        400,
        "Customer name and mobile are required",
      );

    // XOR: either account or team must be provided (not both)
    if (!assigneeAccountId && !assigneeTeamId)
      return sendErrorResponse(res, 400, "Assign to account or team");
    if (assigneeAccountId && assigneeTeamId)
      return sendErrorResponse(
        res,
        400,
        "Provide either accountId or teamId, not both",
      );

    // normalize
    const normalizedMobile = normalizeMobile(mobileNumber);

    const resolvedProduct = product
      ? {
          id: product.id || randomUUID(),
          slug: product.slug ?? null,
          link: product.link ?? null,
          title: product.title ?? null,
        }
      : undefined;
    const productTitle =
      resolvedProduct?.title ?? req.body.productTitle ?? null;

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
    });

    // Create lead + initial assignment + CREATED activity in single transaction
    const { lead, recipients } = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { normalizedMobile },
        create: {
          name: customerName,
          mobile: mobileNumber,
          normalizedMobile,
          createdBy: creatorAccountId,
        },
        update: {
          name: customerName || undefined,
          updatedAt: new Date(),
        },
      });

      const created = await tx.lead.create({
        data: {
          source,
          type,
          customerId: customer.id,
          customerName: customer.name,
          mobileNumber: normalizedMobile,
          product: resolvedProduct,
          productTitle,
          cost: cost ?? undefined,
          remark: remark ?? undefined,
          createdBy: creatorAccountId,
          demoScheduledAt: demoDate ? new Date(demoDate) : undefined,
          demoCount: demoDate ? 1 : 0,
          demoMeta: demoDate
            ? {
                history: [
                  {
                    type: "SCHEDULED",
                    at: new Date(demoDate),
                    by: creatorAccountId,
                  },
                ],
              }
            : undefined,
        },
      });

      const assignment = await tx.leadAssignment.create({
        data: {
          leadId: created.id,
          type: assigneeAccountId ? "ACCOUNT" : "TEAM",
          accountId: assigneeAccountId ?? null,
          teamId: assigneeTeamId ?? null,
          isActive: true,
          assignedBy: creatorAccountId,
          assignedAt: new Date(),
          unassignedAt: null,
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: created.id,
          action: "CREATED",
          performedBy: creatorAccountId,
          meta: {
            source,
            type,
            initialAssignment: initialAssignee,
            demoScheduledAt: demoDate ?? null,
          },
        },
      });

      let recipientAccountIds: string[] = [];

      if (assigneeAccountId) {
        recipientAccountIds = [assigneeAccountId];
      } else if (assigneeTeamId) {
        const members = await tx.teamMember.findMany({
          where: { teamId: assigneeTeamId, isActive: true },
          select: { accountId: true },
        });
        recipientAccountIds = members.map((m) => m.accountId);
      }

      return { lead: created, recipients: recipientAccountIds };
    });

    void triggerAssignmentNotification({
      leadId: lead.id,
      assigneeAccountId: assigneeAccountId ?? null,
      assigneeTeamId: assigneeTeamId ?? null,
    });

    try {
      const io = getIo();

      const socketPayload = {
        id: lead.id,
        customerName: lead.customerName,
        productTitle: lead.productTitle,
        status: lead.status,
        demoScheduledAt: lead.demoScheduledAt,
        demoCount: lead.demoCount,
        createdAt: lead.createdAt,
      };

      recipients.forEach((accountId) => {
        io.to(`leads:user:${accountId}`).emit("lead:created", socketPayload);
      });

      // optional admin dashboard room
      // io.to("leads:admin").emit("lead:created", socketPayload);
    } catch (e) {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Lead created successfully", lead);
  } catch (err: any) {
    console.error("Create lead error:", err);
    // Prisma common error handling
    if (err?.code === "P2002") {
      return sendErrorResponse(res, 400, "Duplicate customer/mobile");
    }
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
  }
}

/**
 * POST /admin/leads/:id/assign
 */
export async function assignLeadAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id } = req.params;
    const { accountId, teamId, remark } = req.body;

    const previousAssignment = await prisma.leadAssignment.findFirst({
      where: { leadId: id, isActive: true },
      include: {
        account: { select: { id: true, firstName: true, lastName: true } },
        team: { select: { id: true, name: true } },
      },
    });

    const fromSnapshot = previousAssignment
      ? previousAssignment.account
        ? {
            type: "ACCOUNT",
            id: previousAssignment.account.id,
            name: `${previousAssignment.account.firstName} ${previousAssignment.account.lastName}`,
          }
        : {
            type: "TEAM",
            id: previousAssignment.team!.id,
            name: previousAssignment.team!.name,
          }
      : null;

    const toSnapshot = await resolveAssigneeSnapshot({ accountId, teamId });

    const { recipients } = await prisma.$transaction(async (tx) => {
      await tx.leadAssignment.updateMany({
        where: { leadId: id, isActive: true },
        data: { isActive: false, unassignedAt: new Date() },
      });

      await tx.leadAssignment.create({
        data: {
          leadId: id,
          type: accountId ? "ACCOUNT" : "TEAM",
          accountId: accountId ?? null,
          teamId: teamId ?? null,
          remark,
          isActive: true,
          assignedBy: performerAccountId,
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "ASSIGN_CHANGED",
          performedBy: performerAccountId,
          meta: {
            from: fromSnapshot,
            to: toSnapshot,
            remark: remark ?? null,
          },
        },
      });

      let newRecipients: string[] = [];

      if (accountId) {
        newRecipients = [accountId];
      } else if (teamId) {
        const members = await tx.teamMember.findMany({
          where: { teamId, isActive: true },
          select: { accountId: true },
        });
        newRecipients = members.map((m) => m.accountId);
      }

      // include old account if existed
      const oldRecipients = previousAssignment?.accountId
        ? [previousAssignment.accountId]
        : [];

      return {
        recipients: [...new Set([...newRecipients, ...oldRecipients])],
      };
    });

    try {
      const io = getIo();

      const patchPayload = {
        id,
        patch: {
          assignment: toSnapshot,
          updatedAt: new Date(),
        },
      };

      recipients.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch (e) {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead reassigned");
  } catch (err) {
    console.error(err);
    return sendErrorResponse(res, 500, "Failed to reassign lead");
  }
}

/**
 * PATCH /admin/leads/:id
 */
export async function updateLeadAdmin(req: Request, res: Response) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const allowedFields = [
      "customerName",
      "mobileNumber",
      "status",
      "remark",
      "cost",
      "product",
      "productTitle",
      "demoScheduledAt",
    ];
    const data: Record<string, any> = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }

    // normalizations
    if (data.mobileNumber)
      data.mobileNumber = normalizeMobile(data.mobileNumber);
    if (data.product)
      data.productTitle = data.product.title ?? data.productTitle ?? null;
    if (data.productTitle === undefined && data.product?.title)
      data.productTitle = data.product.title;

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        statusMark: true,
        demoScheduledAt: true,
        demoDoneAt: true,
        demoCount: true,
        demoMeta: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    // prepare statusMark safely
    const statusMark = {
      ...(existing.statusMark as Record<string, boolean> | null),
    };

    if (data.status === "CLOSED") statusMark.close = true;
    if (data.status === "DEMO_DONE") {
      statusMark.demo = true;
      data.demoDoneAt = new Date();
    }
    if (data.status === "CONVERTED") {
      statusMark.converted = true;
      data.closedAt = new Date();
    }

    // only assign if something changed
    if (Object.keys(statusMark).length > 0) {
      data.statusMark = statusMark;
    }

    // -------------------------
    // Demo Reschedule Handling
    // -------------------------
    // if (data.demoScheduledAt) {
    //   const newDate = new Date(data.demoScheduledAt);

    //   if (
    //     !existing.demoScheduledAt ||
    //     existing.demoScheduledAt.getTime() !== newDate.getTime()
    //   ) {
    //     data.demoCount = { increment: 1 };
    //     data.demoRescheduledAt = new Date();
    //   }
    // }
    if (data.demoScheduledAt) {
      const newDate = new Date(data.demoScheduledAt);

      if (
        !existing.demoScheduledAt ||
        existing.demoScheduledAt.getTime() !== newDate.getTime()
      ) {
        data.demoCount = { increment: 1 };

        // Append to demoMeta history
        const existingMeta = (existing as any).demoMeta as any;
        // console.log("\n\n\n\n\n\n\n\n\n\nExisting:\n", existing);
        // console.log("\n\nExisting existingMeta:\n", existingMeta);
        const history = existingMeta?.history ?? [];
        // console.log("\n\nExisting demoMeta history:\n", history);
        
        data.demoMeta = {
          history: [
            ...history,
            {
              type: existing.demoScheduledAt ? "RESCHEDULED" : "SCHEDULED",
              at: newDate.toISOString(),
              by: performerAccountId,
            },
          ],
        };
      }
    }

    const diff: Record<string, any> = {};
    Object.keys(data).forEach((key) => {
      diff[key] = {
        from: (existing as any)[key] ?? null,
        to: data[key],
      };
    });

    const updated = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id },
        data: {
          ...data,
          closedAt:
            data.status === "CLOSED" || data.status === "CONVERTED"
              ? new Date()
              : undefined,
        },
        include: {
          assignments: {
            include: {
              account: true,
              team: true,
            },
          },
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "UPDATED",
          performedBy: performerAccountId,
          meta: {
            fromState: existing,
            toState: lead,
          },
        },
      });

      return lead;
    });

    // -------------------------
    // Resolve recipients
    // -------------------------
    let recipientAccountIds: string[] = [];

    if (existing.assignments[0]?.accountId) {
      recipientAccountIds = [existing.assignments[0].accountId];
    } else if (existing.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: existing.assignments[0].teamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds = members.map((m) => m.accountId);
    }

    try {
      const io = getIo();

      const patchPayload = {
        id,
        patch: {
          status: updated.status,
          demoScheduledAt: updated.demoScheduledAt,
          demoDoneAt: updated.demoDoneAt,
          demoCount: updated.demoCount,
          updatedAt: updated.updatedAt,
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch (e) {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead updated", updated);
  } catch (err: any) {
    console.error("Update lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update lead");
  }
}

/**
 * DELETE /admin/leads/:id   (soft close)
 */
export async function closeLeadAdmin(req: Request, res: Response) {
  try {
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const performerSnapshot =
      await resolvePerformerSnapshot(performerAccountId);

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        statusMark: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });

    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    if (existing.status === "CLOSED")
      return sendErrorResponse(res, 400, "Lead already closed");

    const updated = await prisma.$transaction(async (tx) => {
      const statusMark = {
        ...(existing.statusMark as Record<string, boolean> | null),
        close: true,
      };
      await tx.lead.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          isWorking: false,
          statusMark,
        },
      });

      // deactivate active assignments
      await tx.leadAssignment.updateMany({
        where: { leadId: id, isActive: true },
        data: {
          isActive: false,
          unassignedAt: new Date(),
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "CLOSED",
          performedBy: performerAccountId,
          meta: {
            closedBy: performerSnapshot,
            closedAt: new Date().toISOString(),
          },
        },
      });
    });

    // -------------------------
    // Resolve recipients
    // -------------------------
    let recipientAccountIds: string[] = [];

    if (existing.assignments[0]?.accountId) {
      recipientAccountIds = [existing.assignments[0].accountId];
    } else if (existing.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: existing.assignments[0].teamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds = members.map((m) => m.accountId);
    }

    try {
      const io = getIo();

      const patchPayload = {
        id,
        patch: {
          status: "CLOSED",
          isWorking: false,
          closedAt: new Date(),
          updatedAt: new Date(),
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead closed successfully");
  } catch (err: any) {
    console.error("Close lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to close lead");
  }
}

/**
 * GET /admin/leads
 * Fully optimized (DB-first ordering, minimal payload, no JS sorting)
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
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    /* -------------------------
       WHERE (index-friendly)
    ------------------------- */
    const where: any = {};

    if (status) where.status = status;
    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    /* -------------------------
       DEMO DATE FILTER (INDEXED)
    ------------------------- */

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

      if (demoStatus === "done") {
        where.demoDoneAt = { not: null };
      }

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
      where.OR = [
        { customerName: { contains: search, mode: "insensitive" } },
        { mobileNumber: { contains: search } },
        { productTitle: { contains: search, mode: "insensitive" } },
      ];
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

    /* -------------------------
       DB ORDERING (NO JS SORT)
       Priority:
       1. Working leads
       2. Status
       3. Newest first
    ------------------------- */
    const orderBy = [
      { isWorking: "desc" as const }, // indexed boolean
      { status: "asc" as const }, // enum index
      { createdAt: "desc" as const }, // btree index
    ];

    /* -------------------------
       QUERY (minimal payload)
    ------------------------- */
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
          cost: true,
          remark: true,
          isWorking: true,
          demoScheduledAt: true,
          demoDoneAt: true,
          demoCount: true,
          statusMark: true,
          totalWorkSeconds: true,
          createdAt: true,
          updatedAt: true,

          assignments: {
            where: { isActive: true },
            select: {
              id: true,
              type: true,
              isActive: true,
              assignedAt: true,
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                },
              },
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },

          leadHelpers: {
            where: { isActive: true },
            select: {
              role: true,
              isActive: true,
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
      }),
    ]);

    /* -------------------------
       RESPONSE
    ------------------------- */
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
    console.error("Optimized list leads error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
  }
}

/**
 * GET /admin/leads/:id
 * Fetch single lead detail (optimized)
 */
export async function getLeadByIdAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // console.log("\n\n\n\nLead ID param:", id);
    

    if (!id) {
      return sendErrorResponse(res, 400, "Lead ID is required");
    }

    const lead = await prisma.lead.findUnique({
      where: { id },

      select: {
        id: true,
        source: true,
        type: true,
        status: true,
        statusMark: true,

        demoScheduledAt: true,
        demoDoneAt: true,
        demoCount: true,
        demoMeta: true,

        customerName: true,
        mobileNumber: true,

        product: true,
        productTitle: true,
        cost: true,
        remark: true,

        isWorking: true,
        totalWorkSeconds: true,

        createdAt: true,
        updatedAt: true,
        closedAt: true,

        /* -------------------------
           ACTIVE ASSIGNMENTS
        ------------------------- */
        assignments: {
          where: { isActive: true },
          select: {
            id: true,
            type: true,
            remark: true,
            assignedAt: true,
            isActive: true,

            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactPhone: true,
              },
            },

            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },

        /* -------------------------
           ACTIVE HELPERS
        ------------------------- */
        leadHelpers: {
          where: { isActive: true },
          select: {
            role: true,
            addedAt: true,
            isActive: true,

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

    if (!lead) {
      return sendErrorResponse(res, 404, "Lead not found");
    }

    return sendSuccessResponse(res, 200, "Lead fetched", lead);
  } catch (err: any) {
    console.error("Get lead by ID error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead");
  }
}

/**
 * GET /admin/leads/:id/activity
 */
export async function getLeadActivityTimelineAdmin(
  req: Request,
  res: Response,
) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const { id } = req.params;
    const leadExists = await prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!leadExists) return sendErrorResponse(res, 404, "Lead not found");

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

    return sendSuccessResponse(res, 200, "Lead activity timeline fetched", {
      leadId: id,
      total: activity.length,
      activity,
    });
  } catch (err: any) {
    console.error("Admin lead activity timeline error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead activity",
    );
  }
}

/**
 * GET /admin/leads/stats/status
 * Optional filters: fromDate, toDate, source
 */
export async function getLeadCountByStatusAdmin(req: Request, res: Response) {
  try {
    const { fromDate, toDate, source, accountId } = req.query as Record<string, string>;

    const where: any = {};

    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    if (accountId) {
      where.assignments = {
        some: {
          accountId,
          isActive: true,
        },
      };
    }

    /**
     * Use groupBy (single DB roundtrip, very fast)
     */
    const grouped = await prisma.lead.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });

    /**
     * Normalize output to include all statuses
     */
    // PENDING
    // IN_PROGRESS
    // DEMO_DONE
    // INTERESTED
    // CONVERTED
    // CLOSED
    const result = {
      PENDING: 0,
      IN_PROGRESS: 0,
      DEMO_DONE: 0,
      CLOSED: 0,
      CONVERTED: 0,
      TOTAL: 0,
    };

    for (const row of grouped) {
      result[row.status as keyof typeof result] = row._count._all;
      result.TOTAL += row._count._all;
    }

    return sendSuccessResponse(res, 200, "Lead counts fetched", result);
  } catch (err: any) {
    console.error("Lead count by status error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead counts",
    );
  }
}

/**
 * POST /admin/leads/:id/helpers
 * Add helper/export employee to lead
 */
export async function addLeadHelperAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id: leadId } = req.params;
    const { accountId, role = "EXPORT" } = req.body;

    if (!accountId) {
      return sendErrorResponse(res, 400, "accountId is required");
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    const { helper } = await prisma.$transaction(async (tx) => {
      const upserted = await tx.leadHelper.upsert({
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

      const initialAssignee = await resolveAssigneeSnapshot({
        accountId: accountId,
      });

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "HELPER_ADDED",
          performedBy: performerAccountId,
          meta: {
            initialAssignment: initialAssignee,
            role,
          },
        },
      });

      return { helper: upserted };
    });

    let recipientAccountIds: string[] = [accountId]; // notify helper

    if (lead.assignments[0]?.accountId) {
      recipientAccountIds.push(lead.assignments[0].accountId);
    } else if (lead.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: lead.assignments[0].teamId, isActive: true },
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

    return sendSuccessResponse(res, 200, "Helper added to lead", helper);
  } catch (err: any) {
    console.error(err);
    return sendErrorResponse(res, 500, "Failed to add helper");
  }
}

/**
 * DELETE /admin/leads/:id/helpers/:accountId"
 * Remove helper/export employee from lead
 */
export async function removeLeadHelperAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    const { id: leadId, accountId } = req.params;

    if (!leadId || !accountId)
      return sendErrorResponse(res, 400, "Invalid parameters");

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
      where: { leadId, accountId, isActive: true },
    });

    if (!helper) return sendErrorResponse(res, 404, "Active helper not found");

    await prisma.$transaction(async (tx) => {
      await tx.leadHelper.updateMany({
        where: { leadId, accountId, isActive: true },
        data: { isActive: false, removedAt: new Date() },
      });
      const initialAssignee = await resolveAssigneeSnapshot({
        accountId: accountId,
      });

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "HELPER_REMOVED",
          performedBy: performerAccountId!,
          meta: { initialAssignment: initialAssignee },
        },
      });
    });

    let recipientAccountIds: string[] = [accountId]; // notify removed helper

    if (existingLead.assignments[0]?.accountId) {
      recipientAccountIds.push(existingLead.assignments[0].accountId);
    } else if (existingLead.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: existingLead.assignments[0].teamId, isActive: true },
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
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to remove helper");
  }
}
