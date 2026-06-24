
import { randomUUID } from "crypto";
import { prisma } from "../../../config/database.config";
import { Lead_Status, PrismaClient } from "@prisma/client";
import { getIo } from "../../../core/utils/socket";


export interface LeadProductItem {
    id: string;
    title: string;
    slug: string | any | null;
    link: string | any | null;
    introVideoId: string | any | null;
    cost: number | null;
    price?: number | null;
    isPrimary: boolean;
}

export type LeadSource =
    | "MANUAL"
    | "WHATSAPP"
    | "INQUIRY_FORM"
    | "WEBSITE"
    | "YOUTUBE"
    | "ADVERTISEMENT"
    | "PBN";
export type LeadType = "LEAD" | "SUPPORT";
export type LeadStatus =
    | "PENDING"
    | "IN_PROGRESS"
    | "FOLLOW_UPS"
    | "CLOSED"
    | "CONVERTED"
    | "DEMO_DONE"
    | "INTERESTED";
export type LeadActivityAction =
    | "CREATED"
    | "ASSIGNED"
    | "STATUS_CHANGED"
    | "ASSIGN_CHANGED"
    | "UPDATED"
    | "CLOSED"
    | "HELPER_ADDED"
    | "HELPER_REMOVED"
    | "REMINDER_SENT";
export type AssignmentType = "ACCOUNT" | "TEAM";
export type LeadHelperRole = "EXPORT" | "SUPPORT" | "CONSULT";
export type FollowUpStatus = "PENDING" | "DONE" | "MISSED" | "RESCHEDULED";
export type FollowUpType =
    | "CALL"
    | "DEMO"
    | "MEETING"
    | "VISIT"
    | "WHATSAPP"
    | "OTHER";

export interface CreateLeadInput {
    source: LeadSource;
    type: LeadType;
    customerName: string;
    mobileNumber: string;
    customerCompanyName?: string;
    cost?: any;
    remark?: string;
    assigneeAccountId?: string;
    assigneeTeamId?: string;
    demoDate?: string;
    followUps?: Array<{ type?: FollowUpType; scheduledAt: string; remark?: string }>;
    customerCategory?: string;
    businessCategory?: string;
    state?: string;
    city?: string;
    tallySerial?: string;
    tallyVersion?: string;
    isImportant?: boolean;
    forceCreate?: boolean;
    products?: LeadProductItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export const normalizeMobile = (m: unknown) => String(m ?? "").replace(/\D/g, "");

export function normalizeLeadProducts(raw: unknown): LeadProductItem[] {
    if (Array.isArray(raw)) return raw as LeadProductItem[];
    if (raw && typeof raw === "object") return [raw as LeadProductItem];
    return [];
}

export function deriveLeadMeta(products: LeadProductItem[]) {
    const productTitle =
        products
            .map((p) => p.title)
            .filter(Boolean)
            .join(", ") || null;
    const cost = products.reduce((sum, p) => sum + (p.cost ?? 0), 0) || null;
    return { productTitle, cost };
}

/**
 * Resolve a ProductCatalog row from an incoming product item.
 * Tries adminProductId first, then falls back to the cuid PK.
 * Returns null gracefully on any error or miss.
 */
type ProductCatalogLookup = {
    id: string;
    title?: string | null;
    slug?: string | null;
};

export async function resolveProductCatalogId(
    tx: any,
    product: ProductCatalogLookup | null | undefined,
): Promise<{ catalogId: string | null; catalogData: any }> {
    if (!product?.id) return { catalogId: null, catalogData: null };

    try {
        let catalog: any = null;

        /* ── 1. adminProductId ───────────────────────────── */

        if (product.id) {
            catalog =
                await tx.productCatalog.findFirst({
                    where: {
                        OR: [
                            {
                                adminProductId:
                                    product.id,
                            },
                            {
                                id: product.id,
                            },
                        ],
                    },
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                    },
                });
        }

        /* ── 2. slug fallback ───────────────────────────── */

        if (!catalog && product.slug) {
            catalog =
                await tx.productCatalog.findFirst({
                    where: {
                        slug: product.slug,
                    },
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                    },
                });
        }


        /* ── 3. title fallback ──────────────────────────── */

        if (!catalog && product.title) {
            catalog =
                await tx.productCatalog.findFirst({
                    where: {
                        title: {
                            equals:
                                product.title,
                            mode: "insensitive",
                        },
                    },
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                    },
                });
        }

        // let catalog = await tx.productCatalog.findUnique({
        //     where: { adminProductId: product.id },
        //     select: { id: true, title: true, slug: true },
        // });

        // if (!catalog) {
        //     catalog = await tx.productCatalog.findUnique({
        //         where: { id: product.id },
        //         select: { id: true, title: true, slug: true },
        //     });
        // }

        return {
            catalogId:
                catalog?.id ?? null,
            catalogData:
                catalog ?? null,
        };
    } catch {
        return { catalogId: null, catalogData: null };
    }
}

/**
 * Upsert a single CustomerProduct row.
 *
 * Strategy: findFirst by (customerId + catalogId OR productTitle) then
 * update-or-create.  Avoids the brittle "fake ID" upsert pattern.
 */
