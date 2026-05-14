// scripts/backfill-product-catalog.ts
import * as dotenv from "dotenv";
dotenv.config();

import { envConfiguration } from "../config/env.config";
envConfiguration();

import { prisma } from "../config/database.config";
import { Prisma } from "@prisma/client";


const BATCH = 100;

// ─── Cache ────────────────────────────────────────────────────────────────────

const catalogCache = new Map<string, string | null>();

async function resolveCatalogId(adminProductId: string): Promise<string | null> {
    if (catalogCache.has(adminProductId)) return catalogCache.get(adminProductId)!;
    const catalog = await prisma.productCatalog.findUnique({
        where: { adminProductId },
        select: { id: true },
    });
    const result = catalog?.id ?? null;
    catalogCache.set(adminProductId, result);
    return result;
}

// ─── 1. Leads ────────────────────────────────────────────────────────────────

async function backfillLeads() {
    console.log("\n── Leads ──────────────────────────────────────────");

    let skip = 0;
    let total = 0, linked = 0, skipped = 0, failed = 0;

    while (true) {
        const leads = await prisma.lead.findMany({
            where: {
                product: { not: Prisma.JsonNull },
                productCatalogId: null,
            },
            select: { id: true, product: true, productTitle: true },
            take: BATCH,
            skip,
        });

        if (leads.length === 0) break;
        total += leads.length;

        for (const lead of leads) {
            try {
                const product = lead.product as Record<string, unknown> | null;
                const adminProductId = (product?.productId ?? product?.id) as string | undefined;

                if (!adminProductId) {
                    skipped++;
                    continue;
                }

                const catalogId = await resolveCatalogId(adminProductId);
                if (!catalogId) {
                    console.warn(`  Lead ${lead.id}: no catalog match for adminProductId="${adminProductId}"`);
                    skipped++;
                    continue;
                }

                // const updateData: Prisma.LeadUpdateInput = { productCatalogId: catalogId };
                const updateData: Prisma.LeadUpdateInput = {
                    productCatalog: {
                        connect: { id: catalogId },
                    },
                };

                if (!lead.productTitle) {
                    const catalog = await prisma.productCatalog.findUnique({
                        where: { id: catalogId },
                        select: { title: true },
                    });
                    if (catalog) updateData.productTitle = catalog.title;
                }

                await prisma.lead.update({ where: { id: lead.id }, data: updateData });
                linked++;
            } catch (err) {
                console.error(`  Lead ${lead.id} failed:`, err);
                failed++;
            }
        }

        skip += BATCH;
        process.stdout.write(`\r  Processed ${total} leads...`);
    }

    console.log(
        `\n  ✓ Leads — total: ${total}, linked: ${linked}, skipped: ${skipped}, failed: ${failed}`
    );
    return { total, linked, skipped, failed };
}

// ─── 2. CustomerProducts ─────────────────────────────────────────────────────

interface LegacyCustomerProduct {
    productId?: string;
    id?: string;
    title?: string;
    name?: string;
    tallySerial?: string;
    purchasedAt?: string;
    expiresAt?: string;
    licenseKey?: string;
    notes?: string;
    isActive?: boolean;
    [key: string]: unknown;
}

const KNOWN_CUSTOMER_PRODUCT_KEYS = [
    "productId", "id", "title", "name", "tallySerial",
    "purchasedAt", "expiresAt", "licenseKey", "notes", "isActive",
];

