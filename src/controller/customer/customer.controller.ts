import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * GET /admin/customers
 */
export async function getCustomerListAdmin(req: Request, res: Response) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const search = String(req.query.search ?? "").trim();
    const isActive =
      req.query.isActive !== undefined
        ? req.query.isActive === "true"
        : undefined;

    const where: any = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { mobile: { contains: search } },
          { normalizedMobile: { contains: search.replace(/\D/g, "") } },
        ],
      }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          mobile: true,
          normalizedMobile: true,
          isActive: true,
          createdAt: true,
          _count: {
            select: { leads: true },
          },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Customers fetched", {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err: any) {
    console.error("Get customers error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch customers",
    );
  }
}

/**
 * GET /admin/customers/:id
 */
export async function getCustomerDetailsAdmin(req: Request, res: Response) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    if (!req.user?.roles?.includes?.("ADMIN"))
      return sendErrorResponse(res, 403, "Admin access required");

    const { id } = req.params;
    if (!id) return sendErrorResponse(res, 400, "Customer id is required");

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        leads: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            source: true,
            type: true,
            status: true,
            productTitle: true,
            cost: true,
            createdAt: true,
            closedAt: true,
          },
        },
        createdByAcc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!customer) return sendErrorResponse(res, 404, "Customer not found");

    return sendSuccessResponse(res, 200, "Customer details fetched", customer);
  } catch (err: any) {
    console.error("Get customer details error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch customer details",
    );
  }
}
