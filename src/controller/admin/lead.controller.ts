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
const getAccountIdFromReqUser = async (userId?: string | null) => {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true },
  });
  return u?.accountId ?? null;
};

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
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    // guard: admin
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const creatorAccountId = await getAccountIdFromReqUser(adminUserId);
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
    } = req.body as Record<string, any>;

    const userId = await getUserIdFromAccountId(assigneeAccountId);

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
    const newLead = await prisma.$transaction(async (tx) => {
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
          },
        },
      });

      return created;
    });

    // fire-and-forget notification (non-blocking)
    // void triggerAssignmentNotification({
    //   leadId: newLead.id,
    //   assigneeAccountId: userId ?? null,
    //   assigneeTeamId: assigneeTeamId ?? null,
    // });

    void triggerAssignmentNotification({
      leadId: newLead.id,
      assigneeAccountId: assigneeAccountId ?? null,
      assigneeTeamId: assigneeTeamId ?? null,
    });

    return sendSuccessResponse(res, 201, "Lead created successfully", newLead);
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
    const performerAccountId = await getAccountIdFromReqUser(req.user?.id);
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

    await prisma.$transaction(async (tx) => {
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
    });

    const io = getIo();
    io.to(`lead:${id}`).emit("lead:assignment-changed", {
      leadId: id,
    });

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

    const performerAccountId = await getAccountIdFromReqUser(adminUserId);
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

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    // prepare statusMark safely
    const statusMark = {
      ...(existing.statusMark as Record<string, boolean> | null),
    };

    if (data.status === "CLOSED") {
      statusMark.close = true;
    }

    if (data.status === "DEMO_DONE") {
      statusMark.demo = true;
    }

    if (data.status === "CONVERTED") {
      statusMark.converted = true;
    }

    // only assign if something changed
    if (Object.keys(statusMark).length > 0) {
      data.statusMark = statusMark;
    }

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

    const io = getIo();
    io.to(`lead:${id}`).emit("lead:updated", {
      leadId: updated.id,
      status: updated.status,
      isWorking: updated.isWorking,
      updatedAt: updated.updatedAt,
    });

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
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");
    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const performerAccountId = await getAccountIdFromReqUser(adminUserId);
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const performerSnapshot =
      await resolvePerformerSnapshot(performerAccountId);

    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          remark: "not interested",
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

    const io = getIo();
    io.to(`lead:${id}`).emit("lead:closed", {
      leadId: id,
      status: "CLOSED",
    });

    return sendSuccessResponse(res, 200, "Lead closed");
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
          createdAt: true,
          updatedAt: true,

          assignments: {
            where: { isActive: true },
            select: {
              id: true,
              type: true,
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

export async function listLeadsAdmins(req: Request, res: Response) {
  try {
    const {
      status,
      source,
      search,
      assignedTo,
      helperAccountId,
      helperRole,
      fromDate,
      toDate,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page || 1), 1);
    const pageSize = Math.min(Number(limit || 20), 100);

    const where: any = {};

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

    if (assignedTo) {
      where.assignments = {
        some: {
          isActive: true,
          OR: [
            {
              account: {
                OR: [
                  { firstName: { contains: assignedTo, mode: "insensitive" } },
                  { lastName: { contains: assignedTo, mode: "insensitive" } },
                ],
              },
            },
            {
              team: {
                name: { contains: assignedTo, mode: "insensitive" },
              },
            },
          ],
        },
      };
    }

    /* ---------------------
       Lead Helper Filter
    --------------------- */
    if (helperAccountId || helperRole) {
      where.leadHelpers = {
        some: {
          isActive: true,
          ...(helperAccountId ? { accountId: helperAccountId } : {}),
          ...(helperRole ? { role: helperRole as any } : {}),
        },
      };
    }

    // Ensure sortBy is safe - restrict to allowed columns
    const allowedSortFields = new Set([
      "createdAt",
      "updatedAt",
      "closedAt",
      "customerName",
      "status",
    ]);
    const sortField = allowedSortFields.has(sortBy) ? sortBy : "createdAt";
    // const orderBy: any = {};
    const orderBy = [
      { isWorking: "desc" as const }, // indexed boolean
      { status: "asc" as const }, // enum index
      { createdAt: "desc" as const }, // btree index
    ];

    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy,
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: {
          /* Active assignment */
          assignments: {
            where: { isActive: true },
            include: {
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                  activeLeadId: true, // ✅ Include to check if working
                },
              },
              team: { select: { id: true, name: true } },
            },
          },

          /* Active helpers */
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
      }),
    ]);

    // // ✅ Status priority map
    // const STATUS_PRIORITY: Record<string, number> = {
    //   PENDING: 1,
    //   IN_PROGRESS: 2,
    //   DEMO_DONE: 2.5,
    //   CONVERTED: 3,
    //   CLOSED: 4,
    // };

    // // ✅ Smart sorting: Working leads first, then by status priority
    // leads.sort((a, b) => {
    //   // Check if lead A is being worked on
    //   const isAWorking = a.assignments?.some(
    //     (assignment) => assignment.account?.activeLeadId === a.id,
    //   );

    //   // Check if lead B is being worked on
    //   const isBWorking = b.assignments?.some(
    //     (assignment) => assignment.account?.activeLeadId === b.id,
    //   );

    //   // 1️⃣ Working leads always come first
    //   if (isAWorking && !isBWorking) return -1;
    //   if (!isAWorking && isBWorking) return 1;

    //   // 2️⃣ Both working or both not working → sort by status priority
    //   const aPriority = STATUS_PRIORITY[a.status] ?? 99;
    //   const bPriority = STATUS_PRIORITY[b.status] ?? 99;

    //   if (aPriority !== bPriority) {
    //     return aPriority - bPriority;
    //   }

    //   // 3️⃣ Same status → maintain DB sort order (by sortBy field)
    //   return 0;
    // });

    // // ✅ Add isWorking flag to each lead
    // const leadsWithWorkingFlag = leads.map((lead) => {
    //   const isWorking = lead.assignments?.some(
    //     (assignment) => assignment.account?.activeLeadId === lead.id,
    //   );

    //   return {
    //     ...lead,
    //     isWorking,
    //     // Clean up activeLeadId from account object (don't expose to frontend)
    //     assignments: lead.assignments?.map((assignment) => ({
    //       ...assignment,
    //       account: assignment.account
    //         ? {
    //             id: assignment.account.id,
    //             firstName: assignment.account.firstName,
    //             lastName: assignment.account.lastName,
    //             contactPhone: assignment.account.contactPhone,
    //           }
    //         : null,
    //     })),
    //   };
    // });

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
    if (err?.code === "P2021" || err?.code === "P2022") {
      return sendErrorResponse(
        res,
        500,
        "Database schema mismatch. Run Prisma migration.",
      );
    }
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
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
    // guard: admin
    if (!req.user?.roles?.includes?.("ADMIN")) {
      return sendErrorResponse(res, 403, "Admin access required");
    }

    const { fromDate, toDate, source } = req.query as Record<string, string>;

    const where: any = {};

    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
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
    const result = {
      PENDING: 0,
      IN_PROGRESS: 0,
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
    if (!req.user?.roles?.includes?.("ADMIN")) {
      return sendErrorResponse(res, 403, "Admin access required");
    }

    const performerAccountId = await getAccountIdFromReqUser(req.user?.id);
    if (!performerAccountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id: leadId } = req.params;
    const { accountId, role = "SUPPORT" } = req.body;

    if (!accountId) {
      return sendErrorResponse(res, 400, "accountId is required");
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

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

    await prisma.leadActivityLog.create({
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

    const io = getIo();
    io.to(`lead:${leadId}`).emit("lead:helpers-updated", {
      leadId,
    });

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
    if (!req.user?.roles?.includes?.("ADMIN")) {
      return sendErrorResponse(res, 403, "Admin access required");
    }

    const performerAccountId = await getAccountIdFromReqUser(req.user?.id);
    const { id: leadId, accountId } = req.params;

    await prisma.leadHelper.updateMany({
      where: { leadId, accountId, isActive: true },
      data: { isActive: false, removedAt: new Date() },
    });

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: accountId,
    });

    await prisma.leadActivityLog.create({
      data: {
        leadId,
        action: "HELPER_REMOVED",
        performedBy: performerAccountId!,
        meta: { initialAssignment: initialAssignee },
      },
    });

    const io = getIo();
    io.to(`lead:${leadId}`).emit("lead:helpers-updated", {
      leadId,
    });

    return sendSuccessResponse(res, 200, "Helper removed");
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to remove helper");
  }
}

