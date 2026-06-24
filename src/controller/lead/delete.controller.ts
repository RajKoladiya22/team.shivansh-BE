// src/controller/lead/delete.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import { syncLeadExpertise } from "./utils";


/**
 * DELETE /admin/leads/:id/permanent
 */
export async function deleteLeadPermanentAdmin(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;
        if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

        const { id } = req.params;

        const existing = await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                isWorking: true,
                customerId: true,
                product: true,
                productTitle: true,
                productCatalogId: true,
                status: true,
                cost: true,
                customerProducts: true,
                assignments: {
                    where: { isActive: true },
                    select: { accountId: true },
                },
            },
        });

        if (!existing) return sendErrorResponse(res, 404, "Lead not found");
        if (existing.isWorking) return sendErrorResponse(res, 400, "Cannot delete lead while work is active");

        await prisma.$transaction(async (tx) => {
            await tx.leadActivityLog.deleteMany({ where: { leadId: id } });
            await tx.leadAssignment.deleteMany({ where: { leadId: id } });
            await tx.leadHelper.deleteMany({ where: { leadId: id } });

            if (existing.customerId) {
                const customerId = existing.customerId;

                /* ─────────────────────────────────────────
                   Delete ONLY this lead's products
                ───────────────────────────────────────── */

                const leadCustomerProducts =
                    await tx.customerProduct.findMany({
                        where: {
                            customerId,
                            leadId: id,
                        },
                        select: {
                            id: true,
                        },
                    });

                if (leadCustomerProducts.length > 0) {
                    await tx.customerProduct.deleteMany({
                        where: {
                            id: {
                                in: leadCustomerProducts.map(
                                    (p) => p.id,
                                ),
                            },
                        },
                    });
                }

                /* ─────────────────────────────────────────
                   Fetch remaining customer products
                ───────────────────────────────────────── */

                const customerProducts =
                    await tx.customerProduct.findMany({
                        where: {
                            customerId,
                        },
                        orderBy: {
                            createdAt: "desc",
                        },
                    });

                /* ─────────────────────────────────────────
                   Active Products
                ───────────────────────────────────────── */

                const active = customerProducts
                    .filter(
                        (p: any) =>
                            p.isActive === true &&
                            p.isExpired === false,
                    )
                    .map((p: any) => ({
                        id:
                            p.productCatalogId ??
                            p.id,

                        name:
                            p.productTitle,

                        price:
                            (p.meta as any)?.price ??
                            null,

                        slug:
                            (p.meta as any)?.slug ??
                            null,

                        purchaseAt:
                            p.purchasedAt,

                        addedAt:
                            p.createdAt,

                        status: "ACTIVE",
                    }));

                /* ─────────────────────────────────────────
                   Product History
                ───────────────────────────────────────── */

                const history = customerProducts
                    .filter(
                        (p: any) =>
                            p.isExpired === true ||
                            p.isActive === false,
                    )
                    .map((p: any) => ({
                        id:
                            p.productCatalogId ??
                            p.id,

                        name:
                            p.productTitle,

                        price:
                            (p.meta as any)?.price ??
                            null,

                        slug:
                            (p.meta as any)?.slug ??
                            null,

                        purchaseAt:
                            p.purchasedAt,

                        expiresAt:
                            p.expiresAt,

                        addedAt:
                            p.createdAt,

                        status: "EXPIRED",
                    }));

                /* ─────────────────────────────────────────
                   Update customer.products JSON
                ───────────────────────────────────────── */

                await tx.customer.update({
                    where: {
                        id: customerId,
                    },
                    data: {
                        products: {
                            active,
                            history,
                        },
                        updatedAt: new Date(),
                    },
                });
            }

            if (existing.productCatalogId) {
                const LeadOwner = existing.assignments[0]?.accountId ?? null;
                const expertiseUserId = LeadOwner ? LeadOwner : performerAccountId;

                try {
                    await syncLeadExpertise({
                        prisma: tx,
                        accountId: expertiseUserId,
                        productCatalogId: existing.productCatalogId,
                        leadsCountDelta: -1,
                        demoCountDelta: existing.status === "DEMO_DONE" ? -1 : 0,
                        leadsConvertedDelta: existing.status === "CONVERTED" ? -1 : 0,
                    });
                } catch (err) {
                    console.warn("Failed to decrement userProductExpertise", err);
                }
            }

            await tx.lead.update({ where: { id }, data: { accounts: { set: [] } } });
            await tx.lead.delete({ where: { id } });
        });

        try {
            const io = getIo();
            io.to("leads:admin").emit("lead:deleted", { id });
            io.emit("lead:deleted", { id });
        } catch {
            console.warn("Socket emit skipped");
        }

        return sendSuccessResponse(res, 200, "Lead permanently deleted successfully");
    } catch (err: any) {
        console.error("Permanent delete lead error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to permanently delete lead");
    }
}


/**
 * DELETE /admin/leads/:id/states/:stateId
 * Deletes a state entry
 */
export async function deleteLeadState(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;

        if (!performerAccountId) {
            return sendErrorResponse(res, 401, "Invalid session user");
        }

        const { id, stateId } = req.params;

        const lead = await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                states: true,
            },
        });

        if (!lead) {
            return sendErrorResponse(res, 404, "Lead not found");
        }

        const states = Array.isArray(lead.states)
            ? (lead.states as any[])
            : [];

        const stateToDelete = states.find((item) => item?.id === stateId);

        if (!stateToDelete) {
            return sendErrorResponse(res, 404, "State not found");
        }

        const filteredStates = states.filter((item) => item?.id !== stateId);

        const updatedLead = await prisma.lead.update({
            where: { id },
            data: {
                states: filteredStates, // ← Empty array if this was the last one
            },
            select: {
                id: true,
                states: true,
                updatedAt: true,
            },
        });

        /* ── Activity log ── */
        try {
            await prisma.leadActivityLog.create({
                data: {
                    leadId: id,
                    action: "UPDATED",
                    performedBy: performerAccountId,
                    meta: {
                        type: "STATE_DELETED",
                        stateId,
                        text: stateToDelete.text,
                    },
                },
            });
        } catch (logErr) {
            console.warn("Activity log creation failed:", logErr);
        }

        /* ── Socket patch ── */
        try {
            const io = getIo();
            const patchPayload = {
                id,
                patch: {
                    stateAdded: [],
                    updatedAt: updatedLead.updatedAt,
                    states: filteredStates, // ← Include full array for socket sync
                },
            };
            io.to("leads:admin").emit("lead:patch", patchPayload);
            io.to(`leads:user:${performerAccountId}`).emit("lead:patch", patchPayload);
        } catch (socketErr) {
            console.warn("Socket emit failed:", socketErr);
        }

        return sendSuccessResponse(res, 200, "State deleted", {
            deletedStateId: stateId,
            states: filteredStates, // ← Return filtered array
        });
    } catch (err: any) {
        console.error("deleteLeadState error:", err);
        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to delete state",
        );
    }
}

