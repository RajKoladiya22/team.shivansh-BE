// src/controller/lead/update.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { getIo } from "../../core/utils/socket";
import {
    closeFollowUpsOnStatusChange,
    syncLeadFollowUpAggregates, syncLeadProductToCustomer, syncProductCostToEntities,
    normalizeMobile,
    upsertCustomerProduct,
    resolveProductCatalogId,
    LeadProductItem,
    resolvePerformerSnapshot,
    stopWorkIfActive,
    updateUserProductExpertise,
} from "./utils";
import { randomUUID } from "crypto";

/**
 * PATCH /admin/leads/:id
 */
export async function updateLeadAdmin(req: Request, res: Response) {
    try {
        const adminUserId = req.user?.id;
        if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

        const performerAccountId = req.user?.accountId;
        if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

        const { id } = req.params;

        const allowedFields = [
            "customerName",
            "mobileNumber",
            "status",
            "remark",
            "cost",
            "product",
            "productTitle",
            "demoScheduledAt",
            "source",
            "isImportant",
        ];
        const data: Record<string, any> = {};
        for (const f of allowedFields) {
            if (req.body[f] !== undefined) data[f] = req.body[f];
        }

        if (data.mobileNumber) data.mobileNumber = normalizeMobile(data.mobileNumber);
        if (data.product) data.productTitle = data.product.title ?? data.productTitle ?? null;
        if (data.productTitle === undefined && data.product?.title)
            data.productTitle = data.product.title;
        if (req.body.isImportant !== undefined) data.isImportant = req.body.isImportant;

        const existing = await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                status: true,
                source: true,
                statusMark: true,
                demoScheduledAt: true,
                demoDoneAt: true,
                demoCount: true,
                demoMeta: true,
                cost: true,
                remark: true,
                customerId: true,
                product: true,
                productCatalogId: true,
                productCatalog: true,
                productTitle: true,
                isImportant: true,
                assignments: {
                    where: { isActive: true },
                    select: { accountId: true, teamId: true },
                },
            },
        });
        if (!existing) return sendErrorResponse(res, 404, "Lead not found");
        if (!existing.customerId) return sendErrorResponse(res, 404, "Customer not found in Lead");
        const previousStatus = existing.status;
        const statusMark = {
            ...(existing.statusMark as Record<string, boolean> | null),
        };

        if (data.status === "CLOSED") statusMark.close = true;

        if (data.status === "DEMO_DONE" && existing.product && performerAccountId) {
            statusMark.demo = true;
            data.demoDoneAt = new Date();

            const products = Array.isArray(existing.product)
                ? existing.product
                : [];

            const productCatalogIds = [
                ...new Set(
                    products
                        .map((p: any) => p?.productCatalogId || p?.id)
                        .filter(Boolean),
                ),
            ];

            await Promise.all(
                productCatalogIds.map((productCatalogId: string) =>
                    prisma.userProductExpertise.upsert({
                        where: {
                            userId_productCatalogId: {
                                userId: performerAccountId,
                                productCatalogId,
                            },
                        },
                        create: {
                            userId: performerAccountId,
                            productCatalogId,
                            demoCount: 1,
                            lastDemoAt: new Date(),
                            lastLeadAt: new Date(),
                        },
                        update: {
                            demoCount: {
                                increment: 1,
                            },
                            lastDemoAt: new Date(),
                            lastLeadAt: new Date(),
                        },
                    }),
                ),
            );
        }

        const products = Array.isArray(existing.product)
            ? existing.product
            : existing.product
                ? [existing.product]
                : [];

        const convertedProducts = products
            .map((p: any) => ({
                productCatalogId:
                    p?.productCatalogId ??
                    p?.catalogId ??
                    p?.id ??
                    null,

                productTitle:
                    p?.title ??
                    p?.productTitle ??
                    p?.name ??
                    null,
            }))
            .filter(
                (p: any) =>
                    p.id ||
                    p.productCatalogId ||
                    p.productTitle,
            );


        if (data.status === "CONVERTED" && existing.product && performerAccountId) {
            statusMark.converted = true;
            data.closedAt = new Date();
        }

        // console.log("\n\n\n\n\n\n\n\n\n existing.product-->\n", existing.product);
        // console.log("\n products-->\n", products);
        // console.log("\n convertedProducts-->\n", convertedProducts);

        if (data.status) {
            await prisma.lead.update({
                where: { id: existing.id },
                data: { isWorking: false },
            });
            await prisma.account.update({
                where: { id: performerAccountId },
                data: { isBusy: false, activeLeadId: null },
            });
        }

        if (Object.keys(statusMark).length > 0) data.statusMark = statusMark;

        if (data.demoScheduledAt) {
            const newDate = new Date(data.demoScheduledAt);
            if (
                !existing.demoScheduledAt ||
                existing.demoScheduledAt.getTime() !== newDate.getTime()
            ) {
                data.demoCount = { increment: 1 };
                const existingMeta = (existing as any).demoMeta as any;
                const history = existingMeta?.history ?? [];
                data.demoMeta = {
                    history: [
                        ...history,
                        {
                            type: existing.demoScheduledAt ? "RESCHEDULED" : "SCHEDULED",
                            at: newDate.toISOString(),
                            by: performerAccountId,
                        },
                    ],
                };
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            const lead = await tx.lead.update({
                where: { id },
                data: {
                    ...data,
                    closedAt:
                        data.status === "CLOSED" || data.status === "CONVERTED"
                            ? new Date()
                            : undefined,
                },
                include: {
                    assignments: { include: { account: true, team: true } },
                },
            });

            if (data.status && existing.productCatalogId) {
                await updateUserProductExpertise({
                    prisma: tx as any,
                    accountId: performerAccountId,
                    productCatalogId: existing.productCatalogId,
                    previousStatus,
                    newStatus: data.status,
                    leadId: id,
                });
            }


            if (
                data.status === "CONVERTED" &&
                convertedProducts.length > 0 &&
                performerAccountId
            ) {
                const now = new Date();



                const rawCatalogIds = [
                    ...new Set(
                        convertedProducts
                            .map((p: any) => p.productCatalogId)
                            .filter(Boolean),
                    ),
                ] as string[];

                /* ─────────────────────────────────────────
                   Normalize ProductCatalog IDs
                   adminProductId -> ProductCatalog.id
                ───────────────────────────────────────── */

                const resolvedCatalogs =
                    await tx.productCatalog.findMany({
                        where: {
                            OR: [
                                {
                                    id: {
                                        in: rawCatalogIds,
                                    },
                                },
                                {
                                    adminProductId: {
                                        in: rawCatalogIds,
                                    },
                                },
                            ],
                        },
                        select: {
                            id: true,
                            adminProductId: true,
                        },
                    });

                const productCatalogIds = [
                    ...new Set(
                        resolvedCatalogs.map(
                            (p: any) => p.id,
                        ),
                    ),
                ];

                // console.log("\nproductCatalogIds-->\n", productCatalogIds);


                /* ── Expertise ───────────────────────── */

                await Promise.all(
                    productCatalogIds.map((productCatalogId: string) =>
                        tx.userProductExpertise.upsert({
                            where: {
                                userId_productCatalogId: {
                                    userId: performerAccountId,
                                    productCatalogId,
                                },
                            },
                            create: {
                                userId: performerAccountId,
                                productCatalogId,
                                leadsConverted: 1,
                                lastLeadAt: now,
                            },
                            update: {
                                leadsConverted: {
                                    increment: 1,
                                },
                                lastLeadAt: now,
                            },
                        }),
                    ),
                );

                /* ── Customer Product Purchase ─────── */

                const customerId = existing.customerId;

                if (customerId) {
                    await Promise.all(
                        convertedProducts.map((p: any) =>
                            tx.customerProduct.updateMany({
                                where: {
                                    customerId,
                                    OR: [
                                        ...(p.productCatalogId
                                            ? [
                                                {
                                                    productCatalogId:
                                                        p.productCatalogId,
                                                },
                                            ]
                                            : []),
                                        ...(p.productTitle
                                            ? [
                                                {
                                                    productTitle:
                                                        p.productTitle,
                                                },
                                            ]
                                            : []),
                                    ],
                                },
                                data: {
                                    isPurchase: true,
                                    purchasedAt: now,
                                    isActive: true,
                                    isExpired: false,
                                },
                            }),
                        ),
                    );
                }
            }

            if (data.cost !== undefined && existing.customerId) {
                await syncProductCostToEntities(tx, {
                    leadId: id,
                    customerId: existing.customerId,
                    productId: (existing.product as any)?.id ?? null,
                    productSlug: (existing.product as any)?.slug ?? null,
                    productTitle: (existing.product as any)?.title ?? existing.productTitle ?? null,
                    newCost: Number(data.cost),
                });
            }

            if (data.product || data.productTitle) {
                const newProduct = data.product || {
                    title: data.productTitle,
                    cost: data.cost ?? existing.cost,
                };

                await syncLeadProductToCustomer(tx, {
                    leadId: id,
                    customerId: existing.customerId,
                    newProduct,
                    oldProduct: (existing.product as any) ?? {
                        title: existing.productTitle,
                        cost: existing.cost,
                    },
                    performerAccountId,
                });
            }

            if (
                data.status === "DEMO_DONE" ||
                data.status === "CLOSED" ||
                data.status === "CONVERTED" ||
                data.status === "FOLLOW_UPS"
            ) {
                await closeFollowUpsOnStatusChange(tx, id, data.status, performerAccountId);
                await syncLeadFollowUpAggregates(tx, id);
            }

            const diff: Record<string, any> = {};
            Object.keys(data).forEach((key) => {
                const oldVal = (existing as any)[key] ?? null;
                const newVal = data[key];
                if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                    diff[key] = { from: oldVal, to: newVal };
                }
            });

            if (Object.keys(diff).length > 0) {
                await tx.leadActivityLog.create({
                    data: {
                        leadId: id,
                        action: "UPDATED",
                        performedBy: performerAccountId,
                        meta: {
                            fromState: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.from])),
                            toState: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])),
                        },
                    },
                });
            }

            return lead;
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
                patch: {
                    status: updated.status,
                    source: updated.source,
                    demoScheduledAt: updated.demoScheduledAt,
                    demoDoneAt: updated.demoDoneAt,
                    demoCount: updated.demoCount,
                    updatedAt: updated.updatedAt,
                    isImportant: updated.isImportant,
                    remark: updated.remark,
                    cost: updated.cost,
                    product: updated.product,
                    productTitle: updated.productTitle,
                },
            };
            recipientAccountIds.forEach((accId) => {
                io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
            });
            io.to("leads:admin").emit("lead:patch", patchPayload);
        } catch {
            console.warn("Socket emit skipped");
        }

        return sendSuccessResponse(res, 200, "Lead updated", updated);
    } catch (err: any) {
        console.error("Update lead error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to update lead");
    }
}

