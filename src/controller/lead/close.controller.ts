// src/controller/lead/close.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import { syncLeadFollowUpAggregates, 
    closeFollowUpsOnStatusChange,
    resolvePerformerSnapshot
} from "./utils";


/**
 * DELETE /admin/leads/:id  (soft close)
 */
export async function closeLeadAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const performerSnapshot = await resolvePerformerSnapshot(performerAccountId);

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        statusMark: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });

    if (!existing) return sendErrorResponse(res, 404, "Lead not found");
    if (existing.status === "CLOSED") return sendErrorResponse(res, 400, "Lead already closed");

    await prisma.$transaction(async (tx) => {
      const statusMark = {
        ...(existing.statusMark as Record<string, boolean> | null),
        close: true,
      };
      await tx.lead.update({
        where: { id },
        data: { status: "CLOSED", closedAt: new Date(), isWorking: false, statusMark },
      });

      await tx.leadAssignment.updateMany({
        where: { leadId: id, isActive: true },
        data: { isActive: false, unassignedAt: new Date() },
      });

      await closeFollowUpsOnStatusChange(tx, id, "CLOSED", performerAccountId);
      await syncLeadFollowUpAggregates(tx, id);

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "CLOSED",
          performedBy: performerAccountId,
          meta: { closedBy: performerSnapshot, closedAt: new Date().toISOString() },
        },
      });
    });

    let recipientAccountIds: string[] = [];
    if (existing.assignments[0]?.accountId) {
      recipientAccountIds = [existing.assignments[0].accountId];
    } else if (existing.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: existing.assignments[0].teamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds = members.map((m) => m.accountId);
    }

    try {
      const io = getIo();
      const patchPayload = {
        id,
        patch: { status: "CLOSED", isWorking: false, closedAt: new Date(), updatedAt: new Date() },
      };
      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });
      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead closed successfully");
  } catch (err: any) {
    console.error("Close lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to close lead");
  }
}