async function backfillCustomerProducts() {
    console.log("\n── CustomerProducts ────────────────────────────────");

    let skip = 0;
    let totalCustomers = 0, totalRows = 0, linked = 0, skipped = 0, failed = 0;

    while (true) {
        const customers = await prisma.customer.findMany({
            where: {
                products: { not: Prisma.JsonNull },
                customerProducts: { none: {} },
            },
            select: { id: true, products: true },
            take: BATCH,
            skip,
        });

        if (customers.length === 0) break;
        totalCustomers += customers.length;

        for (const customer of customers) {
            const raw = customer.products;
            if (!raw || !Array.isArray(raw)) { skipped++; continue; }

            const productArray = raw as LegacyCustomerProduct[];

            for (const item of productArray) {
                totalRows++;
                try {
                    const adminProductId = (item.productId ?? item.id) as string | undefined;
                    let catalogId: string | null = null;

                    if (adminProductId) {
                        catalogId = await resolveCatalogId(adminProductId);
                        if (!catalogId) {
                            console.warn(
                                `  Customer ${customer.id}: no catalog match for adminProductId="${adminProductId}"`
                            );
                        }
                    }

                    const productTitle =
                        item.title ??
                        item.name ??
                        (catalogId
                            ? (
                                await prisma.productCatalog.findUnique({
                                    where: { id: catalogId },
                                    select: { title: true },
                                })
                            )?.title
                            : null) ??
                        "Unknown Product";

                    // Idempotency guard
                    if (catalogId) {
                        const exists = await prisma.customerProduct.findFirst({
                            where: { customerId: customer.id, productCatalogId: catalogId },
                        });
                        if (exists) { skipped++; continue; }
                    }

                    //   const meta = Object.fromEntries(
                    //     Object.entries(item).filter(([k]) => !KNOWN_CUSTOMER_PRODUCT_KEYS.includes(k))
                    //   );

                    const meta = Object.fromEntries(
                        Object.entries(item).filter(
                            ([k]) =>
                                ![
                                    "productId",
                                    "id",
                                    "title",
                                    "name",
                                    "tallySerial",
                                    "purchasedAt",
                                    "expiresAt",
                                    "licenseKey",
                                    "notes",
                                    "isActive",
                                ].includes(k),
                        ),
                    ) as Prisma.InputJsonValue;



                    await prisma.customerProduct.create({
                        data: {
                            customerId: customer.id,
                            productCatalogId: catalogId,
                            productTitle,
                            tallySerial: item.tallySerial ?? null,
                            purchasedAt: item.purchasedAt ? new Date(item.purchasedAt) : null,
                            expiresAt: item.expiresAt ? new Date(item.expiresAt) : null,
                            licenseKey: item.licenseKey ?? null,
                            notes: item.notes ?? null,
                            isActive: item.isActive !== undefined ? Boolean(item.isActive) : true,
                            meta
                        },
                    });

                    linked++;
                } catch (err) {
                    console.error(`  Customer ${customer.id} item failed:`, err);
                    failed++;
                }
            }
        }

        skip += BATCH;
        process.stdout.write(`\r  Processed ${totalCustomers} customers, ${totalRows} product rows...`);
    }

    console.log(
        `\n  ✓ CustomerProducts — customers: ${totalCustomers}, rows: ${totalRows}, linked: ${linked}, skipped: ${skipped}, failed: ${failed}`
    );
    return { totalCustomers, totalRows, linked, skipped, failed };
}

// ─── 3. Quotation Diagnostic (JSON column already dropped) ───────────────────

async function diagnoseQuotations() {
    console.log("\n── Quotations ──────────────────────────────────────");
    console.log("  ⚠️  The old lineItems JSON column was dropped by the migration.");
    console.log("  Scanning for quotations that now have zero line items...\n");

    const empty = await prisma.quotation.findMany({
        where: { lineItems: { none: {} } },
        select: {
            id: true,
            quotationNumber: true,
            status: true,
            grandTotal: true,
            createdAt: true,
            customer: { select: { name: true, mobile: true } },
        },
        orderBy: { createdAt: "desc" },
    });

    if (empty.length === 0) {
        console.log("  ✓ All quotations already have line items. Nothing to recover.");
    } else {
        console.log(`  ✗ ${empty.length} quotation(s) have no line items (data was in dropped column):\n`);
        for (const q of empty) {
            console.log(
                `    ${q.quotationNumber}  |  ${q.customer.name} (${q.customer.mobile})` +
                `  |  ₹${q.grandTotal}  |  ${q.status}  |  ${q.createdAt.toLocaleDateString("en-IN")}`
            );
        }
        console.log(
            "\n  Action required: re-enter line items for the above quotations manually via the UI,"
        );
        console.log(
            "  OR restore them from a database backup taken before the migration ran.\n"
        );
    }

    return { emptyCount: empty.length, emptyIds: empty.map((q) => q.quotationNumber) };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
    console.log("Starting product catalog backfill...");
    const start = Date.now();

    const leadResult = await backfillLeads();
    const customerResult = await backfillCustomerProducts();
    const quotationResult = await diagnoseQuotations();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log("══════════════════════════════════════════════════");
    console.log(`  Backfill complete in ${elapsed}s`);
    console.log(`  Leads linked:              ${leadResult.linked} / ${leadResult.total}`);
    console.log(`  CustomerProducts created:  ${customerResult.linked} / ${customerResult.totalRows}`);
    console.log(`  Quotations needing repair: ${quotationResult.emptyCount}`);
    console.log("══════════════════════════════════════════════════\n");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());