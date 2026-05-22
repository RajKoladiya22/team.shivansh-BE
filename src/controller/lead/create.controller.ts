// src/controller/lead/create.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import { Lead_Status } from "@prisma/client";
import { randomUUID } from "crypto";
import {
  ServerNotificationPayload,
  triggerAssignmentNotification,
  triggerHelperNotification,
} from "../../services/notifications";
import {
  syncLeadFollowUpAggregates,
  closeFollowUpsOnStatusChange, createLeadCore, deriveLeadScalars,
  findDuplicateLead, LeadProductItem, normalizeIncomingProducts, normalizeLeadProducts,
  normalizeMobile, resolveAssigneeSnapshot, resolvePerformerSnapshot, resolveProductCatalogId,
  syncLeadProductToCustomer, syncProductCostToEntities, upsertCustomerProduct
} from "./utils";
import * as webpush from "web-push";



// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CONTROLLER ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /admin/leads
 */
export async function createLeadAdmin(req: Request, res: Response) {
  try {
    const creatorAccountId = req.user?.accountId;
    if (!creatorAccountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      source = "MANUAL",
      type = "LEAD",
      customerName,
      mobileNumber,
      customerCompanyName,
      cost,
      remark,
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
      demoDate,
      followUps,
      customerCategory,
      businessCategory,
      state,
      city,
      tallySerial,
      tallyVersion,
      isImportant,
      forceCreate = false,
    } = req.body as Record<string, any>;

    if (!source || !type)
      return sendErrorResponse(res, 400, "Lead source and type are required");
    if (!customerName || !mobileNumber)
      return sendErrorResponse(res, 400, "Customer name and mobile are required");
    if (!assigneeAccountId && !assigneeTeamId)
      return sendErrorResponse(res, 400, "Assign to account or team");
    if (assigneeAccountId && assigneeTeamId)
      return sendErrorResponse(res, 400, "Provide either accountId or teamId, not both");

    const normalizedMobile = normalizeMobile(mobileNumber);
    const products = normalizeIncomingProducts(req.body);
    const { productTitle, totalCost } = deriveLeadScalars(products, cost);

    if (!forceCreate) {
      const duplicate = await findDuplicateLead({ normalizedMobile, productTitle });

      if (duplicate) {
        const assigneeName = duplicate.assignments[0]?.account
          ? `${duplicate.assignments[0].account.firstName} ${duplicate.assignments[0].account.lastName}`.trim()
          : null;

        return res.status(409).json({
          success: false,
          code: "DUPLICATE_LEAD",
          message: "An active lead already exists for this customer and product.",
          data: {
            existingLead: {
              id: duplicate.id,
              status: duplicate.status,
              customerName: duplicate.customerName,
              productTitle: duplicate.productTitle,
              createdAt: duplicate.createdAt,
              assignedTo: assigneeName,
            },
            hint: "Send { forceCreate: true } to create anyway.",
          },
        });
      }
    }

    const { lead, recipients, createdFollowUps } = await createLeadCore(
      creatorAccountId,
      {
        source,
        type,
        customerName,
        mobileNumber,
        customerCompanyName,
        cost,
        remark,
        assigneeAccountId,
        assigneeTeamId,
        demoDate,
        followUps,
        customerCategory,
        businessCategory,
        state,
        city,
        tallySerial,
        tallyVersion,
        isImportant: isImportant === true,
        forceCreate,
        products: products ?? undefined,
      },
    );

    void triggerAssignmentNotification({
      leadId: lead.id,
      assigneeAccountId: assigneeAccountId ?? null,
      assigneeTeamId: assigneeTeamId ?? null,
    });

    try {
      const io = getIo();
      const socketPayload = {
        id: lead.id,
        customerName: lead.customerName,
        productTitle: lead.productTitle,
        status: lead.status,
        demoScheduledAt: lead.demoScheduledAt,
        demoCount: lead.demoCount,
        createdAt: lead.createdAt,
      };
      recipients.forEach((accountId) => {
        io.to(`leads:user:${accountId}`).emit("lead:created", socketPayload);
      });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Lead created successfully", {
      ...lead,
      followUps: createdFollowUps,
    });
  } catch (err: any) {
    console.error("Create lead error:", err);
    if (err?.code === "P2002")
      return sendErrorResponse(res, 400, "Duplicate customer/mobile");
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
  }
}

