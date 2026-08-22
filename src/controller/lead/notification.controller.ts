// src/controller/lead/notification.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { sendLeadWhatsAppNotificationDirect } from "../../services/notifications";
import { getIo } from "../../core/utils/socket";

/**
 * POST /admin/leads/:id/notifications/whatsapp/resend
 * POST /leads/:id/notifications/whatsapp/resend
 */
export async function resendLeadWhatsAppNotification(req: Request, res: Response) {
  try {
    const userAccountId = req.user?.accountId;
    if (!userAccountId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const { id } = req.params;
    const { recipientType } = req.body as { recipientType?: "CUSTOMER" | "TEAM_MEMBER" };

    if (!recipientType || !["CUSTOMER", "TEAM_MEMBER"].includes(recipientType)) {
      return sendErrorResponse(res, 400, "Valid recipientType ('CUSTOMER' or 'TEAM_MEMBER') is required");
    }

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });

    if (!lead) {
      return sendErrorResponse(res, 404, "Lead not found");
    }

    // Role / Authorization check:
    // 1. Check if user is ADMIN or SALES
    const userRoles = await prisma.userRole.findMany({
      where: { user: { accountId: userAccountId } },
      include: { role: true },
    });
    const roleNames = userRoles.map((r) => r.role.name.toUpperCase());
    const isPrivileged = roleNames.includes("ADMIN") || roleNames.includes("SALES");

    if (!isPrivileged) {
      // 2. Check if user is lead creator
      const isCreator = lead.createdBy === userAccountId;

      // 3. Check if user is assigned to lead or assigned team
      const isDirectAssignee = lead.assignments.some((a) => a.accountId === userAccountId);
      let isTeamAssignee = false;
      if (!isDirectAssignee) {
        const assignedTeamIds = lead.assignments.map((a) => a.teamId).filter(Boolean) as string[];
        if (assignedTeamIds.length > 0) {
          const isMember = await prisma.teamMember.findFirst({
            where: {
              accountId: userAccountId,
              teamId: { in: assignedTeamIds },
              isActive: true,
            },
          });
          if (isMember) isTeamAssignee = true;
        }
      }

      if (!isCreator && !isDirectAssignee && !isTeamAssignee) {
        return sendErrorResponse(res, 403, "You do not have permission to trigger notifications for this lead");
      }
    }

    const result = await sendLeadWhatsAppNotificationDirect({
      leadId: id,
      recipientType,
      performedByAccountId: userAccountId,
    });

    // Fetch the latest activity log for this action to return to client
    const latestActivity = await prisma.leadActivityLog.findFirst({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      include: {
        performedByAccount: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            designation: true,
            contactPhone: true,
          },
        },
      },
    });

    try {
      const io = getIo();
      io.to(`leads:detail:${id}`).emit("lead:activity", latestActivity);
    } catch {
      // Ignore socket errors
    }

    if (!result.success) {
      return sendErrorResponse(res, 400, result.message, {
        status: result.status,
        activity: latestActivity,
      });
    }

    return sendSuccessResponse(res, 200, result.message, {
      status: result.status,
      activity: latestActivity,
    });
  } catch (err: any) {
    console.error("Resend WhatsApp notification error:", err);
    return sendErrorResponse(res, 500, err?.message || "Failed to trigger WhatsApp notification");
  }
}
