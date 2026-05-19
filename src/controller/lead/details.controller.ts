// src/controller/lead/details.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * GET /admin/leads/:id
 */
export async function getLeadByIdAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!id) return sendErrorResponse(res, 400, "Lead ID is required");

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
        states: true,
        productTitle: true,
        cost: true,
        remark: true,
        isImportant: true,
        isWorking: true,
        totalWorkSeconds: true,
        productCatalogId: true,
        productCatalog: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
        assignments: {
          where: { isActive: true },
          select: {
            id: true,
            type: true,
            remark: true,
            assignedAt: true,
            isActive: true,
            account: {
              select: { id: true, firstName: true, lastName: true, avatar: true, designation: true, contactPhone: true },
            },
            team: { select: { id: true, name: true } },
          },
        },
        leadHelpers: {
          where: { isActive: true },
          select: {
            role: true,
            remark: true,
            addedAt: true,
            isActive: true,
            account: {
              select: { id: true, firstName: true, lastName: true, avatar: true, designation: true, contactPhone: true },
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
    });

    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    return sendSuccessResponse(res, 200, "Lead fetched", lead);
  } catch (err: any) {
    console.error("Get lead by ID error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead");
  }
}