/**
 * POST /user/leads
 * Employee creates a lead and self-assigns (or assigns to their team).
 * Identical product/customer logic to admin; cannot force-assign arbitrary accounts.
 */
export async function createMyLead(req: Request, res: Response) {
  try {
    const creatorAccountId = req.user?.accountId;
    if (!creatorAccountId) return sendErrorResponse(res, 401, "Invalid session user");

    const {
      source = "MANUAL",
      type = "LEAD",
      customerName,
      mobileNumber,
      customerCompanyName,
      cost,
      remark,
      teamId: assigneeTeamId,   // optional: assign to own team
      demoDate,
      followUps,
      customerCategory,
      businessCategory,
      state,
      city,
      tallySerial,
      tallyVersion,
      isImportant,
      forceCreate = false,
    } = req.body as Record<string, any>;

    if (!source || !type)
      return sendErrorResponse(res, 400, "Lead source and type are required");
    if (!customerName || !mobileNumber)
      return sendErrorResponse(res, 400, "Customer name and mobile are required");

    // Employee always self-assigns unless they route to their team
    const assigneeAccountId: string | undefined = assigneeTeamId
      ? undefined
      : creatorAccountId;

    const normalizedMobile = normalizeMobile(mobileNumber);
    const products = normalizeIncomingProducts(req.body);
    const { productTitle, totalCost } = deriveLeadScalars(products, cost);

    if (!forceCreate) {
      const duplicate = await findDuplicateLead({ normalizedMobile, productTitle });

      if (duplicate) {
        const assigneeName = duplicate.assignments[0]?.account
          ? `${duplicate.assignments[0].account.firstName} ${duplicate.assignments[0].account.lastName}`.trim()
          : null;

        return res.status(409).json({
          success: false,
          code: "DUPLICATE_LEAD",
          message: "An active lead already exists for this customer and product.",
          data: {
            existingLead: {
              id: duplicate.id,
              status: duplicate.status,
              customerName: duplicate.customerName,
              productTitle: duplicate.productTitle,
              createdAt: duplicate.createdAt,
              assignedTo: assigneeName,
            },
            hint: "Send { forceCreate: true } to create anyway.",
          },
        });
      }
    }

    const { lead, recipients, createdFollowUps } = await createLeadCore(
      creatorAccountId,
      {
        source,
        type,
        customerName,
        mobileNumber,
        customerCompanyName,
        cost,
        remark,
        assigneeAccountId,
        assigneeTeamId,
        demoDate,
        followUps,
        customerCategory,
        businessCategory,
        state,
        city,
        tallySerial,
        tallyVersion,
        isImportant: isImportant === true,
        forceCreate,
        products: products ?? undefined,
      },
    );

    void triggerAssignmentNotification({
      leadId: lead.id,
      assigneeAccountId: assigneeAccountId ?? null,
      assigneeTeamId: assigneeTeamId ?? null,
    });

    try {
      const io = getIo();
      const socketPayload = {
        id: lead.id,
        customerName: lead.customerName,
        productTitle: lead.productTitle,
        status: lead.status,
        demoScheduledAt: lead.demoScheduledAt,
        demoCount: lead.demoCount,
        createdAt: lead.createdAt,
      };
      recipients.forEach((accountId) => {
        io.to(`leads:user:${accountId}`).emit("lead:created", socketPayload);
      });
      // Also broadcast to the creator themselves in case they weren't in recipients
      io.to(`leads:user:${creatorAccountId}`).emit("lead:created", socketPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Lead created successfully", {
      ...lead,
      followUps: createdFollowUps,
    });
  } catch (err: any) {
    console.error("Create my lead error:", err);
    if (err?.code === "P2002")
      return sendErrorResponse(res, 400, "Duplicate customer/mobile");
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
  }
}



/**
 * POST /admin/leads/:id/states
 * Appends a new state entry — never replaces existing ones.
 */