export async function upsertCustomerProduct(
    tx: any,
    params: {
        accountId?: string,
        leadId?: string;
        customerId: string;
        productCatalogId: string | null;
        productTitle: string;
        meta?: Record<string, any>;
        isActive?: boolean;
    },
): Promise<void> {
    const { accountId, leadId, customerId, productCatalogId, productTitle, meta = {}, isActive = true } =
        params;

    // Match by catalogId when available, otherwise fall back to title match
    const existing = await tx.customerProduct.findFirst({
        where: {
            customerId,
            ...(leadId
                ? { leadId }
                : {}),
            ...(productCatalogId
                ? { productCatalogId }
                : { productTitle }),
        },
        select: { id: true, productCatalogId: true },
    });

    if (existing) {
        await tx.customerProduct.update({
            where: { id: existing.id },
            data: { leadId, productTitle, isActive, meta, updatedAt: new Date() },
        });
    } else {
        const customerPro = await tx.customerProduct.create({
            data: {
                leadId,
                customerId,
                productCatalogId,
                productTitle,
                isActive,
                meta,
            },
        });
        if (accountId && customerPro.productCatalogId) {

            await tx.userProductExpertise.upsert({
                where: {
                    userId_productCatalogId: {
                        userId: accountId,
                        productCatalogId: customerPro.productCatalogId,
                    },
                },
                create: {
                    userId: accountId,
                    productCatalogId: customerPro.productCatalogId,
                    leadsCount: 1,
                    lastLeadAt: new Date(),

                },
                update: {
                    leadsCount: {
                        increment: 1,
                    },
                    lastLeadAt: new Date(),
                },
            });
        }
    }
}

export async function resolveAssigneeSnapshot(input: {
    accountId?: string | null;
    teamId?: string | null;
}) {
    if (input.accountId) {
        const acc = await prisma.account.findUnique({
            where: { id: input.accountId },
            select: { id: true, firstName: true, avatar: true, lastName: true },
        });
        return acc
            ? { type: "ACCOUNT", id: acc.id, name: `${acc.firstName} ${acc.lastName}` }
            : null;
    }

    if (input.teamId) {
        const team = await prisma.team.findUnique({
            where: { id: input.teamId },
            select: { id: true, name: true },
        });
        return team ? { type: "TEAM", id: team.id, name: team.name } : null;
    }

    return null;
}

export async function resolvePerformerSnapshot(accountId: string) {
    const acc = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            id: true,
            firstName: true,
            avatar: true,
            lastName: true,
            designation: true,
            contactPhone: true,
        },
    });

    if (!acc) return null;

    return {
        id: acc.id,
        name: `${acc.firstName} ${acc.lastName}`,
        designation: acc.designation ?? null,
        contactPhone: acc.contactPhone ?? null,
        avatar: acc.avatar ?? null
    };
}

/**
 * Syncs a product cost change across:
 *  1. customer.products.active[].price  (legacy JSON blob)
 *  2. All DRAFT quotations linked to this lead (lineItems + financials recomputed)
 */
export async function syncProductCostToEntities(
    tx: any,
    params: {
        leadId: string;
        customerId: string | null;
        productId?: string | null;
        productSlug?: string | null;
        productTitle?: string | null;
        oldTitle?: string | null;
        newCost: number;
    },
) {
    const { leadId, customerId, productId, productSlug, productTitle, oldTitle, newCost } =
        params;

    /* ── 1. Customer JSON blob sync ─────────────────────────────── */
    if (customerId) {
        const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { id: true, products: true },
        });

        if (customer) {
            const cp: any = customer.products ?? { active: [], history: [] };
            if (!Array.isArray(cp.active)) cp.active = [];

            const idx = cp.active.findIndex(
                (p: any) =>
                    (productId && p.id === productId) ||
                    (productTitle && p.name === productTitle) ||
                    (oldTitle && p.name === oldTitle),
            );

            if (idx !== -1) {
                cp.active[idx].price = newCost;
                if (productTitle) cp.active[idx].name = productTitle;
            }

            await tx.customer.update({
                where: { id: customerId },
                data: { products: cp, updatedAt: new Date() },
            });
        }
    }

    /* ── 2. Quotation sync (DRAFT only) ─────────────────────────── */
    const draftQuotations = await tx.quotation.findMany({
        where: { leadId, status: "DRAFT" },
        select: {
            id: true,
            extraDiscountType: true,
            extraDiscountValue: true,
            lineItems: {
                select: {
                    id: true,
                    productCatalogId: true,
                    productSlug: true,
                    name: true,
                    qty: true,
                    basePrice: true,
                    discountType: true,
                    discountValue: true,
                    taxType: true,
                    taxPercent: true,
                    taxAmount: true,
                    totalPrice: true,
                    discountedPrice: true,
                },
            },
        },
    });

    for (const q of draftQuotations) {
        const items: any[] = Array.isArray(q.lineItems) ? q.lineItems : [];
        let changed = false;

        const updatedItems = items.map((item: any) => {
            const matches =
                (productId && item.productId === productId) ||
                (productSlug && item.productSlug === productSlug) ||
                (productTitle && item.name === productTitle) ||
                (oldTitle && item.name === oldTitle);

            if (!matches) return { id: item.id, data: null };
            changed = true;

            const qty = Math.max(Number(item.qty) || 1, 1);
            const dv = Number(item.discountValue) || 0;
            const tp = Number(item.taxPercent) || 0;

            let dp = newCost;
            if (item.discountType === "PERCENTAGE") dp = newCost - (newCost * dv) / 100;
            else if (item.discountType === "FLAT") dp = Math.max(newCost - dv, 0);

            const taxable = dp * qty;
            const taxAmount = item.taxType === "NONE" ? 0 : (taxable * tp) / 100;

            return {
                ...item,
                basePrice: newCost,
                discountedPrice: parseFloat(dp.toFixed(2)),
                taxAmount: parseFloat(taxAmount.toFixed(2)),
                totalPrice: parseFloat((taxable + taxAmount).toFixed(2)),
            };
        });

        if (!changed) continue;

        for (const li of updatedItems) {
            if (!li.data) continue;
            await tx.quotationLineItem.update({ where: { id: li.id }, data: li.data });
        }

        let subtotal = 0, totalDiscount = 0, totalTax = 0;
        for (const item of updatedItems) {
            const qty = Math.max(Number(item.qty) || 1, 1);
            const base = Number(item.basePrice) || 0;
            const dv = Number(item.discountValue) || 0;
            let dp = base;
            if (item.discountType === "PERCENTAGE") dp = base - (base * dv) / 100;
            else if (item.discountType === "FLAT") dp = Math.max(base - dv, 0);
            subtotal += dp * qty;
            totalDiscount += (base - dp) * qty;
            totalTax += Number(item.taxAmount) || 0;
        }

        const edv = Number(q.extraDiscountValue) || 0;
        let extraDiscount = 0;
        if (edv > 0 && q.extraDiscountType) {
            extraDiscount =
                q.extraDiscountType === "PERCENTAGE"
                    ? (subtotal * edv) / 100
                    : Math.min(edv, subtotal);
        }
        totalDiscount += extraDiscount;
        const grandTotal = Math.max(subtotal - extraDiscount + totalTax, 0);

        await tx.quotation.update({
            where: { id: q.id },
            data: {
                subtotal: parseFloat(subtotal.toFixed(2)),
                totalDiscount: parseFloat(totalDiscount.toFixed(2)),
                totalTax: parseFloat(totalTax.toFixed(2)),
                grandTotal: parseFloat(grandTotal.toFixed(2)),
            },
        });
    }
}

