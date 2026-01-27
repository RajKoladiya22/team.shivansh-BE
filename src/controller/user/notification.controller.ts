// src/controller/user/notification.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { log } from "console";

async function getAccountId(req: Request): Promise<string> {
  const userId = req.user?.id;
  if (!userId) throw new Error("Unauthorized");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountId: true },
  });
  if (!u?.accountId) throw new Error("Invalid account");
  return u?.accountId;
}

/**
 * GET /notifications
 * Query:
 *  - category
 *  - level
 *  - isRead (default false)
 *  - page, limit
 */
export async function listMyNotifications(req: Request, res: Response) {
  try {
    // const accountId = "a2b9611c-4536-43ef-90ef-c0571394c381";
    const accountId = await getAccountId(req);

    // log("\n\nQuery Params:", accountId);

    const {
      category,
      level,
      isRead = "all",
      page = "1",
      limit = "20",
      isHidden = "false",
    } = req.query;

    const where: any = {
      accountId,
    };

    if (isRead !== "all") where.isRead = isRead === "true";
    if (category) where.category = category;
    if (level) where.level = level;
    if (isHidden) where.isHidden = isHidden === "true" ? true : false;

    const skip = (Number(page) - 1) * Number(limit);

    // console.log("\nwhere-->\n", where);

    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.notification.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Notifications fetched", {
      items,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
      },
    });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * GET /notifications/:id
 * RULE: viewing detail → mark isRead = true
 */
export async function getMyNotificationById(req: Request, res: Response) {
  try {
    const accountId = await getAccountId(req);
    const { id } = req.params;

    const notification = await prisma.notification.findFirst({
      where: { id, accountId },
    });

    if (!notification)
      return sendErrorResponse(res, 404, "Notification not found");

    if (!notification.isRead) {
      await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });
    }

    return sendSuccessResponse(res, 200, "Notification fetched", notification);
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * PATCH /notifications/:id/read
 */
export async function markNotificationRead(req: Request, res: Response) {
  try {
    const accountId = await getAccountId(req);
    const { id } = req.params;

    await prisma.notification.updateMany({
      where: { id, accountId },
      data: { isRead: true },
    });

    return sendSuccessResponse(res, 200, "Marked as read");
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * PATCH /notifications/read-all
 */
export async function markAllNotificationsRead(req: Request, res: Response) {
  try {
    const accountId = await getAccountId(req);

    await prisma.notification.updateMany({
      where: { accountId, isRead: false },
      data: { isRead: true },
    });

    return sendSuccessResponse(res, 200, "All notifications marked as read");
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * PATCH /notifications/:id/hide
 */
export async function hideNotification(req: Request, res: Response) {
  try {
    const accountId = await getAccountId(req);
    const { id } = req.params;

    await prisma.notification.updateMany({
      where: { id, accountId },
      data: {
        isHidden: true,
        dismissedAt: new Date(),
      },
    });

    return sendSuccessResponse(res, 200, "Notification hidden");
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}

/**
 * GET /notifications/unread-count
 */
export async function getUnreadNotificationCount(req: Request, res: Response) {
  try {
    const accountId = await getAccountId(req);

    const count = await prisma.notification.count({
      where: {
        accountId,
        isRead: false,
        isHidden: false,
        // expiresAt: { gte: new Date() },
      },
    });

    return sendSuccessResponse(res, 200, "Unread count", { count });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err.message);
  }
}