export async function addLeadState(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;
        if (!performerAccountId)
            return sendErrorResponse(res, 401, "Invalid session user");
 
        const { id } = req.params;
        const { text } = req.body as { text?: string };
 
        if (!text?.trim())
            return sendErrorResponse(res, 400, "text is required");
 
        /* ── Fetch lead + performer info in parallel ── */
        const [lead, performer] = await Promise.all([
            prisma.lead.findUnique({
                where: { id },
                select: { id: true, states: true },
            }),
            prisma.account.findUnique({
                where: { id: performerAccountId },
                select: {
                    id:        true,
                    firstName: true,
                    lastName:  true,
                    avatar:    true,
                },
            }),
        ]);
 
        if (!lead)      return sendErrorResponse(res, 404, "Lead not found");
        if (!performer) return sendErrorResponse(res, 404, "Performer not found");
 
        /* ── Build new entry ── */
        const newEntry = {
            id:     randomUUID(),
            text:   text.trim(),
            by: {
                accountId: performer.id,
                firstName: performer.firstName,
                lastName:  performer.lastName,
                avatar:    performer.avatar ?? null,
            },
            at:     new Date().toISOString(),
            edited: false,
        };
 
        /* ── Append — never replace ── */
        const existingStates = Array.isArray(lead.states)
            ? (lead.states)
            : [];
 
        const allStates = [...existingStates, newEntry];
 
        const updated = await prisma.lead.update({
            where: { id },
            data:  { states: allStates },
            select: { 
                id: true, 
                states: true, 
                updatedAt: true,
                status: true,
                customerName: true,
                mobileNumber: true,
            },
        });
 
        /* ── Activity log ── */
        try {
            await prisma.leadActivityLog.create({
                data: {
                    leadId:      id,
                    action:      "UPDATED",
                    performedBy: performerAccountId,
                    meta: {
                        type:    "STATE_ADDED",
                        entryId: newEntry.id,
                        text:    newEntry.text,
                    },
                },
            });
        } catch (logErr) {
            console.warn("Activity log creation failed:", logErr);
            // Don't fail the request if logging fails
        }
 
        /* ── Socket patch ── */
        try {
            const io = getIo();
            const patchPayload = {
                id,
                patch: {
                    stateAdded: newEntry,
                    updatedAt: updated.updatedAt,
                    states: allStates, // ← Include full array for socket sync
                },
            };
            io.to("leads:admin").emit("lead:patch", patchPayload);
            io.to(`leads:user:${performerAccountId}`).emit("lead:patch", patchPayload);
        } catch (socketErr) {
            console.warn("Socket emit failed:", socketErr);
        }
 
        return sendSuccessResponse(res, 201, "State added", {
            entry:  newEntry,
            states: allStates, // ← Return full states array
        });
    } catch (err: any) {
        console.error("addLeadState error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to add state");
    }
}

































































/**
 * POST /admin/leads/:id/helpers
 */
export async function addLeadHelperAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id: leadId } = req.params;
    const { accountId, role = "EXPORT", remark } = req.body;

    if (!accountId) return sendErrorResponse(res, 400, "accountId is required");

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerName: true,
        productTitle: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    const { helper } = await prisma.$transaction(async (tx) => {
      const upserted = await tx.leadHelper.upsert({
        where: { leadId_accountId: { leadId, accountId } },
        update: { isActive: true, removedAt: null, role, remark: remark ?? null },
        create: { leadId, accountId, role, addedBy: performerAccountId, remark: remark ?? null },
      });

      const initialAssignee = await resolveAssigneeSnapshot({ accountId });

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "HELPER_ADDED",
          performedBy: performerAccountId,
          meta: { initialAssignment: initialAssignee, role, remark: remark ?? null },
        },
      });

      return { helper: upserted };
    });

    let recipientAccountIds: string[] = [accountId];
    if (lead.assignments[0]?.accountId) {
      recipientAccountIds.push(lead.assignments[0].accountId);
    } else if (lead.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: lead.assignments[0].teamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds.push(...members.map((m) => m.accountId));
    }
    recipientAccountIds = [...new Set(recipientAccountIds)];

    try {
      const io = getIo();
      const patchPayload = {
        id: leadId,
        patch: { helperAdded: { accountId, role, addedAt: new Date() } },
      };
      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });
      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    void triggerHelperNotification({ leadId, helperAccountId: accountId, performerAccountId, role });

    return sendSuccessResponse(res, 200, "Helper added to lead", helper);
  } catch (err: any) {
    console.error(err);
    return sendErrorResponse(res, 500, "Failed to add helper");
  }
}