/**
 * PATCH /admin/leads/:id/product
 *
 * Accepts either:
 *   { product: LeadProductItem, cost?: number }          — single product upsert
 *   { products: LeadProductItem[], mode: "replace"|"merge" } — bulk update
 */
export async function updateLeadProductAdmin(req: Request, res: Response) {
    try {
        // console.log("\n\n\n\n\n ->CHECK LOGs\n" )
        const performerAccountId = req.user?.accountId;
        if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

        const { id } = req.params;

        // ── Support both single-product and multi-product payloads ──
        const {
            product,          // legacy single-product path
            products,         // new array path (from client handleSave)
            mode = "merge",   // "replace" | "merge"  (default: merge for back-compat)
            productTitle,
            cost,
        } = req.body as Record<string, any>;

        // console.log("\n\n\n\n\n mode->\n", mode);


        const incomingProducts: Record<string, any>[] | null =
            products
                ? (Array.isArray(products) ? products : [products])
                : product
                    ? [product]
                    : null;

        if (!incomingProducts && !productTitle && cost === undefined)
            return sendErrorResponse(res, 400, "At least one field is required");

        /* ─────────────────────────────────────
           Fetch existing lead
        ───────────────────────────────────── */
        const existing = await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                customerId: true,
                product: true,
                productTitle: true,
                cost: true,
                status: true,
                assignments: {
                    where: { isActive: true },
                    select: { accountId: true, teamId: true },
                },
            },
        });
        if (!existing) return sendErrorResponse(res, 404, "Lead not found");

        /* ─────────────────────────────────────
           Resolve incoming products into
           a normalized array with defaults
        ───────────────────────────────────── */
        const resolvedIncoming: Record<string, any>[] = incomingProducts
            ? incomingProducts.map((p) => ({
                id: p.id ?? randomUUID(),
                slug: p.slug ?? null,
                link: p.link ?? null,
                title: p.title ?? null,
                introVideoId: p.introVideoId ?? null,
                cost: p.cost ?? cost ?? null,
                isPrimary: p.isPrimary ?? false,
            }))
            : [];

        /* ─────────────────────────────────────
           Merge or replace product array
        ───────────────────────────────────── */
        const currentProducts: Record<string, any>[] = Array.isArray(existing.product)
            ? (existing.product as Record<string, any>[])
            : existing.product
                ? [existing.product as Record<string, any>]
                : [];

        let nextProducts: Record<string, any>[];

        if (mode === "replace" || !resolvedIncoming.length) {
            // Full replace — discard old products entirely
            nextProducts = resolvedIncoming;
        } else {
            // Merge — upsert by id/slug, append new ones
            nextProducts = [...currentProducts];
            for (const incoming of resolvedIncoming) {
                const idx = nextProducts.findIndex(
                    (p) =>
                        p.id === incoming.id ||
                        p.productCatalogId === incoming.productCatalogId ||
                        p.adminProductId === incoming.adminProductId ||
                        (p.slug && p.slug === incoming.slug),
                );
                if (idx !== -1) {
                    nextProducts[idx] = {
                        ...nextProducts[idx],
                        ...incoming,
                        // Preserve cost from payload; fall back to existing
                        cost: incoming.cost ?? nextProducts[idx]?.cost ?? null,
                    };
                } else {
                    nextProducts.push(incoming);
                }
            }
        }

        // Derive root-level productTitle from the products array unless caller
        // explicitly supplied one
        const generatedTitle = nextProducts
            .map((p) => p.title)
            .filter(Boolean)
            .join(", ");

        const resolvedProductTitle =
            productTitle ?? (generatedTitle || null);

        // Derive root-level cost from primary product (or first) if not supplied
        const primary = nextProducts.find((p) => p.isPrimary) ?? nextProducts[0];
        // const resolvedCost = cost !== undefined ? cost : primary?.cost ?? existing.cost;

        const resolvedCost =
            cost !== undefined
                ? cost
                : nextProducts.reduce<number | null>((sum, p) => {
                    if (p.cost == null) return sum;
                    return (sum ?? 0) + Number(p.cost);
                }, null) ?? existing.cost;



        /* ─────────────────────────────────────
           Transaction
        ───────────────────────────────────── */
        const updated = await prisma.$transaction(async (tx) => {
            const lead = await tx.lead.update({
                where: { id },
                data: {
                    product: nextProducts,
                    productTitle: resolvedProductTitle,
                    cost: resolvedCost,
                },
                select: {
                    id: true,
                    customerId: true,
                    mobileNumber: true,
                    product: true,
                    productTitle: true,
                    cost: true,
                    updatedAt: true,
                    status: true,
                },
            });

            /* ── Centralized sync ── */
            await syncLeadProductsEverywhere(tx, {
                leadId: lead.id,
                performerAccountId,
            });

            /* ── Refetch after sync (sync may update productTitle/productCatalogId) ── */
            const syncedLead = await tx.lead.findUnique({
                where: { id: lead.id },
                select: {
                    id: true,
                    customerId: true,
                    mobileNumber: true,
                    product: true,
                    productTitle: true,
                    cost: true,
                    updatedAt: true,
                },
            });

            /* ── Activity log ── */
            await tx.leadActivityLog.create({
                data: {
                    leadId: id,
                    action: "UPDATED",
                    performedBy: performerAccountId,
                    meta: {
                        type: "PRODUCT_CORRECTED",
                        changes: {
                            from: existing.product,
                            to: syncedLead?.product,
                        },
                    },
                },
            });

            return syncedLead;
        });

        /* ─────────────────────────────────────
           Socket broadcast
        ───────────────────────────────────── */
        try {
            const io = getIo();
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

            const patchPayload = {
                id,
                patch: {
                    product: updated?.product,
                    productTitle: updated?.productTitle,
                    cost: updated?.cost,
                    updatedAt: updated?.updatedAt,
                },
            };

            recipientAccountIds.forEach((accId) =>
                io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload),
            );
            io.to("leads:admin").emit("lead:patch", patchPayload);
        } catch {
            console.warn("Socket emit skipped");
        }

        return sendSuccessResponse(res, 200, "Product details updated", updated);
    } catch (err: any) {
        console.error("Update lead product error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to update product details");
    }
}