export async function closeFollowUpsOnStatusChange(
    tx: any,
    leadId: string,
    newStatus: string,
    accountId: string,
): Promise<void> {
    const now = new Date();

    if (newStatus === "DEMO_DONE") {
        await tx.leadFollowUp.updateMany({
            where: { leadId, status: "PENDING", type: "DEMO" },
            data: {
                status: "DONE",
                doneAt: now,
                doneBy: accountId,
                remark: "Auto-marked done: Lead status changed to DEMO_DONE",
            },
        });
        return;
    }

    if (newStatus === "FOLLOW_UPS") {
        await tx.leadFollowUp.updateMany({
            where: { leadId, status: "PENDING", type: "CALL" },
            data: {
                status: "DONE",
                doneAt: now,
                doneBy: accountId,
                remark: "Auto-marked done: Lead status changed to FOLLOW UP",
            },
        });
        return;
    }

    if (newStatus === "CLOSED" || newStatus === "CONVERTED") {
        await tx.leadFollowUp.updateMany({
            where: { leadId, status: "PENDING" },
            data: {
                status: "DONE",
                doneAt: now,
                doneBy: accountId,
                remark: `Auto-marked done: Lead status changed to ${newStatus}`,
            },
        });
    }
}

export async function stopOnWorking(
    tx: any,
    leadId: string,
    accountId: string,
): Promise<number> {
    const now = new Date();

    // Find active assignment/work session
    const activeAssignment = await tx.leadAssignment.findFirst({
        where: {
            leadId,
            accountId,
            isActive: true,
        },
        orderBy: {
            assignedAt: "desc",
        },
        select: {
            id: true,
            WorkSeconds: true,
            assignedAt: true,
        },
    });

    let sessionSeconds = 0;

    if (activeAssignment?.assignedAt) {
        sessionSeconds = Math.max(
            0,
            Math.floor(
                (now.getTime() - activeAssignment.assignedAt.getTime()) / 1000,
            ),
        );
    }

    // Update lead total work seconds
    await tx.lead.update({
        where: {
            id: leadId,
        },
        data: {
            isWorking: false,
            totalWorkSeconds: {
                increment: sessionSeconds,
            },
        },
    });

    // Update assignment work seconds
    if (activeAssignment) {
        await tx.leadAssignment.update({
            where: {
                id: activeAssignment.id,
            },
            data: {
                WorkSeconds: {
                    increment: sessionSeconds,
                },
            },
        });
    }

    // Release employee
    await tx.account.update({
        where: {
            id: accountId,
        },
        data: {
            isBusy: false,
            activeLeadId: null,
        },
    });

    return sessionSeconds;
}

/**
 * Syncs product changes from a Lead update into CustomerProduct rows.
 * Called inside a transaction when lead.product or lead.productTitle changes.
 */