/**
 * DELETE /admin/leads/:id/helpers/:accountId
 */
export async function removeLeadHelperAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    const { id: leadId, accountId } = req.params;

    if (!leadId || !accountId) return sendErrorResponse(res, 400, "Invalid parameters");

    const existingLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!existingLead) return sendErrorResponse(res, 404, "Lead not found");

    const helper = await prisma.leadHelper.findFirst({
      where: { leadId, accountId, isActive: true },
    });
    if (!helper) return sendErrorResponse(res, 404, "Active helper not found");

    await prisma.$transaction(async (tx) => {
      await tx.leadHelper.updateMany({
        where: { leadId, accountId, isActive: true },
        data: { isActive: false, removedAt: new Date() },
      });

      const initialAssignee = await resolveAssigneeSnapshot({ accountId });
      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "HELPER_REMOVED",
          performedBy: performerAccountId!,
          meta: { initialAssignment: initialAssignee },
        },
      });
    });

    let recipientAccountIds: string[] = [accountId];
    if (existingLead.assignments[0]?.accountId) {
      recipientAccountIds.push(existingLead.assignments[0].accountId);
    } else if (existingLead.assignments[0]?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: existingLead.assignments[0].teamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds.push(...members.map((m) => m.accountId));
    }
    recipientAccountIds = [...new Set(recipientAccountIds)];

    try {
      const io = getIo();
      const patchPayload = {
        id: leadId,
        patch: { helperRemoved: { accountId, removedAt: new Date() } },
      };
      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });
      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Helper removed", { leadId, accountId });
  } catch {
    return sendErrorResponse(res, 500, "Failed to remove helper");
  }
}








// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW UPS
// ─────────────────────────────────────────────────────────────────────────────


export async function createFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId } = req.params;
    const { type = "CALL", scheduledAt, remark } = req.body as {
      type?: "CALL" | "DEMO" | "MEETING" | "VISIT" | "WHATSAPP" | "OTHER";
      scheduledAt: string;
      remark?: string;
    };

    if (!scheduledAt) return sendErrorResponse(res, 400, "scheduledAt is required");

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, customerName: true, status: true },
    });
    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    const followUp = await prisma.$transaction(async (tx) => {
      const created = await tx.leadFollowUp.create({
        data: {
          leadId,
          type,
          status: "PENDING",
          scheduledAt: new Date(scheduledAt),
          remark: remark ?? null,
          createdBy: accountId,
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { followUpCount: { increment: 1 } },
      });

      await syncLeadFollowUpAggregates(tx, leadId);

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "FOLLOW_UP_SCHEDULED",
          performedBy: accountId,
          meta: {
            followUpId: created.id,
            type,
            scheduledAt: new Date(scheduledAt).toISOString(),
            remark: remark ?? null,
          },
        },
      });

      return created;
    });

    try {
      getIo().to("leads:admin").emit("followup:created", { leadId, followUp });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Follow-up scheduled", followUp);
  } catch (err: any) {
    console.error("Create follow-up error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create follow-up");
  }
}