export async function addLeadProductsAdmin(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;
        if (!performerAccountId)
            return sendErrorResponse(res, 401, "Invalid session user");

        const { id } = req.params;
        const { products: incomingProducts, mode = "merge" } = req.body as {
            products: LeadProductItem[];
            mode?: "replace" | "merge";
        };

        if (!Array.isArray(incomingProducts) || incomingProducts.length === 0)
            return sendErrorResponse(res, 400, "products array is required");

        for (const p of incomingProducts) {
            if (!p.id || !p.title)
                return sendErrorResponse(res, 400, `Each product must have id and title (got: ${JSON.stringify(p)})`);
        }

        const existing = await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                customerId: true,
                product: true,
                productTitle: true,
                cost: true,
                status: true,
                assignments: {
                    where: { isActive: true },
                    select: { accountId: true, teamId: true },
                },
            },
        });
        if (!existing) return sendErrorResponse(res, 404, "Lead not found");

        /* ── Build nextProducts (same logic as updateLeadProductAdmin) ── */
        const currentProducts: Record<string, any>[] = Array.isArray(existing.product)
            ? (existing.product as Record<string, any>[])
            : existing.product
                ? [existing.product as Record<string, any>]
                : [];

        let nextProducts: Record<string, any>[];

        if (mode === "replace") {
            nextProducts = incomingProducts.map((p) => ({
                id: p.id,
                slug: p.slug ?? null,
                link: p.link ?? null,
                title: p.title,
                introVideoId: p.introVideoId ?? null,
                cost: p.cost ?? null,
                isPrimary: p.isPrimary ?? false,
            }));
        } else {
            nextProducts = [...currentProducts];
            for (const p of incomingProducts) {
                const idx = nextProducts.findIndex(
                    (x) => x.id === p.id || (p.slug && x.slug === p.slug),
                );
                if (idx !== -1) {
                    nextProducts[idx] = {
                        ...nextProducts[idx],
                        ...p,
                        cost: p.cost ?? nextProducts[idx].cost ?? null,
                    };
                } else {
                    nextProducts.push({ ...p, isPrimary: p.isPrimary ?? false });
                }
            }
        }

        // Ensure one primary
        if (nextProducts.length > 0 && !nextProducts.some((p) => p.isPrimary)) {
            nextProducts[0].isPrimary = true;
        }

        const productTitle = nextProducts.map((p) => p.title).filter(Boolean).join(", ") || null;
        const primary = nextProducts.find((p) => p.isPrimary) ?? nextProducts[0];
        // const derivedCost = primary?.cost ?? existing.cost;
        const derivedCost =
            nextProducts.reduce<number | null>((sum, p) => {
                if (p.cost == null) return sum;
                return (sum ?? 0) + Number(p.cost);
            }, null) ?? existing.cost;


        /* ── Transaction ── */
        const updated = await prisma.$transaction(async (tx) => {
            await tx.lead.update({
                where: { id },
                data: {
                    product: nextProducts,
                    productTitle: productTitle ?? undefined,
                    cost: derivedCost ?? undefined,
                },
            });

            // Delegate ALL sync to the single source of truth
            await syncLeadProductsEverywhere(tx, { leadId: id, performerAccountId });

            const syncedLead = await tx.lead.findUnique({
                where: { id },
                select: {
                    id: true,
                    customerId: true,
                    mobileNumber: true,
                    product: true,
                    productTitle: true,
                    cost: true,
                    updatedAt: true,
                },
            });

            await tx.leadActivityLog.create({
                data: {
                    leadId: id,
                    action: "UPDATED",
                    performedBy: performerAccountId,
                    meta: {
                        type: "PRODUCTS_UPDATED",
                        mode,
                        previous: existing.product,
                        current: syncedLead?.product,
                    },
                },
            });

            return syncedLead;
        });

        /* ── Socket ── */
        try {
            const io = getIo();
            const patchPayload = {
                id,
                patch: {
                    product: updated?.product,
                    productTitle: updated?.productTitle,
                    cost: updated?.cost,
                    updatedAt: updated?.updatedAt,
                },
            };

            const assignee = existing.assignments[0];
            if (assignee?.accountId) {
                io.to(`leads:user:${assignee.accountId}`).emit("lead:patch", patchPayload);
            } else if (assignee?.teamId) {
                const members = await prisma.teamMember.findMany({
                    where: { teamId: assignee.teamId, isActive: true },
                    select: { accountId: true },
                });
                members.forEach((m) =>
                    io.to(`leads:user:${m.accountId}`).emit("lead:patch", patchPayload),
                );
            }
            io.to("leads:admin").emit("lead:patch", patchPayload);
        } catch {
            console.warn("Socket emit skipped");
        }

        return sendSuccessResponse(res, 200, "Products updated", updated);
    } catch (err: any) {
        console.error("Add lead products error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to update products");
    }
}

