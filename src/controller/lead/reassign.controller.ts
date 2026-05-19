// src/controller/lead/reassign.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import * as webpush from "web-push";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";
import {
    triggerAssignmentNotification,
} from "../../services/notifications";
import { getIo } from "../../core/utils/socket";

import {
    resolveAssigneeSnapshot
} from "./utils";


/**
 * POST /admin/leads/:id/assign
 */
export async function assignLeadAdmin(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;
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
                : { type: "TEAM", id: previousAssignment.team!.id, name: previousAssignment.team!.name }
            : null;

        const toSnapshot = await resolveAssigneeSnapshot({ accountId, teamId });

        const { recipients } = await prisma.$transaction(async (tx) => {
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
                    meta: { from: fromSnapshot, to: toSnapshot, remark: remark ?? null },
                },
            });

            let newRecipients: string[] = [];
            if (accountId) {
                newRecipients = [accountId];
            } else if (teamId) {
                const members = await tx.teamMember.findMany({
                    where: { teamId, isActive: true },
                    select: { accountId: true },
                });
                newRecipients = members.map((m) => m.accountId);
            }

            const oldRecipients = previousAssignment?.accountId
                ? [previousAssignment.accountId]
                : [];

            return { recipients: [...new Set([...newRecipients, ...oldRecipients])] };
        });

        try {
            const io = getIo();
            const patchPayload = { id, patch: { assignment: toSnapshot, updatedAt: new Date() } };
            recipients.forEach((accId) => {
                io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
            });
            io.to("leads:admin").emit("lead:patch", patchPayload);
        } catch {
            console.warn("Socket emit skipped");
        }

        void triggerAssignmentNotification({
            leadId: id,
            assigneeAccountId: accountId ?? null,
            assigneeTeamId: accountId ?? null,
        });

        return sendSuccessResponse(res, 200, "Lead reassigned");
    } catch (err) {
        console.error(err);
        return sendErrorResponse(res, 500, "Failed to reassign lead");
    }
}