/**
 * GET /admin/leads
 * Filters: status, source, search, assignedTo, fromDate, toDate, helperAccountId, helperRole
 * Sorting, pagination
 *
 * Priority sorting:
 * 1. Working leads (leads being actively worked on by any account)
 * 2. PENDING leads
 * 3. IN_PROGRESS leads
 * 4. CLOSED/CONVERTED leads
 */

// export async function listLeadsAdmin(req: Request, res: Response) {
//   try {
//     const {
//       status,
//       source,
//       search,
//       assignedTo,
//       helperAccountId,
//       helperRole,
//       fromDate,
//       toDate,
//       sortBy = "createdAt",
//       sortOrder = "desc",
//       page = "1",
//       limit = "20",
//     } = req.query as Record<string, string>;

//     const pageNumber = Math.max(Number(page || 1), 1);
//     const pageSize = Math.min(Number(limit || 20), 100);

//     const where: any = {};

//     if (status) where.status = status;
//     if (source) where.source = source;

//     if (fromDate || toDate) {
//       where.createdAt = {};
//       if (fromDate) where.createdAt.gte = new Date(fromDate);
//       if (toDate) where.createdAt.lte = new Date(toDate);
//     }

//     if (search) {
//       where.OR = [
//         { customerName: { contains: search, mode: "insensitive" } },
//         { mobileNumber: { contains: search } },
//         { productTitle: { contains: search, mode: "insensitive" } },
//       ];
//     }