/* ============================================================
   CENTRALIZED SYNC
   Updates every table that mirrors lead product data:
     - Lead.product / productTitle / cost / productCatalogId / productCatalog[]
     - CustomerProduct (delete-and-recreate per lead)
     - Customer.products JSON
     - UserProductExpertise (upsert, incrementing leadsCount)
     - Quotation line items via syncProductCostToEntities
   Does NOT touch ProductCatalog.
   ============================================================ */
export async function syncLeadProductsEverywhere(
    tx: any,
    params: {
        leadId: string;
        performerAccountId?: string | null;
    },
) {
    const { leadId, performerAccountId } = params;

    /* ── Fetch lead ── */
    const lead = await tx.lead.findUnique({
        where: { id: leadId },
        select: {
            id: true,
            customerId: true,
            product: true,
            productTitle: true,
            cost: true,
            status: true,
        },
    });
    if (!lead) return;

    // console.log("\n\n\n\n\n\n\n\n\n\n lead->\n", lead);

    /* ─────────────────────────────────────
       Normalize product array
    ───────────────────────────────────── */
    const rawProducts: Record<string, any>[] = Array.isArray(lead.product)
        ? lead.product
        : lead.product
            ? [lead.product]
            : [];

    const resolvedProducts = await Promise.all(
        rawProducts.map(async (p: any) => {
            let catalogId: string | null = p.productCatalogId ?? null;

            if (!catalogId && p.id) {
                const catalog = await tx.productCatalog.findFirst({
                    where: {
                        OR: [
                            { id: p.id },
                            { adminProductId: p.id },
                        ],
                    },
                    select: { id: true },
                });
                catalogId = catalog?.id ?? null;
            } else if (catalogId) {
                // Verify the stored catalogId is the real PK, not an adminProductId
                const catalog = await tx.productCatalog.findFirst({
                    where: {
                        OR: [
                            { id: catalogId },
                            { adminProductId: catalogId },
                        ],
                    },
                    select: { id: true },
                });
                catalogId = catalog?.id ?? null;
            }

            return {
                ...p,
                id: catalogId ?? p.id,
                adminProductId:
                    p.adminProductId ??
                    (catalogId && catalogId !== p.id ? p.id : null),
                productCatalogId: catalogId,
                title: p.title ?? p.productTitle ?? p.name ?? null,
            };
        }),
    );

    const catalogIds: string[] = [
        ...new Set(
            resolvedProducts
                .map((p: any) => p.productCatalogId as string | null)
                .filter((id): id is string => Boolean(id)),
        ),
    ];

    /* ─────────────────────────────────────
       1. Update Lead row
          - product JSON (resolved)
          - productTitle (derived from titles)
          - cost (from primary/first product; keep existing if none)
          - productCatalogId (first catalog)
          - productCatalog[] relation
    ───────────────────────────────────── */
    const derivedTitle = resolvedProducts
        .map((p: any) => p.title)
        .filter(Boolean)
        .join(", ");

    const primary = resolvedProducts.find((p: any) => p.isPrimary) ?? resolvedProducts[0];
    // const derivedCost = primary?.cost ?? lead.cost;

    const derivedCost =
        resolvedProducts.reduce<number | null>((sum, p: any) => {
            if (p.cost == null) return sum;
            return (sum ?? 0) + Number(p.cost);
        }, null) ?? lead.cost;

    await tx.lead.update({
        where: { id: lead.id },
        data: {
            product: resolvedProducts,
            productTitle: derivedTitle || lead.productTitle,
            cost: derivedCost,

            ...(catalogIds[0] ? { productCatalogId: catalogIds[0] } : {}),

            productCatalog: {
                set: [],
                connect: catalogIds.map((id) => ({ id })),
            },
        },
    });

    /* ─────────────────────────────────────
       2. CustomerProduct — delete & recreate
          Preserve purchasedAt if already set
          (don't overwrite on re-sync of converted lead)
    ───────────────────────────────────── */


    if (lead.customerId) {
        // Snapshot existing purchasedAt values keyed by productCatalogId
        // so we don't lose the original purchase timestamp on re-sync.
        const isConverted = lead.status === "CONVERTED";
        const existingCPs: { productCatalogId: string | null; purchasedAt: Date | null }[] =
            await tx.customerProduct.findMany({
                where: { leadId: lead.id },
                select: { productCatalogId: true, purchasedAt: true },
            });

        const purchasedAtMap = new Map<string, Date | null>();
        for (const cp of existingCPs) {
            if (cp.productCatalogId) {
                purchasedAtMap.set(cp.productCatalogId, cp.purchasedAt);
            }
        }

        // Delete old records for this lead
        await tx.customerProduct.deleteMany({ where: { leadId: lead.id } });

        // Recreate
        // await Promise.all(
        //     resolvedProducts.map((p: any) => {
        //         const isConverted = lead.status === "CONVERTED";
        //         // Preserve previously recorded purchasedAt; only set now() for
        //         // newly converted leads that had no date yet.
        //         const existingPurchasedAt = p.productCatalogId
        //             ? purchasedAtMap.get(p.productCatalogId) ?? null
        //             : null;
        //         const purchasedAt = isConverted
        //             ? existingPurchasedAt ?? new Date()
        //             : null;

        //         return tx.customerProduct.create({
        //             data: {
        //                 customerId: lead.customerId,
        //                 leadId: lead.id,
        //                 productCatalogId: p.productCatalogId ?? null,
        //                 productTitle: p.title,
        //                 isActive: true,
        //                 isPurchase: isConverted,
        //                 purchasedAt,
        //                 meta: {
        //                     price: p.cost ?? null,
        //                     slug: p.slug ?? null,
        //                     introVideoId: p.introVideoId ?? null,
        //                 },
        //             },
        //         });
        //     }),
        // );


        // Recreate and capture created rows in memory
        const now = new Date();
        const createdThisLead = await Promise.all(
            resolvedProducts.map((p: any) => {
                const existingPurchasedAt = p.productCatalogId
                    ? purchasedAtMap.get(p.productCatalogId) ?? null
                    : null;
                const purchasedAt = isConverted
                    ? existingPurchasedAt ?? now
                    : null;

                return tx.customerProduct.create({
                    data: {
                        customerId: lead.customerId,
                        leadId: lead.id,
                        productCatalogId: p.productCatalogId ?? null,
                        productTitle: p.title,
                        isActive: true,
                        isPurchase: isConverted,
                        purchasedAt,
                        meta: {
                            price: p.cost ?? null,
                            slug: p.slug ?? null,
                            introVideoId: p.introVideoId ?? null,
                            adminProductId: p.adminProductId ?? null,
                        },
                    },
                    // Select everything needed for the JSON rebuild below
                    select: {
                        id: true,
                        productCatalogId: true,
                        productTitle: true,
                        purchasedAt: true,
                        expiresAt: true,
                        isActive: true,
                        isExpired: true,
                        createdAt: true,
                        meta: true,
                    },
                });
            }),
        );

        const otherCPs = await tx.customerProduct.findMany({
            where: {
                customerId: lead.customerId,
                leadId: { not: lead.id },
            },
            select: {
                id: true,
                productCatalogId: true,
                productTitle: true,
                purchasedAt: true,
                expiresAt: true,
                isActive: true,
                isExpired: true,
                createdAt: true,
                meta: true,
            },
            orderBy: { createdAt: "desc" },
        });

        const allCPs = [...createdThisLead, ...otherCPs];

        /* ── 3. Rebuild Customer.products JSON ── */
        // const customerProducts = await tx.customerProduct.findMany({
        //     where: { customerId: lead.customerId },
        //     orderBy: { createdAt: "desc" },
        // });

        // console.log("\n\n allCPs->\n", allCPs);

        const active = allCPs
            .filter((p) => p.isActive === true && p.isExpired === false)
            .map((p) => ({
                id: p.productCatalogId ?? p.id,
                name: p.productTitle,
                price: (p.meta as any)?.price ?? null,
                slug: (p.meta as any)?.slug ?? null,
                purchaseAt: p.purchasedAt,
                addedAt: p.createdAt,
                status: "ACTIVE",
            }));

        const history = allCPs
            .filter((p) => p.isExpired === true || p.isActive === false)
            .map((p) => ({
                id: p.productCatalogId ?? p.id,
                name: p.productTitle,
                price: (p.meta as any)?.price ?? null,
                slug: (p.meta as any)?.slug ?? null,
                purchaseAt: p.purchasedAt,
                expiresAt: p.expiresAt,
                addedAt: p.createdAt,
                status: "EXPIRED",
            }));

        // console.log("\n\n active->\n", active);
        // console.log("\n\n history->\n", history);

        await tx.customer.update({
            where: { id: lead.customerId },
            data: {
                products: { active, history },
                updatedAt: new Date(),
            },
        });
    }

    /* ─────────────────────────────────────
       4. UserProductExpertise — upsert
          FIX: increment leadsCount on update,
          not just refresh lastLeadAt.
    ───────────────────────────────────── */
    if (performerAccountId && catalogIds.length > 0) {
        await Promise.all(
            catalogIds.map((productCatalogId: string) =>
                tx.userProductExpertise.upsert({
                    where: {
                        userId_productCatalogId: {
                            userId: performerAccountId,
                            productCatalogId,
                        },
                    },
                    create: {
                        userId: performerAccountId,
                        productCatalogId,
                        leadsCount: 1,
                        lastLeadAt: new Date(),
                    },
                    update: {
                        leadsCount: { increment: 1 },   // FIX: was missing increment
                        lastLeadAt: new Date(),
                    },
                }),
            ),
        );
    }

    /* ─────────────────────────────────────
       5. Quotation sync
    ───────────────────────────────────── */
    await Promise.all(
        resolvedProducts.map((p: any) =>
            syncProductCostToEntities(tx, {
                leadId: lead.id,
                customerId: lead.customerId,
                productId: p.productCatalogId,
                productSlug: p.slug ?? null,
                productTitle: p.title,
                oldTitle: p.title,
                newCost: Number(p.cost ?? 0),
            }),
        ),
    );
}

