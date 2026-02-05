// src/controller/admin/employeeBusyLog.controller.ts

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * GET /common/employees/:id/busy-logs
 * Get busy activity logs for an employee
 */
export async function getEmployeeBusyLogs(req: Request, res: Response) {
  try {
    const { id: accountId } = req.params;
    const {
      page = "1",
      limit = "20",
      from,
      to,
    } = req.query as Record<string, string>;

    if (!accountId) {
      return sendErrorResponse(res, 400, "Account ID is required");
    }

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);

    const where: any = { accountId };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [total, logs] = await prisma.$transaction([
      prisma.busyActivityLog.count({ where }),
      prisma.busyActivityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fromBusy: true,
          toBusy: true,
          reason: true,
          createdAt: true,
          account: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              designation: true,
            },
          },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Busy logs fetched", {
      data: logs.map((l) => ({
        id: l.id,
        fromBusy: l.fromBusy,
        toBusy: l.toBusy,
        reason: l.reason,
        createdAt: l.createdAt,
        employee: {
          id: l.account.id,
          name: `${l.account.firstName} ${l.account.lastName}`.trim(),
          designation: l.account.designation,
        },
      })),
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    console.error("getEmployeeBusyLogs error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch busy logs",
    );
  }
}