export async function updateFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId, id } = req.params;
    const { action, scheduledAt, remark, type } = req.body as {
      action: "done" | "reschedule" | "missed" | "update";
      scheduledAt?: string;
      remark?: string;
      type?: "CALL" | "DEMO" | "MEETING" | "VISIT" | "WHATSAPP" | "OTHER";
    };

    if (!action)
      return sendErrorResponse(res, 400, "action is required: done | reschedule | missed | update");

    const existing = await prisma.leadFollowUp.findFirst({ where: { id, leadId } });
    if (!existing) return sendErrorResponse(res, 404, "Follow-up not found");
    if (existing.status === "DONE") return sendErrorResponse(res, 400, "Follow-up already marked as done");

    const result = await prisma.$transaction(async (tx) => {
      let updated: any;
      let newFollowUp: any = null;
      let activityAction: string;

      if (action === "done") {
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: { status: "DONE", doneAt: new Date(), doneBy: accountId, remark: remark ?? existing.remark },
        });
        activityAction = "FOLLOW_UP_DONE";
      } else if (action === "reschedule") {
        if (!scheduledAt) throw new Error("scheduledAt is required for reschedule");
        updated = await tx.leadFollowUp.update({ where: { id }, data: { status: "RESCHEDULED" } });
        newFollowUp = await tx.leadFollowUp.create({
          data: {
            leadId,
            type: type ?? existing.type,
            status: "PENDING",
            scheduledAt: new Date(scheduledAt),
            remark: remark ?? null,
            rescheduledFrom: { connect: { id } },
            createdBy: accountId,
          },
        });
        await tx.lead.update({ where: { id: leadId }, data: { followUpCount: { increment: 1 } } });
        activityAction = "FOLLOW_UP_RESCHEDULED";
      } else if (action === "missed") {
        updated = await tx.leadFollowUp.update({ where: { id }, data: { status: "MISSED" } });
        activityAction = "FOLLOW_UP_MISSED";
      } else if (action === "update") {
        const patch: any = {};
        if (remark !== undefined) patch.remark = remark;
        if (type !== undefined) patch.type = type;
        if (scheduledAt !== undefined) patch.scheduledAt = new Date(scheduledAt);
        updated = await tx.leadFollowUp.update({ where: { id }, data: patch });
        activityAction = "FOLLOW_UP_SCHEDULED";
      } else {
        throw new Error("Invalid action");
      }

      await syncLeadFollowUpAggregates(tx, leadId);

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: activityAction as any,
          performedBy: accountId,
          meta: {
            action,
            rescheduledTo: newFollowUp?.scheduledAt ?? null,
            remarkTo: newFollowUp?.remark ?? null,
            rescheduledFrom: existing?.scheduledAt ?? null,
            remarkFrom: existing?.remark ?? null,
          },
        },
      });

      return { updated, newFollowUp };
    });

    try {
      getIo().to("leads:admin").emit("followup:updated", { leadId, ...result });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Follow-up updated", result);
  } catch (err: any) {
    console.error("Update follow-up error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update follow-up");
  }
}

export async function getLeadFollowUps(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId } = req.params;
    const { status } = req.query as { status?: string };

    const where: any = { leadId };
    if (status) where.status = status;

    const followUps = await prisma.leadFollowUp.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include: {
        createdByAcc: { select: { id: true, firstName: true, lastName: true } },
        doneByAcc: { select: { id: true, firstName: true, lastName: true } },
        rescheduledTo: { select: { id: true, scheduledAt: true, status: true } },
        rescheduledFrom: { select: { id: true, scheduledAt: true, status: true } },
      },
    });

    return sendSuccessResponse(res, 200, "Follow-ups fetched", followUps);
  } catch (err: any) {
    console.error("Get lead follow-ups error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch follow-ups");
  }
}