/**
 * PATCH /admin/leads/:id/customer
 */
export async function updateLeadCustomerAdmin(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;
        if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

        const { id } = req.params;
        const { customerName, mobileNumber, customerCompanyName } = req.body as Record<string, string>;

        if (!customerName && !mobileNumber && !customerCompanyName)
            return sendErrorResponse(res, 400, "At least one field is required");

        const existing = await prisma.lead.findUnique({
            where: { id },
            select: {
                id: true,
                customerName: true,
                mobileNumber: true,
                customerCompanyName: true,
                assignments: {
                    where: { isActive: true },
                    select: { accountId: true, teamId: true },
                },
            },
        });
        if (!existing) return sendErrorResponse(res, 404, "Lead not found");

        const updateData: Record<string, any> = {};
        if (customerName) updateData.customerName = customerName.trim();
        if (mobileNumber) updateData.mobileNumber = normalizeMobile(mobileNumber);
        if (customerCompanyName !== undefined)
            updateData.customerCompanyName = customerCompanyName.trim() || null;

        const updated = await prisma.$transaction(async (tx) => {
            const lead = await tx.lead.update({ where: { id }, data: updateData });

            if (updateData.mobileNumber) {
                const targetCustomer = await tx.customer.findUnique({
                    where: { normalizedMobile: updateData.mobileNumber },
                    select: { id: true },
                });

                if (targetCustomer) {
                    await tx.lead.update({ where: { id }, data: { customerId: targetCustomer.id } });
                    await tx.customer.update({
                        where: { id: targetCustomer.id },
                        data: {
                            ...(updateData.customerName ? { name: updateData.customerName } : {}),
                            ...(updateData.customerCompanyName !== undefined
                                ? { customerCompanyName: updateData.customerCompanyName }
                                : {}),
                            updatedAt: new Date(),
                        },
                    });
                } else {
                    await tx.customer.updateMany({
                        where: { normalizedMobile: existing.mobileNumber },
                        data: {
                            ...(updateData.customerName ? { name: updateData.customerName } : {}),
                            ...(updateData.customerCompanyName !== undefined
                                ? { customerCompanyName: updateData.customerCompanyName }
                                : {}),
                            mobile: mobileNumber,
                            normalizedMobile: updateData.mobileNumber,
                            updatedAt: new Date(),
                        },
                    });
                }
            } else if (updateData.customerName || updateData.customerCompanyName !== undefined) {
                await tx.customer.updateMany({
                    where: { normalizedMobile: existing.mobileNumber },
                    data: {
                        ...(updateData.customerName ? { name: updateData.customerName } : {}),
                        ...(updateData.customerCompanyName !== undefined
                            ? { customerCompanyName: updateData.customerCompanyName }
                            : {}),
                        updatedAt: new Date(),
                    },
                });
            }

            return lead;
        });

        try {
            const io = getIo();
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
            const patchPayload = {
                id,
                patch: {
                    customerName: updated.customerName,
                    mobileNumber: updated.mobileNumber,
                    customerCompanyName: updated.customerCompanyName,
                    updatedAt: updated.updatedAt,
                },
            };
            recipientAccountIds.forEach((accId) =>
                io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload),
            );
            io.to("leads:admin").emit("lead:patch", patchPayload);
        } catch {
            console.warn("Socket emit skipped");
        }

        return sendSuccessResponse(res, 200, "Customer details updated", updated);
    } catch (err: any) {
        console.error("Update lead customer error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to update customer details");
    }
}