export async function syncLeadProductToCustomer(
    tx: any,
    params: {
        leadId: string;
        customerId: string | null;
        newProduct: LeadProductItem | Record<string, any>;
        oldProduct: LeadProductItem | Record<string, any>;
        performerAccountId: string;
    },
): Promise<void> {
    const { customerId, newProduct, oldProduct } = params;
    if (!customerId) return;

    const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true, products: true },
    });
    if (!customer) return;

    const oldTitle = (oldProduct as any)?.title || null;
    const oldId = (oldProduct as any)?.id || null;
    const newTitle = (newProduct as any)?.title || (newProduct as any)?.name || null;
    const newId = (newProduct as any)?.id || null;
    const newSlug = (newProduct as any)?.slug || null;
    const newCost = (newProduct as any)?.cost || null;
    const newIntroVideoId = (newProduct as any)?.introVideoId || null;

    /* ── Resolve ProductCatalog for new product ── */
    let catalogId: string | null = null;
    if (newId) {
        const { catalogId: resolved } = await resolveProductCatalogId(tx, {
            id: newId,
            title: newTitle ?? "",
            slug: newSlug,
        } as LeadProductItem);
        catalogId = resolved;
    }

    /* ── Update legacy customer.products JSON blob ── */
    const cp: any = customer.products ?? { active: [], history: [] };
    if (!Array.isArray(cp.active)) cp.active = [];
    if (!Array.isArray(cp.history)) cp.history = [];

    const activeIdx = cp.active.findIndex((p: any) => {
        if (oldId && p.id === oldId) return true;
        if (oldTitle && p.name === oldTitle) return true;
        return false;
    });

    if (activeIdx !== -1) {
        cp.active[activeIdx].name = newTitle ?? oldTitle ?? "Unknown Product";
        cp.active[activeIdx].price = newCost ?? cp.active[activeIdx].price ?? null;
        cp.active[activeIdx].slug = newSlug ?? cp.active[activeIdx].slug ?? null;
        if (newId) cp.active[activeIdx].id = newId;
    } else if (newTitle) {
        cp.active.push({
            id: newId || randomUUID(),
            name: newTitle,
            price: newCost ?? null,
            slug: newSlug ?? null,
            status: "ACTIVE",
            addedAt: new Date(),
        });
    }

    /* ── Upsert CustomerProduct (normalized) ── */
    if (newTitle) {
        await upsertCustomerProduct(tx, {
            customerId,
            productCatalogId: catalogId,
            productTitle: newTitle,
            isActive: true,
            meta: {
                price: newCost ?? null,
                slug: newSlug ?? null,
                introVideoId: newIntroVideoId ?? null,
            },
        });

        // Mark old product inactive if title changed
        if (oldTitle && oldTitle !== newTitle) {
            const oldCatalogId = oldId
                ? (await resolveProductCatalogId(tx, { id: oldId, title: oldTitle }))
                    .catalogId
                : null;

            const oldCp = await tx.customerProduct.findFirst({
                where: {
                    customerId,
                    ...(oldCatalogId
                        ? { productCatalogId: oldCatalogId }
                        : { productTitle: oldTitle }),
                },
                select: { id: true },
            });

            if (oldCp) {
                await tx.customerProduct.update({
                    where: { id: oldCp.id },
                    data: {
                        isExpired: true,
                        meta: { reason: "Replaced by lead update", replacedWith: newTitle },
                    },
                });
            }
        }
    }

    /* ─────────────────────────────────────────────
   Rebuild legacy customer.products JSON
───────────────────────────────────────────── */

    const customerProducts =
        await tx.customerProduct.findMany({
            where: {
                customerId,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

    const active = customerProducts
        .filter(
            (p: any) =>
                p.isPurchase === true &&
                p.isExpired === false,
        )
        .map((p: any) => ({
            id:
                p.productCatalogId ??
                p.id,
            name: p.productTitle,
            price:
                (p.meta as any)?.price ??
                null,
            slug:
                (p.meta as any)?.slug ??
                null,
            purchaseAt: p.purchasedAt,
            addedAt: p.createdAt,
            status: "ACTIVE",
        }));

    const history = customerProducts
        .filter((p: any) => p.isExpired === true)
        .map((p: any) => ({
            id:
                p.productCatalogId ??
                p.id,
            name: p.productTitle,
            price:
                (p.meta as any)?.price ??
                null,
            slug:
                (p.meta as any)?.slug ??
                null,
            purchaseAt: p.purchasedAt,
            expiresAt: p.expiresAt,
            addedAt: p.createdAt,
            status: "EXPIRED",
        }));

    await tx.customer.update({
        where: { id: customerId },
        data: {
            products: {
                active,
                history,
            },
            updatedAt: new Date(),
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE LEAD CREATION LOGIC
// Extracted so both createLeadAdmin and createMyLead share identical behavior.
// ─────────────────────────────────────────────────────────────────────────────

export async function createLeadCore(
    creatorAccountId: string,
    input: CreateLeadInput,
): Promise<{
    lead: any;
    recipients: string[];
    createdFollowUps: any[];
}> {
    const {
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
        followUps = [],
        customerCategory,
        businessCategory,
        state,
        city,
        tallySerial,
        tallyVersion,
        isImportant = false,
        products = [],
    } = input;

    const normalizedMobile = normalizeMobile(mobileNumber);
    const { productTitle, totalCost } = deriveLeadScalars(products, cost);

    const initialAssignee = await resolveAssigneeSnapshot({
        accountId: assigneeAccountId,
        teamId: assigneeTeamId,
    });

    return prisma.$transaction(async (tx) => {
        /* ── 1. Customer upsert ─────────────────────────────────────────── */
        let customer = await tx.customer.findUnique({ where: { normalizedMobile } });

        if (customer) {
            const existingProducts: any = customer.products ?? { active: [], history: [] };
            if (!Array.isArray(existingProducts.active)) existingProducts.active = [];
            if (!Array.isArray(existingProducts.history)) existingProducts.history = [];

            for (const entry of buildCustomerProductEntries(products)) {
                const alreadyExists = existingProducts.active.some(
                    (p: any) => p.id === entry.id || p.name === entry.name,
                );
                if (!alreadyExists) existingProducts.active.push(entry);
            }

            customer = await tx.customer.update({
                where: { id: customer.id },
                data: {
                    name: customerName || customer.name,
                    customerCompanyName: customerCompanyName || customer.customerCompanyName,
                    products: existingProducts,
                    ...(customerCategory && { customerCategory }),
                    ...(businessCategory && { businessCategory }),
                    ...(state && { state }),
                    ...(city && { city }),
                    ...(tallySerial && { tallySerial }),
                    ...(tallyVersion && { tallyVersion }),
                    updatedAt: new Date(),
                },
            });
        } else {
            const customerProducts =
                products.length > 0
                    ? { active: buildCustomerProductEntries(products), history: [] }
                    : undefined;

            customer = await tx.customer.create({
                data: {
                    name: customerName,
                    mobile: mobileNumber,
                    customerCompanyName,
                    normalizedMobile,
                    createdBy: creatorAccountId,
                    products: customerProducts,
                    tallySerial: tallySerial ?? undefined,
                    tallyVersion: tallyVersion ?? undefined,
                    customerCategory: customerCategory ?? undefined,
                    businessCategory: businessCategory ?? undefined,
                    state: state ?? undefined,
                    city: city ?? undefined,
                    joiningDate: new Date(),
                },
            });
        }

        /* ── 2. Upsert CustomerProduct rows (normalized, catalog-linked) ── */
        // for (const product of products) {
        //     const { catalogId } = await resolveProductCatalogId(tx, product);

        //     await upsertCustomerProduct(tx, {
        //         accountId: assigneeAccountId,
        //         customerId: customer.id,
        //         productCatalogId: catalogId,
        //         productTitle: product.title,
        //         isActive: true,
        //         meta: {
        //             price: product.cost ?? null,
        //             slug: product.slug ?? null,
        //             introVideoId: product.introVideoId ?? null,
        //         },
        //     });
        // }

        /* ── 2. Upsert CustomerProduct rows ───────────────────────────── */
        await Promise.all(
            products.map(async (product) => {
                const { catalogId } = await resolveProductCatalogId(tx, product);

                return upsertCustomerProduct(tx, {
                    accountId: assigneeAccountId,
                    customerId: customer.id,
                    productCatalogId: catalogId,
                    productTitle: product.title,
                    isActive: true,
                    meta: {
                        price: product.cost ?? null,
                        slug: product.slug ?? null,
                        introVideoId: product.introVideoId ?? null,
                    },
                });
            }),
        );

        /* ── 3. Create Lead ─────────────────────────────────────────────── */
        const created = await tx.lead.create({
            data: {
                source,
                type,
                customerId: customer.id,
                customerName: customer.name,
                customerCompanyName: customer.customerCompanyName,
                mobileNumber: normalizedMobile,
                product: (products.length > 0
                    ? products.length === 1
                        ? products[0]
                        : products
                    : undefined) as any,
                productTitle: productTitle ?? undefined,
                cost: totalCost ?? undefined,
                remark: remark ?? undefined,
                isImportant,
                createdBy: creatorAccountId,
                demoScheduledAt: demoDate ? new Date(demoDate) : undefined,
                demoCount: demoDate ? 1 : 0,
                demoMeta: demoDate
                    ? {
                        history: [
                            { type: "SCHEDULED", at: new Date(demoDate), by: creatorAccountId },
                        ],
                    }
                    : undefined,
            },
        });

        /* ── 4. Link primary ProductCatalog to Lead ─────────────────────── */
        if (products.length > 0) {
            const { catalogId } = await resolveProductCatalogId(tx, products[0]);
            const catalogIds = (
                await Promise.all(
                    products.map(async (product) => {
                        const { catalogId } = await resolveProductCatalogId(tx, product);
                        return catalogId;
                    }),
                )
            )
                .filter(Boolean)
                .filter(
                    (id, index, arr) => arr.indexOf(id) === index,
                ) as string[];

            if (catalogId) {
                await tx.lead.update({
                    where: { id: created.id },
                    data: { productCatalogId: catalogId },
                });
                await tx.lead.update({
                    where: { id: created.id },
                    data: {
                        productCatalog: {
                            connect: catalogIds.map((id) => ({ id })),
                        },
                    },
                });

                await Promise.all(
                    catalogIds.map((id) =>
                        tx.customerProduct.updateMany({
                            where: {
                                customerId: customer.id,
                                productCatalogId: id,
                                leadId: null,
                            },
                            data: {
                                leadId: created.id,
                            },
                        }),
                    ),
                );
            }
        }

        /* ── 5. Assignment ──────────────────────────────────────────────── */
        await tx.leadAssignment.create({
            data: {
                leadId: created.id,
                type: assigneeAccountId ? "ACCOUNT" : "TEAM",
                accountId: assigneeAccountId ?? null,
                teamId: assigneeTeamId ?? null,
                isActive: true,
                assignedBy: creatorAccountId,
                assignedAt: new Date(),
                unassignedAt: null,
            },
        });

        // Add to expertise if assigned to an account
        if (assigneeAccountId && products.length > 0) {
            const { catalogId } = await resolveProductCatalogId(tx, products[0]);
            if (catalogId) {
                await syncLeadExpertise({
                    prisma: tx,
                    accountId: assigneeAccountId,
                    productCatalogId: catalogId,
                    leadsCountDelta: 1,
                    demoCountDelta: demoDate ? 1 : 0,
                    lastDemoAt: demoDate ? new Date(demoDate) : null,
                    lastLeadAt: new Date(),
                });
            }
        }

        /* ── 6. Activity log ────────────────────────────────────────────── */
        await tx.leadActivityLog.create({
            data: {
                leadId: created.id,
                action: "CREATED",
                performedBy: creatorAccountId,
                meta: {
                    source,
                    type,
                    initialAssignment: initialAssignee,
                    demoScheduledAt: demoDate ?? null,
                    products: products.length > 0 ? JSON.parse(JSON.stringify(products)) : null,
                    forcedDuplicate: input.forceCreate || undefined,
                },
            },
        });

        /* ── 7. Resolve recipients ──────────────────────────────────────── */
        let recipientAccountIds: string[] = [];
        if (assigneeAccountId) {
            recipientAccountIds = [assigneeAccountId];
        } else if (assigneeTeamId) {
            const members = await tx.teamMember.findMany({
                where: { teamId: assigneeTeamId, isActive: true },
                select: { accountId: true },
            });
            recipientAccountIds = members.map((m) => m.accountId);
        }

        /* ── 8. Follow-ups ──────────────────────────────────────────────── */
        let createdFollowUps: any[] = [];

        if (Array.isArray(followUps) && followUps.length > 0) {
            const invalid = followUps.some((f) => !f.scheduledAt);
            if (invalid) throw new Error("Each follow-up must have a scheduledAt");

            await tx.leadFollowUp.createMany({
                data: followUps.map((f) => ({
                    leadId: created.id,
                    type: f.type ?? "CALL",
                    status: "PENDING" as const,
                    scheduledAt: new Date(f.scheduledAt),
                    remark: f.remark ?? null,
                    createdBy: creatorAccountId,
                })),
            });

            createdFollowUps = await tx.leadFollowUp.findMany({
                where: { leadId: created.id },
                orderBy: { scheduledAt: "asc" },
            });

            await tx.lead.update({
                where: { id: created.id },
                data: {
                    followUpCount: createdFollowUps.length,
                    nextFollowUpAt: createdFollowUps[0].scheduledAt,
                },
            });

            await tx.leadActivityLog.create({
                data: {
                    leadId: created.id,
                    action: "FOLLOW_UP_SCHEDULED",
                    performedBy: creatorAccountId,
                    meta: {
                        count: createdFollowUps.length,
                        followUps: createdFollowUps.map((f) => ({
                            id: f.id,
                            type: f.type,
                            scheduledAt: f.scheduledAt,
                        })),
                    },
                },
            });
        }

        return { lead: created, recipients: recipientAccountIds, createdFollowUps };
    },
        {
            timeout: 15000,
            maxWait: 10000,
        });
}

/* ─────────────────────────────────────────────
   FOLLOW-UP AGGREGATES SYNC
   Call inside a transaction after any follow-up mutation.
───────────────────────────────────────────── */

export async function syncLeadFollowUpAggregates(
    tx: any,
    leadId: string,
): Promise<void> {
    const [nextPending, lastDone] = await Promise.all([
        tx.leadFollowUp.findFirst({
            where: { leadId, status: "PENDING" },
            orderBy: { scheduledAt: "asc" },
            select: { scheduledAt: true },
        }),
        tx.leadFollowUp.findFirst({
            where: { leadId, status: "DONE" },
            orderBy: { doneAt: "desc" },
            select: { doneAt: true },
        }),
    ]);

    await tx.lead.update({
        where: { id: leadId },
        data: {
            nextFollowUpAt: nextPending?.scheduledAt ?? null,
            lastFollowUpDoneAt: lastDone?.doneAt ?? null,
        },
    });
}

/* ─────────────────────────────────────────────
   CUSTOMER PRODUCT SYNC (for addLeadProductsAdmin)
   Syncs the full currentProducts list into customer.products.active.
   Uses id-first matching to avoid name-collision bugs.
───────────────────────────────────────────── */

export async function syncLeadProductsToCustomer(
    tx: any,
    customerId: string,
    currentProducts: LeadProductItem[],
): Promise<void> {
    const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true, products: true },
    });

    if (!customer) return;

    const cp: any = customer.products ?? { active: [], history: [] };
    if (!Array.isArray(cp.active)) cp.active = [];
    if (!Array.isArray(cp.history)) cp.history = [];

    for (const lp of currentProducts) {
        // Match strictly by id first, then by name fallback
        const idx = cp.active.findIndex(
            (p: any) => p.id === lp.id || p.name === lp.title,
        );

        if (idx !== -1) {
            // Update existing entry
            cp.active[idx].name = lp.title;
            if (lp.cost !== undefined && lp.cost !== null) {
                cp.active[idx].price = lp.cost;
            }
        } else {
            // Add as new active product
            cp.active.push({
                id: lp.id ?? randomUUID(),
                name: lp.title,
                price: lp.cost ?? null,
                addedAt: new Date(),
                status: "ACTIVE",
            });
        }
    }

    await tx.customer.update({
        where: { id: customer.id },
        data: { products: cp, updatedAt: new Date() },
    });
}

/* ─────────────────────────────────────────────
   LEAD ↔ QUOTATION CUSTOMER VALIDATION
   Returns null if valid, error string if mismatch.
───────────────────────────────────────────── */

export async function validateLeadCustomerMatch(
    leadId: string,
    quotationCustomerId: string,
): Promise<string | null> {
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, customerId: true, customerName: true },
    });

    if (!lead) return "Lead not found";

    if (lead.customerId && lead.customerId !== quotationCustomerId) {
        return `Lead belongs to a different customer (leadCustomerId: ${lead.customerId}, quotationCustomerId: ${quotationCustomerId}). Use the correct customer or unlink the lead.`;
    }

    return null;
}