export async function listFollowUps(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      status, type, range, fromDate, toDate,
      assignedToAccountId, assignedToTeamId, leadId,
      sortBy = "scheduledAt", sortOrder = "asc",
      page = "1", limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;
    const now = new Date();

    const where: any = {};
    if (leadId) where.leadId = leadId;
    if (status) where.status = status;
    if (type) where.type = type;

    if (range === "today") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "tomorrow") {
      const start = new Date(now); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "week") {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const end = new Date(now); end.setDate(end.getDate() + 7); end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "overdue") {
      where.status = "PENDING";
      where.scheduledAt = { lt: now };
    } else if (range === "custom") {
      where.scheduledAt = {};
      if (fromDate) where.scheduledAt.gte = new Date(fromDate);
      if (toDate) { const end = new Date(toDate); end.setHours(23, 59, 59, 999); where.scheduledAt.lte = end; }
    }

    if (assignedToAccountId || assignedToTeamId) {
      where.lead = {
        assignments: {
          some: {
            isActive: true,
            ...(assignedToAccountId ? { accountId: assignedToAccountId } : {}),
            ...(assignedToTeamId ? { teamId: assignedToTeamId } : {}),
          },
        },
      };
    }

    const validSortFields: Record<string, boolean> = { scheduledAt: true, createdAt: true, doneAt: true };
    const safeSortBy = validSortFields[sortBy] ? sortBy : "scheduledAt";
    const safeOrder = sortOrder === "desc" ? "desc" : "asc";
    const orderBy = [{ [safeSortBy]: safeOrder }];

    const [total, followUps] = await Promise.all([
      prisma.leadFollowUp.count({ where }),
      prisma.leadFollowUp.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          lead: {
            select: {
              id: true,
              customerName: true,
              mobileNumber: true,
              productTitle: true,
              status: true,
              assignments: {
                where: { isActive: true },
                select: {
                  account: { select: { id: true, firstName: true, avatar: true, lastName: true } },
                  team: { select: { id: true, name: true } },
                },
              },
            },
          },
          createdByAcc: { select: { id: true, firstName: true, avatar: true, lastName: true } },
          doneByAcc: { select: { id: true, firstName: true, avatar: true, lastName: true } },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Follow-ups fetched", {
      data: followUps,
      meta: {
        page: pageNumber,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (err: any) {
    console.error("List follow-ups error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch follow-ups");
  }
}

export async function deleteFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId, id } = req.params;

    const existing = await prisma.leadFollowUp.findFirst({ where: { id, leadId } });
    if (!existing) return sendErrorResponse(res, 404, "Follow-up not found");
    if (existing.status !== "PENDING")
      return sendErrorResponse(res, 400, "Only PENDING follow-ups can be deleted");

    await prisma.$transaction(async (tx) => {
      await tx.leadFollowUp.delete({ where: { id } });
      await tx.lead.update({ where: { id: leadId }, data: { followUpCount: { decrement: 1 } } });
      await syncLeadFollowUpAggregates(tx, leadId);
      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "FOLLOW_UP_SCHEDULED",
          performedBy: accountId,
          meta: { followUpId: id, action: "DELETED", scheduledAt: existing.scheduledAt },
        },
      });
    });

    return sendSuccessResponse(res, 200, "Follow-up deleted");
  } catch (err: any) {
    console.error("Delete follow-up error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to delete follow-up");
  }
}