export async function updateLeadState(req: Request, res: Response) {
    try {
        const performerAccountId = req.user?.accountId;
        if (!performerAccountId)
            return sendErrorResponse(res, 401, "Invalid session user");

        const { id, stateId } = req.params;
        const { text } = req.body as { text?: string };

        if (!text?.trim())
            return sendErrorResponse(res, 400, "text is required");

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

        const stateIndex = states.findIndex((item) => item?.id === stateId);

        if (stateIndex === -1) {
            return sendErrorResponse(res, 404, "State not found");
        }

        const oldEntry = states[stateIndex];
        const updatedEntry: any = {
            ...oldEntry,
            text: text.trim(),
            edited: true,
            updatedAt: new Date().toISOString(),
        };

        const updatedStates = [...states];
        updatedStates[stateIndex] = updatedEntry;

        const updated = await prisma.lead.update({
            where: { id },
            data: {
                states: updatedStates,
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
                        type: "STATE_UPDATED",
                        stateId,
                        from: oldEntry.text,
                        to: updatedEntry.text,
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
                    stateAdded: updatedEntry,
                    updatedAt: updated.updatedAt,
                    states: updatedStates, // ← Include full array for socket sync
                },
            };
            io.to("leads:admin").emit("lead:patch", patchPayload);
            io.to(`leads:user:${performerAccountId}`).emit("lead:patch", patchPayload);
        } catch (socketErr) {
            console.warn("Socket emit failed:", socketErr);
        }

        return sendSuccessResponse(res, 200, "State updated", {
            state: updatedEntry,
            states: updatedStates, // ← Return full array
        });
    } catch (err: any) {
        console.error("updateLeadState error:", err);
        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to update state",
        );
    }
}