export async function findDuplicateLead(params: {
    normalizedMobile: string;
    productTitle: string | null | undefined;
}): Promise<{
    id: string;
    status: string;
    customerName: string;
    productTitle: string | null;
    createdAt: Date;
    assignments: { accountId: string | null; account: { firstName: string; lastName: string } | null }[];
} | null> {
    const { normalizedMobile, productTitle } = params;

    // Only flag a duplicate when we actually have a product title to compare.
    // A lead with no product is too generic to block on.
    if (!productTitle?.trim()) return null;

    const normalizedTitle = productTitle.trim().toLowerCase();

    const existing = await prisma.lead.findFirst({
        where: {
            mobileNumber: normalizedMobile,
            // Active statuses – ignore already closed / converted leads
            status: {
                notIn: ["CLOSED", "CONVERTED"],
            },
            // Case-insensitive product title match via Prisma mode
            productTitle: {
                equals: normalizedTitle,
                mode: "insensitive",
            },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            customerName: true,
            productTitle: true,
            createdAt: true,
            assignments: {
                where: { isActive: true },
                take: 1,
                select: {
                    accountId: true,
                    account: {
                        select: { firstName: true, lastName: true },
                    },
                },
            },
        },
    });

    return existing;
}

export function buildCustomerProductEntries(
    products: LeadProductItem[],
): Array<{
    id: string;
    name: string;
    price?: number | null;
    slug: string | null;
    addedAt: Date;
    status: string;
}> {
    return products.map((p) => ({
        id: p.id,
        name: p.title,
        price: p.cost || p.price,
        slug: p.slug,
        addedAt: new Date(),
        status: "ACTIVE",
    }));
}

