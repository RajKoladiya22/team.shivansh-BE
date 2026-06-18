import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";

function getAdminRoles(roles: string[]): boolean {
  const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "MANAGER", "SALES"];
  return roles.some((r) => ADMIN_ROLES.includes(r.toUpperCase()));
}

export async function getDashboardTasksWidget(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");
    
    const now = new Date();
    
    const upcoming = await prisma.task.findMany({
      where: {
        assignments: { some: { accountId } },
        dueDate: { gte: now },
        status: { notIn: ["COMPLETED", "CANCELLED"] }
      },
      orderBy: { dueDate: 'asc' },
      take: 5
    });

    const overdue = await prisma.task.findMany({
      where: {
        assignments: { some: { accountId } },
        dueDate: { lt: now },
        status: { notIn: ["COMPLETED", "CANCELLED"] }
      },
      orderBy: { dueDate: 'desc' },
      take: 5
    });

    return sendSuccessResponse(res, 200, "Tasks fetched successfully", {
      upcoming,
      overdue
    });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message || "Failed to fetch tasks widget");
  }
}

export async function getDashboardQuotationsWidget(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    const roles: string[] = req.user?.roles ?? [];
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");
    
    const isAdmin = getAdminRoles(roles);
    
    const baseWhere = isAdmin ? { deletedAt: null } : { createdBy: accountId, deletedAt: null };

    const recent = await prisma.quotation.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        customer: { select: { name: true, mobile: true } },
      }
    });

    const stats = await prisma.quotation.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: true,
      _sum: {
        grandTotal: true
      }
    });

    return sendSuccessResponse(res, 200, "Quotations fetched successfully", {
      recent,
      stats
    });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message || "Failed to fetch quotations widget");
  }
}

export async function getDashboardRemindersWidget(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");
    
    const now = new Date();
    const upcomingTasks = await prisma.task.findMany({
      where: {
        assignments: { some: { accountId } },
        dueDate: { gte: now },
        status: { notIn: ["COMPLETED", "CANCELLED"] }
      },
      orderBy: { dueDate: 'asc' },
      take: 3
    });

    const followUps = await prisma.leadFollowUp.findMany({
      where: {
        createdBy: accountId,
        status: { notIn: ["DONE", "MISSED", "RESCHEDULED"] },
        scheduledAt: { gte: now }
      },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
      include: {
        lead: { select: { id: true, customerCompanyName: true, customerName: true } }
      }
    });

    return sendSuccessResponse(res, 200, "Reminders fetched successfully", {
      tasks: upcomingTasks,
      followUps
    });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message || "Failed to fetch reminders widget");
  }
}

export async function getDashboardTDLWidget(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");
    
    const expertise = await prisma.userProductExpertise.findMany({
      where: { userId: accountId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        productCatalog: true
      }
    });

    return sendSuccessResponse(res, 200, "TDL fetched successfully", {
      expertise
    });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message || "Failed to fetch TDL widget");
  }
}

export async function getDashboardNotificationsWidget(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");
    
    const notifications = await prisma.notification.findMany({
      where: {
        accountId,
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    const unreadCount = await prisma.notification.count({
      where: {
        accountId,
        isRead: false
      }
    });

    return sendSuccessResponse(res, 200, "Notifications fetched successfully", {
      notifications,
      unreadCount
    });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message || "Failed to fetch notifications widget");
  }
}

export async function getDashboardAdminMonitoringWidget(req: Request, res: Response) {
  try {
    const roles: string[] = req.user?.roles ?? [];
    if (!getAdminRoles(roles)) return sendErrorResponse(res, 403, "Forbidden");

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const activeUsers = await prisma.account.count({
      where: { isActive: true }
    });

    const checkInsToday = await prisma.attendanceLog.count({
      where: {
        date: startOfToday,
        firstCheckIn: { not: null }
      }
    });

    const recentActivities = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    return sendSuccessResponse(res, 200, "Admin monitoring fetched successfully", {
      activeUsers,
      checkInsToday,
      recentActivities
    });
  } catch (error: any) {
    return sendErrorResponse(res, 500, error.message || "Failed to fetch admin monitoring widget");
  }
}