/**
 * PATCH user/leads/my/:id/status
 * Update status/remark as the assignee (account or team member)
 */
export async function updateMyLeadStatus(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { status, remark, cost, customerName, demoScheduledAt, isImportant } =
            req.body as {
                status?:
                | "PENDING"
                | "IN_PROGRESS"
                | "CLOSED"
                | "CONVERTED"
                | "DEMO_DONE"
                | "FOLLOW_UPS"
                | "INTERESTED";
                remark?: string;
                cost?: number;
                customerName?: string;
                demoScheduledAt?: string;
                isImportant?: boolean;
            };

        const accountId = req.user?.accountId;
        if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

        const TERMINAL_STATUSES = [
            "CLOSED",
            "DEMO_DONE",
            "CONVERTED",
            "FOLLOW_UPS",
            "PENDING",
        ] as const;

        const isTerminalStatus =
            typeof status !== "undefined" &&
            TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);

        const lead = await prisma.lead.findFirst({
            where: {
                id,
                OR: [
                    {
                        assignments: {
                            some: {
                                isActive: true,
                                OR: [
                                    { accountId },
                                    {
                                        team: {
                                            members: {
                                                some: { accountId },
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                    {
                        leadHelpers: {
                            some: {
                                isActive: true,
                                accountId,
                            },
                        },
                    },
                ],
            },
        });

        if (!lead) return sendErrorResponse(res, 403, "Access denied");
        const previousStatus = lead.status;

        const performerSnapshot = await resolvePerformerSnapshot(accountId);

        const updated = await prisma.$transaction(async (tx) => {
            // prepare update payload
            const data: any = {};
            if (typeof status !== "undefined") data.status = status;
            if (typeof remark !== "undefined") data.remark = remark;
            if (typeof cost !== "undefined") data.cost = cost;
            if (typeof customerName !== "undefined") data.customerName = customerName;
            if (data.status === "CLOSED" || data.status === "CONVERTED") {
                data.closedAt = new Date();
            }
            if (typeof isImportant !== "undefined") data.isImportant = isImportant;

            // prepare statusMark safely
            const statusMark = {
                ...(lead.statusMark as Record<string, boolean> | null),
            };

            if (status === "CLOSED") {
                statusMark.close = true;
            }

            if (status === "DEMO_DONE") {
                statusMark.demo = true;
                data.demoDoneAt = new Date();
            }

            if (status === "CONVERTED") {
                statusMark.converted = true;
                data.closedAt = new Date();
            }

            // only assign if something changed
            if (Object.keys(statusMark).length > 0) {
                data.statusMark = statusMark;
            }

            if (isTerminalStatus) {
                await stopWorkIfActive(tx, accountId, id);
                // close relevant follow-ups based on new status
                if (status === "DEMO_DONE" || status === "CLOSED" || status === "CONVERTED") {
                    await closeFollowUpsOnStatusChange(tx, id, status, accountId);
                    // re-sync lead aggregates after bulk follow-up update
                    await syncLeadFollowUpAggregates(tx, id);
                }
            }

            // ── demo scheduling / rescheduling ───────────────────────────────────
            if (demoScheduledAt !== undefined) {
                const newDate = new Date(demoScheduledAt);

                const isNewDate =
                    !lead.demoScheduledAt ||
                    lead.demoScheduledAt.getTime() !== newDate.getTime();

                if (isNewDate) {
                    data.demoScheduledAt = newDate;
                    data.demoCount = { increment: 1 };

                    // append to demoMeta.history
                    const existingMeta = lead.demoMeta as any;
                    const history: any[] = existingMeta?.history ?? [];
                    data.demoMeta = {
                        history: [
                            ...history,
                            {
                                type: lead.demoScheduledAt ? "RESCHEDULED" : "SCHEDULED",
                                at: newDate.toISOString(),
                                by: accountId,
                            },
                        ],
                    };
                }
            }

            // perform update
            const updatedLead = await tx.lead.update({
                where: { id },
                data,
                include: {
                    assignments: {
                        include: {
                            account: true,
                            team: true,
                        },
                    },
                },
            });

            // build snapshots and diffs
            const fromState = {
                id: lead.id,
                status: lead.status,
                remark: lead.remark ?? null,
                cost: lead.cost ?? null,
                customerName: lead.customerName ?? null,
                isImportant: lead.isImportant,
            };

            const toState = {
                id: updatedLead.id,
                status: updatedLead.status,
                remark: updatedLead.remark ?? null,
                cost: updatedLead.cost ?? null,
                customerName: updatedLead.customerName ?? null,
                isImportant: updatedLead.isImportant,
            };

            // Detect what changed
            const changedFields: Record<string, { from: any; to: any }> = {};
            if (fromState.status !== toState.status)
                changedFields.status = { from: fromState.status, to: toState.status };
            if ((fromState.remark ?? null) !== (toState.remark ?? null))
                changedFields.remark = { from: fromState.remark, to: toState.remark };
            if (fromState.isImportant !== toState.isImportant)
                changedFields.isImportant = { from: fromState.isImportant, to: toState.isImportant };
            // careful with Decimal types — convert to string/number for comparison
            const prevCost = fromState.cost == null ? null : Number(fromState.cost);
            const newCost = toState.cost == null ? null : Number(toState.cost);
            if (prevCost !== newCost)
                changedFields.cost = { from: prevCost, to: newCost };
            if ((fromState.customerName ?? null) !== (toState.customerName ?? null))
                changedFields.customerName = {
                    from: fromState.customerName,
                    to: toState.customerName,
                };

            // ── Update UserProductExpertise ──────────────────────────────────────
            // This handles demoCount, leadsConverted, successRate, and CustomerProduct.isPurchase
            if (status) {
                await updateUserProductExpertise({
                    prisma: tx as any,
                    accountId: accountId,
                    productCatalogId: lead.productCatalogId,
                    previousStatus,
                    newStatus: status,
                    leadId: lead.id,
                });
            }

            // ── Activity logs ────────────────────────────────────────────────────
            // 1) STATUS_CHANGED (if status changed)
            if (changedFields.status) {
                await tx.leadActivityLog.create({
                    data: {
                        leadId: id,
                        action: "STATUS_CHANGED",
                        performedBy: accountId,
                        meta: {
                            fromState: lead,
                            toState: updatedLead,
                        },
                    },
                });
            }

            // 2) UPDATED (if non-status fields changed: cost, customerName, remark)
            const nonStatusKeys = ["cost", "customerName", "remark"];
            const hasNonStatusChange = nonStatusKeys.some((k) =>
                Object.prototype.hasOwnProperty.call(changedFields, k),
            );
            if (hasNonStatusChange) {
                const changes: Record<string, any> = {};
                for (const k of nonStatusKeys) {
                    if (changedFields[k]) changes[k] = changedFields[k];
                }

                await tx.leadActivityLog.create({
                    data: {
                        leadId: id,
                        action: "UPDATED",
                        performedBy: accountId,
                        meta: {
                            fromState: lead,
                            toState: updatedLead,
                        },
                    },
                });
            }

            // 3) CLOSED (if lead became CLOSED)
            const becameClosed =
                changedFields.status && changedFields.status.to === "CLOSED";

            if (becameClosed) {
                await tx.leadActivityLog.create({
                    data: {
                        leadId: id,
                        action: "CLOSED",
                        performedBy: accountId,
                        meta: {
                            closedBy: performerSnapshot,
                            closedAt: new Date().toISOString(),
                        },
                    },
                });
            }

            return updatedLead;
        });

        try {
            const io = getIo();

            const patchPayload = {
                id,
                patch: {
                    status: updated.status,
                    demoDoneAt: updated.demoDoneAt,
                    updatedAt: updated.updatedAt,
                    isImportant: updated.isImportant,
                    remark: updated.remark,
                    cost: updated.cost,
                    customerName: updated.customerName,
                    productTitle: updated.productTitle,
                    product: updated.product,
                },
            };

            io.to(`leads:user:${accountId}`).emit("lead:patch", patchPayload);
            io.to("leads:admin").emit("lead:patch", patchPayload);
        } catch {
            console.warn("Socket emit skipped");
        }

        return sendSuccessResponse(res, 200, "Lead updated", updated);
    } catch (err: any) {
        console.error("Update lead status error:", err);
        return sendErrorResponse(res, 500, err?.message ?? "Failed to update lead");
    }
}