export function deriveLeadScalars(
    products: LeadProductItem[] | null,
    bodyCost: any,
): { productTitle: string | null; totalCost: number | null } {
    if (!products || products.length === 0) {
        return {
            productTitle: null,
            totalCost: bodyCost != null ? Number(bodyCost) : null,
        };
    }

    const primary = products.find((p) => p.isPrimary) ?? products[0];

    // Title: primary product title only (matches existing UX label)
    const productTitle = primary.title;

    // Total cost: sum all product costs; if none have costs, fall back to bodyCost
    const productCostSum = products.reduce<number | null>((acc, p) => {
        if (p.cost == null) return acc;
        return (acc ?? 0) + p.cost;
    }, null);

    const totalCost =
        productCostSum != null
            ? productCostSum
            : bodyCost != null
                ? Number(bodyCost)
                : null;

    return { productTitle, totalCost };
}

export function normalizeIncomingProducts(
    body: Record<string, any>,
): LeadProductItem[] | null {
    // ── Shape 1: new array format ──
    if (Array.isArray(body.product) && body.product.length > 0) {
        return (body.product as LeadProductItem[])
            .filter((p) => p.title?.trim())
            .map((p, idx) => ({
                id: p.id?.trim() || randomUUID(),
                title: p.title!.trim(),
                slug: p.slug ?? null,
                link: p.link ?? null,
                introVideoId: p.introVideoId ?? null,
                cost: p.cost != null ? Number(p.cost) : null,
                isPrimary: p.isPrimary ?? idx === 0,
            }));
    }

    // ── Shape 2: legacy single product object ──
    if (body.product && typeof body.product === "object" && body.product.title) {
        const p = body.product as LeadProductItem;
        return [
            {
                id: p.id?.trim() || randomUUID(),
                title: p.title!.trim(),
                slug: p.slug ?? null,
                link: p.link ?? null,
                introVideoId: p.introVideoId ?? null,
                // cost at product level if provided, otherwise fall through to body.cost
                cost:
                    p.cost != null
                        ? Number(p.cost)
                        : body.cost != null
                            ? Number(body.cost)
                            : null,
                isPrimary: true,
            },
        ];
    }

    // ── Shape 3: bare productTitle string ──
    const title = (body.productTitle ?? "").toString().trim();
    if (title) {
        return [
            {
                id: randomUUID(),
                title,
                slug: null,
                link: null,
                introVideoId: null,
                cost: body.cost != null ? Number(body.cost) : null,
                isPrimary: true,
            },
        ];
    }

    return null;
}



