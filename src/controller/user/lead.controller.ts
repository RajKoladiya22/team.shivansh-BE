// src/controller/lead/lead.user.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

export async function listMyLeads(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: accountId },
      select: { accountId: true },
    });

    if (!user) {
      return sendErrorResponse(res, 401, "Invalid session user");
    }

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
            { accountId: user.accountId },
            {
              team: {
                members: {
                  some: { accountId: user.accountId },
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
        {
          product: {
            path: ["title"],
            string_contains: search,
          },
        },
      ];
    }

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder === "asc" ? "asc" : "desc";

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
  } catch (err) {
    console.error("List my leads error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch leads");
  }
}

export async function getMyLeadById(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: accountId },
      select: { accountId: true },
    });

    if (!user) {
      return sendErrorResponse(res, 401, "Invalid session user");
    }

    const lead = await prisma.lead.findFirst({
      where: {
        id,
        assignments: {
          some: {
            isActive: true,
            OR: [
              { accountId: user.accountId },
              {
                team: {
                  members: {
                    some: { accountId: user.accountId },
                  },
                },
              },
            ],
          },
        },
      },
      include: {
        assignments: {
          where: { isActive: true },
          include: { account: true, team: true },
        },
      },
    });

    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    return sendSuccessResponse(res, 200, "Lead fetched", lead);
  } catch {
    return sendErrorResponse(res, 500, "Failed to fetch lead");
  }
}

export async function updateMyLeadStatus(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    const { id } = req.params;
    const { status, remark } = req.body;

    if (!status && !remark)
      return sendErrorResponse(res, 400, "Nothing to update");

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
                  members: { some: { accountId } },
                },
              },
            ],
          },
        },
      },
    });

    if (!lead) return sendErrorResponse(res, 403, "Access denied");

    const updated = await prisma.$transaction(async (tx) => {
      const updatedLead = await tx.lead.update({
        where: { id },
        data: {
          status,
          remark,
          closedAt:
            status === "CLOSED" || status === "CONVERTED"
              ? new Date()
              : undefined,
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "STATUS_CHANGED",
          performedBy: accountId,
          meta: { status, remark },
        },
      });

      return updatedLead;
    });

    return sendSuccessResponse(res, 200, "Lead updated", updated);
  } catch (err) {
    console.error("Update lead status error:", err);
    return sendErrorResponse(res, 500, "Failed to update lead");
  }
}

export async function getMyLeadActivity(req: Request, res: Response) {
  try {
    const accountId = req.user?.id;
    const { id } = req.params;

    const hasAccess = await prisma.lead.findFirst({
      where: {
        id,
        assignments: {
          some: {
            isActive: true,
            OR: [
              { accountId },
              {
                team: {
                  members: { some: { accountId } },
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
    });

    return sendSuccessResponse(res, 200, "Activity fetched", activity);
  } catch {
    return sendErrorResponse(res, 500, "Failed to fetch activity");
  }
}