export async function sendLeadReminder(req: Request, res: Response) {
  try {
    const { leadId } = req.params;
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session");

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        isActive: true,
        customerName: true,
        productTitle: true,
        status: true,
        cost: true,
        assignments: {
          where: { isActive: true },
          select: {
            id: true,
            type: true,
            accountId: true,
            teamId: true,
            remark: true,
            account: { select: { id: true, firstName: true, lastName: true, contactPhone: true } },
            team: { select: { id: true, name: true } },
          },
        },
        createdByAcc: { select: { firstName: true, lastName: true } },
      },
    });

    if (!lead) return sendErrorResponse(res, 404, "Lead not found");
    if (!lead.isActive) return sendErrorResponse(res, 400, "Lead is closed");

    const activeAssignment = lead.assignments[0];
    if (!activeAssignment)
      return sendErrorResponse(res, 400, "No active assignment found for this lead");

    const bodyRemark: string | undefined = req.body?.remark;
    const storedRemark =
      typeof activeAssignment.remark === "object" &&
        activeAssignment.remark !== null &&
        "text" in (activeAssignment.remark as any)
        ? (activeAssignment.remark as any).text
        : typeof activeAssignment.remark === "string"
          ? activeAssignment.remark
          : null;

    const finalRemark: string = bodyRemark?.trim() || storedRemark || "Please follow up on this lead.";

    let recipientAccountIds: string[] = [];
    if (activeAssignment.type === "ACCOUNT" && activeAssignment.accountId) {
      recipientAccountIds = [activeAssignment.accountId];
    } else if (activeAssignment.type === "TEAM" && activeAssignment.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: activeAssignment.teamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds = members.map((m) => m.accountId);
    }

    if (recipientAccountIds.length === 0)
      return sendErrorResponse(res, 400, "No recipients resolved for this assignment");

    const performerAcc = await prisma.account.findUnique({
      where: { id: performerAccountId },
      select: { firstName: true, lastName: true },
    });
    const senderName = performerAcc
      ? `${performerAcc.firstName} ${performerAcc.lastName}`.trim()
      : "Admin";

    const notifications = await Promise.all(
      recipientAccountIds.map(async (accountId) => {
        const dedupeKey = `lead:${lead.id}:reminder:${accountId}:${Date.now()}`;
        return prisma.notification.create({
          data: {
            accountId,
            category: "LEAD",
            level: "WARNING",
            title: "Lead Reminder",
            body: `${lead.customerName}${lead.productTitle ? ` – ${lead.productTitle}` : ""}: ${finalRemark}`,
            actionUrl: `/user/leads/${lead.id}`,
            dedupeKey,
            deliveryChannels: ["web", "chrome"],
            payload: {
              leadId: lead.id,
              customerName: lead.customerName,
              productTitle: lead.productTitle ?? null,
              status: lead.status,
              remark: finalRemark,
              sentBy: senderName,
              sentAt: new Date().toISOString(),
            },
          },
        });
      }),
    );

    await prisma.leadActivityLog.create({
      data: {
        leadId: lead.id,
        action: "REMINDER_SENT",
        performedBy: performerAccountId,
        meta: {
          remark: finalRemark,
          sentTo:
            activeAssignment.type === "ACCOUNT"
              ? {
                type: "ACCOUNT",
                accountId: activeAssignment.accountId,
                name: activeAssignment.account
                  ? `${activeAssignment.account.firstName} ${activeAssignment.account.lastName}`.trim()
                  : null,
              }
              : {
                type: "TEAM",
                teamId: activeAssignment.teamId,
                name: activeAssignment.team?.name ?? null,
                recipientCount: recipientAccountIds.length,
              },
          sentBy: { id: performerAccountId, name: senderName },
          sentAt: new Date().toISOString(),
        },
      },
    });

    try {
      const io = getIo();
      notifications.forEach((n) => {
        const socketPayload: ServerNotificationPayload = {
          id: n.id,
          category: n.category as any,
          level: n.level as any,
          title: n.title,
          body: n.body,
          actionUrl: n.actionUrl ?? undefined,
          payload: n.payload as any,
          createdAt: n.createdAt.toISOString(),
        };
        if (n.accountId) {
          io.to(`notif:${n.accountId}`).emit("notification", socketPayload);
        }
      });
    } catch {
      console.warn("Socket emit skipped — IO not available");
    }

    const subscriptions = await prisma.notificationSubscription.findMany({
      where: { accountId: { in: recipientAccountIds } },
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: "Lead Reminder",
            body: `${lead.customerName}: ${finalRemark}`,
            actionUrl: `/user/leads/${lead.id}`,
            data: {
              actionUrl: `/user/leads/${lead.id}`,
              payload: { leadId: lead.id, remark: finalRemark, sentBy: senderName },
            },
          }),
        );
      } catch (pushError: any) {
        console.warn("Push failed:", sub.endpoint, pushError?.statusCode);
        if (pushError?.statusCode === 404 || pushError?.statusCode === 410) {
          await prisma.notificationSubscription.delete({ where: { id: sub.id } }).catch(() => { });
        }
      }
    }

    await prisma.notification.updateMany({
      where: { id: { in: notifications.map((n) => n.id) } },
      data: { sentAt: new Date() },
    });

    return sendSuccessResponse(res, 200, "Reminder sent successfully", {
      leadId: lead.id,
      recipientCount: recipientAccountIds.length,
      remark: finalRemark,
      sentBy: senderName,
    });
  } catch (err: any) {
    console.error("sendLeadReminder error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to send reminder");
  }
}

export async function getUserIdFromAccountId(accountId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { accountId },
    select: { id: true },
  });
  return user?.id ?? null;
}