export interface SyncLeadExpertiseArgs {
    prisma: any;
    accountId: string;
    productCatalogIds?: (string | null)[];
    productCatalogId?: string | null;
    leadsCountDelta?: number;
    demoCountDelta?: number;
    leadsConvertedDelta?: number;
    lastDemoAt?: Date | null;
    lastLeadAt?: Date | null;
}

export async function syncLeadExpertise({
    prisma,
    accountId,
    productCatalogId,
    productCatalogIds,
    leadsCountDelta = 0,
    demoCountDelta = 0,
    leadsConvertedDelta = 0,
    lastDemoAt,
    lastLeadAt
}: SyncLeadExpertiseArgs) {
    if (!accountId) return;
    const rawIds = productCatalogIds || (productCatalogId ? [productCatalogId] : []);
    const ids = rawIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    if (leadsCountDelta === 0 && demoCountDelta === 0 && leadsConvertedDelta === 0 && !lastDemoAt && !lastLeadAt) return;

    await Promise.all(ids.map(async (pId) => {
        const expertise = await prisma.userProductExpertise.upsert({
            where: {
                userId_productCatalogId: {
                    userId: accountId,
                    productCatalogId: pId,
                },
            },
            create: {
                userId: accountId,
                productCatalogId: pId,
                leadsCount: Math.max(0, leadsCountDelta),
                demoCount: Math.max(0, demoCountDelta),
                leadsConverted: Math.max(0, leadsConvertedDelta),
                completedProjects: Math.max(0, leadsConvertedDelta),
                lastDemoAt: lastDemoAt || null,
                lastLeadAt: lastLeadAt || new Date(),
                successRate: 0,
            },
            update: {
                ...(leadsCountDelta !== 0 ? { leadsCount: { increment: leadsCountDelta } } : {}),
                ...(demoCountDelta !== 0 ? { demoCount: { increment: demoCountDelta } } : {}),
                ...(leadsConvertedDelta !== 0 ? { leadsConverted: { increment: leadsConvertedDelta }, completedProjects: { increment: leadsConvertedDelta } } : {}),
                ...(lastDemoAt ? { lastDemoAt } : {}),
                ...(lastLeadAt ? { lastLeadAt } : {}),
            },
            select: {
                id: true,
                leadsCount: true,
                leadsConverted: true,
            },
        });

        const successRate =
            expertise.leadsCount > 0
                ? Number(Math.min(100, (expertise.leadsConverted / expertise.leadsCount) * 100).toFixed(2))
                : expertise.leadsConverted > 0 ? 100 : 0;

        await prisma.userProductExpertise.update({
            where: { id: expertise.id },
            data: { successRate },
        });
    }));
}

