// src/controller/admin/employeeBusyLog.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";

/**
 * Helper: get accountId for the currently authenticated user
 */
const getAccountIdFromReqUser = async (userId?: string | null) => {
  if (!userId) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true },
  });
  return u?.accountId ?? null;
};

/**
 * Helper: parse pagination params from query
 */
function parsePagination(query: Record<string, any>) {
  const page = Math.max(Number(query.page) || 1, 1);
  let limit = Number(query.limit) || 20;
  if (limit <= 0) limit = 20;
  limit = Math.min(limit, 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Helper: convert ISO date string to start of day (00:00:00.000)
 */
function toStartOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Helper: convert ISO date string to end of day (23:59:59.999)
 */
function toEndOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Helper: Build Prisma createdAt filter.
 * - If startDate / endDate provided -> inclusive range (start of startDate .. end of endDate).
 * - Otherwise uses lastDays (default 5) and returns { gte: <date> }.
 */
function buildDateFilter(query: Record<string, any>) {
  const { startDate, endDate, lastDays } = query;

  // If either startDate or endDate provided, build inclusive range
  if (startDate || endDate) {
    const filter: any = {};
    try {
      if (startDate) filter.gte = toStartOfDay(new Date(startDate));
      if (endDate) filter.lte = toEndOfDay(new Date(endDate));
    } catch (e) {
      // invalid date - return null to indicate caller should handle
      return null;
    }
    return filter;
  }

  // fallback to lastDays (default 5)
  const days = lastDays ? Math.max(Number(lastDays), 0) : 5;
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { gte: from };
}

/**
 * Admin: Get busy logs for a specific account (route param :accountId)
 * Route example: GET /admin/accounts/:accountId/busy-logs
 * Query params:
 *  - startDate (ISO string, e.g. 2026-02-01)
 *  - endDate (ISO string)
 *  - lastDays (number)  // used only when startDate/endDate missing; default = 5
 *  - page, limit
 */
export async function getEmployeeBusyLogs(req: Request, res: Response) {
  try {
    // Admin check
    if (!req.user?.roles?.includes("ADMIN")) {
      return sendErrorResponse(res, 403, "Forbidden");
    }

    const accountId = req.params.accountId || req.params.id || req.params.id;
    if (!accountId) {
      return sendErrorResponse(res, 400, "Account ID is required");
    }

    const { page, limit, skip } = parsePagination(req.query as Record<string, any>);
    const dateFilter = buildDateFilter(req.query as Record<string, any>);
    if (dateFilter === null) {
      return sendErrorResponse(res, 400, "Invalid date format for startDate/endDate");
    }

    const where: any = { accountId };
    if (dateFilter) where.createdAt = dateFilter;

    // Use transaction for count + data
    const [total, logs] = await Promise.all([
      prisma.busyActivityLog.count({ where }),
      prisma.busyActivityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
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
              contactPhone: true,
            },
          },
        },
      }),
    ]);

    const data = logs.map((l) => ({
      id: l.id,
      fromBusy: l.fromBusy,
      toBusy: l.toBusy,
      reason: l.reason,
      createdAt: l.createdAt,
      employee: {
        id: l.account.id,
        name: `${l.account.firstName ?? ""} ${l.account.lastName ?? ""}`.trim(),
        designation: l.account.designation,
        contactPhone: l.account.contactPhone,
      },
    }));

    return sendSuccessResponse(res, 200, "Busy logs fetched", {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("getEmployeeBusyLogs error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch busy logs");
  }
}

/**
 * User: Get busy logs for the authenticated user's own account
 * Route example: GET /me/busy-logs
 * Accepts same query params as admin: startDate, endDate, lastDays, page, limit
 */
export async function getMyBusyLogs(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const accountId = await getAccountIdFromReqUser(userId);
    if (!accountId) return sendErrorResponse(res, 401, "Invalid user");

    const { page, limit, skip } = parsePagination(req.query as Record<string, any>);
    const dateFilter = buildDateFilter(req.query as Record<string, any>);
    if (dateFilter === null) {
      return sendErrorResponse(res, 400, "Invalid date format for startDate/endDate");
    }

    const where: any = { accountId };
    if (dateFilter) where.createdAt = dateFilter;

    const [total, logs] = await prisma.$transaction([
      prisma.busyActivityLog.count({ where }),
      prisma.busyActivityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          fromBusy: true,
          toBusy: true,
          reason: true,
          createdAt: true,
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "My busy logs fetched", {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    console.error("getMyBusyLogs error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch busy logs");
  }
}
