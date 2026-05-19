// src/controller/lead/delete.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";


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
                cost: true,
                customerProducts: true,
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