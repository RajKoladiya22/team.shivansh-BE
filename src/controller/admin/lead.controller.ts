// src/controller/admin/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { randomUUID } from "crypto";
import { triggerAssignmentNotification } from "../../services/notifications";

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
        data: { status: "CLOSED", closedAt: new Date() },
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

    return sendSuccessResponse(res, 200, "Lead closed");
  } catch (err: any) {
    console.error("Close lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to close lead");
  }
}

/**
 * GET /admin/leads
 * Filters: status, source, search, assignedTo, fromDate, toDate, helperAccountId, helperRole
 * Sorting, pagination
 */
export async function listLeadsAdmin(req: Request, res: Response) {
  try {
    const {
      status,
      source,
      search,
      assignedTo,
      helperAccountId, // ✅ NEW
      helperRole, // ✅ NEW
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
       ✅ Lead Helper Filter
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

    // ensure sortBy is safe - restrict to allowed columns to avoid SQL injection via Prisma (basic)
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

    // const [total, leads] = await prisma.$transaction([
    //   prisma.lead.count({ where }),
    //   prisma.lead.findMany({
    //     where,
    //     include: {
    //       // only include the currently active assignment for display
    //       assignments: {
    //         where: { isActive: true },
    //         include: {
    //           account: {
    //             select: {
    //               id: true,
    //               firstName: true,
    //               lastName: true,
    //               contactPhone: true,
    //             },
    //           },
    //           team: { select: { id: true, name: true } },
    //         },
    //       },
    //     },
    //     orderBy,
    //     skip: (pageNumber - 1) * pageSize,
    //     take: pageSize,
    //   }),
    // ]);

    const [total, leads] = await prisma.$transaction([
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
                },
              },
              team: { select: { id: true, name: true } },
            },
          },

          /* ✅ Active helpers */
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

    return sendSuccessResponse(res, 200, "Helper removed");
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to remove helper");
  }
}