//     if (assignedTo) {
//       where.assignments = {
//         some: {
//           isActive: true,
//           OR: [
//             {
//               account: {
//                 OR: [
//                   { firstName: { contains: assignedTo, mode: "insensitive" } },
//                   { lastName: { contains: assignedTo, mode: "insensitive" } },
//                 ],
//               },
//             },
//             {
//               team: {
//                 name: { contains: assignedTo, mode: "insensitive" },
//               },
//             },
//           ],
//         },
//       };
//     }

//     /* ---------------------
//        Lead Helper Filter
//     --------------------- */
//     if (helperAccountId || helperRole) {
//       where.leadHelpers = {
//         some: {
//           isActive: true,
//           ...(helperAccountId ? { accountId: helperAccountId } : {}),
//           ...(helperRole ? { role: helperRole as any } : {}),
//         },
//       };
//     }

//     // Ensure sortBy is safe - restrict to allowed columns
//     const allowedSortFields = new Set([
//       "createdAt",
//       "updatedAt",
//       "closedAt",
//       "customerName",
//       "status",
//     ]);
//     const sortField = allowedSortFields.has(sortBy) ? sortBy : "createdAt";
//     const orderBy: any = {};
//     orderBy[sortField] = sortOrder === "asc" ? "asc" : "desc";

//     const [total, leads] = await Promise.all([
//       prisma.lead.count({ where }),
//       prisma.lead.findMany({
//         where,
//         orderBy,
//         skip: (pageNumber - 1) * pageSize,
//         take: pageSize,
//         include: {
//           /* Active assignment */
//           assignments: {
//             where: { isActive: true },
//             include: {
//               account: {
//                 select: {
//                   id: true,
//                   firstName: true,
//                   lastName: true,
//                   contactPhone: true,
//                   activeLeadId: true, // ✅ Include to check if working
//                 },
//               },
//               team: { select: { id: true, name: true } },
//             },
//           },

//           /* Active helpers */
//           leadHelpers: {
//             where: { isActive: true },
//             include: {
//               account: {
//                 select: {
//                   id: true,
//                   firstName: true,
//                   lastName: true,
//                   designation: true,
//                   contactPhone: true,
//                 },
//               },
//             },
//           },
//         },
//       }),
//     ]);

//     // ✅ Status priority map
//     const STATUS_PRIORITY: Record<string, number> = {
//       PENDING: 1,
//       IN_PROGRESS: 2,
//       DEMO_DONE: 2.5,
//       CONVERTED: 3,
//       CLOSED: 4,
//     };

//     // ✅ Smart sorting: Working leads first, then by status priority
//     leads.sort((a, b) => {
//       // Check if lead A is being worked on
//       const isAWorking = a.assignments?.some(
//         (assignment) => assignment.account?.activeLeadId === a.id,
//       );

//       // Check if lead B is being worked on
//       const isBWorking = b.assignments?.some(
//         (assignment) => assignment.account?.activeLeadId === b.id,
//       );

//       // 1️⃣ Working leads always come first
//       if (isAWorking && !isBWorking) return -1;
//       if (!isAWorking && isBWorking) return 1;

//       // 2️⃣ Both working or both not working → sort by status priority
//       const aPriority = STATUS_PRIORITY[a.status] ?? 99;
//       const bPriority = STATUS_PRIORITY[b.status] ?? 99;

//       if (aPriority !== bPriority) {
//         return aPriority - bPriority;
//       }

//       // 3️⃣ Same status → maintain DB sort order (by sortBy field)
//       return 0;
//     });

//     // ✅ Add isWorking flag to each lead
//     const leadsWithWorkingFlag = leads.map((lead) => {
//       const isWorking = lead.assignments?.some(
//         (assignment) => assignment.account?.activeLeadId === lead.id,
//       );

//       return {
//         ...lead,
//         isWorking,
//         // Clean up activeLeadId from account object (don't expose to frontend)
//         assignments: lead.assignments?.map((assignment) => ({
//           ...assignment,
//           account: assignment.account
//             ? {
//                 id: assignment.account.id,
//                 firstName: assignment.account.firstName,
//                 lastName: assignment.account.lastName,
//                 contactPhone: assignment.account.contactPhone,
//               }
//             : null,
//         })),
//       };
//     });

//     return sendSuccessResponse(res, 200, "Leads fetched", {
//       data: leadsWithWorkingFlag,
//       meta: {
//         page: pageNumber,
//         limit: pageSize,
//         total,
//         totalPages: Math.ceil(total / pageSize),
//         hasNext: pageNumber * pageSize < total,
//         hasPrev: pageNumber > 1,
//       },
//     });
//   } catch (err: any) {
//     console.error("List leads error:", err);
//     if (err?.code === "P2021" || err?.code === "P2022") {
//       return sendErrorResponse(
//         res,
//         500,
//         "Database schema mismatch. Run Prisma migration.",
//       );
//     }
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
//   }
// }