export interface UpdateUserProductExpertiseArgs {
    prisma: any;
    accountId: string;
    productCatalogIds?: string[];
    productCatalogId?: string | null;
    previousStatus?: string | null;
    newStatus?: string | null;
    leadId?: string | null;
}

export async function updateUserProductExpertise({
    prisma,
    accountId,
    productCatalogId,
    productCatalogIds,
    previousStatus,
    newStatus,
    leadId,
}: UpdateUserProductExpertiseArgs) {
    if (!accountId) return;
    if (previousStatus === newStatus) return;

    const now = new Date();
    const enteredDemo = previousStatus !== "DEMO_DONE" && newStatus === "DEMO_DONE";
    const leftDemo = previousStatus === "DEMO_DONE" && newStatus !== "DEMO_DONE";
    const enteredConverted = previousStatus !== "CONVERTED" && newStatus === "CONVERTED";
    const leftConverted = previousStatus === "CONVERTED" && newStatus !== "CONVERTED";

    await syncLeadExpertise({
        prisma,
        accountId,
        productCatalogId,
        productCatalogIds,
        demoCountDelta: enteredDemo ? 1 : leftDemo ? -1 : 0,
        leadsConvertedDelta: enteredConverted ? 1 : leftConverted ? -1 : 0,
        lastDemoAt: enteredDemo ? now : undefined,
        lastLeadAt: now,
    });

    // ── CustomerProduct: mark purchase on CONVERTED, revert on un-convert ────
    if (!leadId) return;

    if (enteredConverted) {
        await prisma.customerProduct.updateMany({
            where: { leadId },
            data: {
                isPurchase: true,
                purchasedAt: now,
                isActive: true,
                isExpired: false,
            },
        });
    }

    if (leftConverted) {
        await prisma.customerProduct.updateMany({
            where: { leadId },
            data: {
                isPurchase: false,
            },
        });
    }
}


export async function stopWorkIfActive(tx: any, accountId: string, leadId: string) {
    const account = await tx.account.findUnique({
        where: { id: accountId },
        select: { activeLeadId: true },
    });

    // Only stop if user is working on THIS lead
    if (account?.activeLeadId !== leadId) return;

    const lastStart = await tx.leadActivityLog.findFirst({
        where: {
            leadId,
            performedBy: accountId,
            action: "WORK_STARTED",
        },
        orderBy: { createdAt: "desc" },
    });

    if (!lastStart) return;

    const now = new Date();
    const startedAtIso =
        (lastStart.meta as any)?.startedAt ?? lastStart.createdAt.toISOString();

    const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - new Date(startedAtIso).getTime()) / 1000),
    );

    // WORK_ENDED log
    await tx.leadActivityLog.create({
        data: {
            leadId,
            action: "WORK_ENDED",
            performedBy: accountId,
            meta: {
                startedAt: startedAtIso,
                endedAt: now.toISOString(),
                durationSeconds,
                reason: "LEAD_STATUS_TERMINAL",
            },
        },
    });

    // increment lead work time
    await tx.lead.update({
        where: { id: leadId },
        data: {
            totalWorkSeconds: { increment: durationSeconds },
            isWorking: false,
        },
    });

    // clear busy state.   const Acc =
    await tx.account.update({
        where: { id: accountId },
        data: {
            isBusy: false,
            activeLeadId: null,
        },
    });

    // console.log("\n\n\n\n\n\nAcc\n", Acc, "\n\n\n\n\n\n\n");

    const io = getIo();
    io.emit("busy:changed", {
        accountId,
        leadId: leadId,
        isBusy: false,
        source: "WORK_ENDED",
    });
}