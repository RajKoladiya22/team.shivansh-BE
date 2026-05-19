// scripts/backfill-customer-products-v2.ts
//
// Handles ALL migration cases:
//   1. customer.products.active  → CustomerProduct (isActive: true)
//   2. customer.products.history → CustomerProduct (isActive: false)
//   3. Lead.product[].id         → Lead.productCatalogId (primary product)
//   4. Catalog resolution:
//        a. cuid    → ProductCatalog.id          (new format: cmmdc2c1s0035ju4zybmmaruo)
//        b. UUID    → ProductCatalog.adminProductId (old format: 938d8f82-efad-43ad-924c-55ca52c3ac1e)
//        c. title   → ProductCatalog.title       (fallback)

import * as dotenv from "dotenv";
dotenv.config();

import { envConfiguration } from "../config/env.config";
envConfiguration();

import { prisma } from "../config/database.config";
import { Prisma } from "@prisma/client";

const BATCH = 50;

// ─── Catalog Resolution Cache ──────────────────────────────────────────────────

const cacheById = new Map<string, string | null>();    // productCatalog.id or adminProductId → catalogId
const cacheByTitle = new Map<string, string | null>(); // normalized title → catalogId

/**
 * Detect whether a string looks like a cuid (starts with 'c', ~25 chars, lowercase alphanumeric)
 * vs a UUID (8-4-4-4-12 with hyphens)
 */
function isCuid(id: string): boolean {
  return /^c[a-z0-9]{20,30}$/.test(id);
}

/**
 * Resolve ProductCatalog.id from a product entry.
 * Strategy:
 *   1. If id looks like a cuid → try ProductCatalog.id directly
 *   2. If id looks like a UUID → try ProductCatalog.adminProductId
 *   3. Fallback → match by normalized title
 */
async function resolveCatalogId(params: {
  id?: string | null;
  title?: string | null;
}): Promise<string | null> {
  const { id, title } = params;

  // ── 1. Try by id ────────────────────────────────────────────────────────────
  if (id) {
    if (cacheById.has(id)) return cacheById.get(id)!;

    let catalog: { id: string } | null = null;

    if (isCuid(id)) {
      // New format: product.id IS the ProductCatalog.id (cuid)
      catalog = await prisma.productCatalog.findUnique({
        where: { id },
        select: { id: true },
      });
    }

    if (!catalog) {
      // Old format or fallback: product.id is an adminProductId
      catalog = await prisma.productCatalog.findUnique({
        where: { adminProductId: id },
        select: { id: true },
      });
    }

    const result = catalog?.id ?? null;
    cacheById.set(id, result);

    if (result) return result;
  }

  // ── 2. Fallback: match by normalized title ─────────────────────────────────
  if (title) {
    const normalizedTitle = title.trim().toLowerCase();
    if (cacheByTitle.has(normalizedTitle)) return cacheByTitle.get(normalizedTitle)!;

    const catalog = await prisma.productCatalog.findFirst({
      where: { title: { equals: title.trim(), mode: "insensitive" } },
      select: { id: true },
    });

    const result = catalog?.id ?? null;
    cacheByTitle.set(normalizedTitle, result);
    return result;
  }

  return null;
}

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface ActiveProductEntry {
  id?: string;
  name?: string;
  title?: string;
  price?: number | null;
  slug?: string | null;
  status?: string;
  addedAt?: string;
  [key: string]: unknown;
}

interface HistoryProductEntry extends ActiveProductEntry {
  removedAt?: string;
  removedFromLeadId?: string;
}

interface CustomerProductsJSON {
  active?: ActiveProductEntry[];
  history?: HistoryProductEntry[];
}

// ─── 1. Backfill CustomerProducts ────────────────────────────────────────────

async function backfillCustomerProducts() {
  console.log("\n── CustomerProducts ─────────────────────────────────────────────────");
  console.log("   Migrating both active + history entries into CustomerProduct table");

  let skip = 0;
  let totalCustomers = 0;
  let activeLinked = 0, activeSkipped = 0, activeFailed = 0;
  let historyLinked = 0, historySkipped = 0, historyFailed = 0;

  while (true) {
    // Only process customers that still have JSON products but incomplete CustomerProduct rows
    const customers = await prisma.customer.findMany({
      where: {
        products: { not: Prisma.JsonNull },
      },
      select: { id: true, products: true },
      take: BATCH,
      skip,
    });

    if (customers.length === 0) break;
    totalCustomers += customers.length;

    for (const customer of customers) {
      const raw = customer.products as CustomerProductsJSON | null;
      if (!raw || typeof raw !== "object") continue;

      const activeItems: ActiveProductEntry[] = Array.isArray(raw.active) ? raw.active : [];
      const historyItems: HistoryProductEntry[] = Array.isArray(raw.history) ? raw.history : [];

      // ── Active items ──────────────────────────────────────────────────────
      for (const item of activeItems) {
        try {
          const productTitle = (item.name ?? item.title ?? "").trim();
          if (!productTitle) { activeSkipped++; continue; }

          const catalogId = await resolveCatalogId({
            id: item.id,
            title: productTitle,
          });

          // Idempotency: skip if already exists (by catalogId or by title)
          const existing = await prisma.customerProduct.findFirst({
            where: {
              customerId: customer.id,
              ...(catalogId
                ? { productCatalogId: catalogId }
                : { productTitle: productTitle }),
              isActive: true,
            },
            select: { id: true },
          });

          if (existing) { activeSkipped++; continue; }

          await prisma.customerProduct.create({
            data: {
              customerId: customer.id,
              productCatalogId: catalogId,
              productTitle,
              isActive: true,
              notes: null,
              meta: {
                price: item.price ?? null,
                slug: item.slug ?? null,
                addedAt: item.addedAt ?? null,
                legacyId: item.id ?? null,
              } as Prisma.InputJsonValue,
            },
          });

          activeLinked++;
        } catch (err) {
          console.error(`  [active] Customer ${customer.id} / "${item.name}" failed:`, err);
          activeFailed++;
        }
      }

      // ── History items ─────────────────────────────────────────────────────
      for (const item of historyItems) {
        try {
          const productTitle = (item.name ?? item.title ?? "").trim();
          if (!productTitle) { historySkipped++; continue; }

          const catalogId = await resolveCatalogId({
            id: item.id,
            title: productTitle,
          });

          // Idempotency: skip if already exists as inactive
          const existing = await prisma.customerProduct.findFirst({
            where: {
              customerId: customer.id,
              ...(catalogId
                ? { productCatalogId: catalogId }
                : { productTitle: productTitle }),
              isActive: false,
            },
            select: { id: true },
          });

          if (existing) { historySkipped++; continue; }

          await prisma.customerProduct.create({
            data: {
              customerId: customer.id,
              productCatalogId: catalogId,
              productTitle,
              isActive: false,
              notes: null,
              meta: {
                price: item.price ?? null,
                slug: item.slug ?? null,
                addedAt: item.addedAt ?? null,
                removedAt: item.removedAt ?? null,
                removedFromLeadId: item.removedFromLeadId ?? null,
                legacyId: item.id ?? null,
                migratedFromHistory: true,
              } as Prisma.InputJsonValue,
            },
          });

          historyLinked++;
        } catch (err) {
          console.error(`  [history] Customer ${customer.id} / "${item.name}" failed:`, err);
          historyFailed++;
        }
      }
    }

    skip += BATCH;
    process.stdout.write(
      `\r  Processed ${totalCustomers} customers | Active: +${activeLinked} | History: +${historyLinked}...`
    );
  }

  console.log(`\n  ✓ Active   — linked: ${activeLinked}, skipped: ${activeSkipped}, failed: ${activeFailed}`);
  console.log(`  ✓ History  — linked: ${historyLinked}, skipped: ${historySkipped}, failed: ${historyFailed}`);

  return {
    totalCustomers,
    active: { linked: activeLinked, skipped: activeSkipped, failed: activeFailed },
    history: { linked: historyLinked, skipped: historySkipped, failed: historyFailed },
  };
}

// ─── 2. Backfill Lead.productCatalogId ────────────────────────────────────────

async function backfillLeadCatalogId() {
  console.log("\n── Lead.productCatalogId ─────────────────────────────────────────────");
  console.log("   Linking primary product to Lead.productCatalogId");

  let skip = 0;
  let total = 0, linked = 0, skipped = 0, failed = 0;

  while (true) {
    const leads = await prisma.lead.findMany({
      where: {
        productCatalogId: null,
        product: { not: Prisma.JsonNull },
      },
      select: { id: true, product: true, productTitle: true },
      take: BATCH,
      skip,
    });

    if (leads.length === 0) break;
    total += leads.length;

    for (const lead of leads) {
      try {
        const product = lead.product;

        // Normalize product to array (handles single object or array)
        const productArray: any[] = Array.isArray(product)
          ? product
          : product && typeof product === "object"
            ? [product]
            : [];

        if (productArray.length === 0) { skipped++; continue; }

        // Find primary product (isPrimary: true) OR fall back to first entry
        const primary = productArray.find((p: any) => p.isPrimary === true) ?? productArray[0];

        if (!primary) { skipped++; continue; }

        const catalogId = await resolveCatalogId({
          id: primary.id,
          title: primary.title ?? lead.productTitle,
        });

        if (!catalogId) {
          // console.warn(`  Lead ${lead.id}: no catalog match for "${primary.title ?? lead.productTitle}"`);
          skipped++;
          continue;
        }

        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            productCatalog: { connect: { id: catalogId } },
            // Also fill productTitle if missing
            ...((!lead.productTitle && primary.title)
              ? { productTitle: primary.title }
              : {}),
          },
        });

        linked++;
      } catch (err) {
        console.error(`  Lead ${lead.id} failed:`, err);
        failed++;
      }
    }

    skip += BATCH;
    process.stdout.write(`\r  Processed ${total} leads | Linked: ${linked}...`);
  }

  console.log(`\n  ✓ Leads — total: ${total}, linked: ${linked}, skipped: ${skipped}, failed: ${failed}`);
  return { total, linked, skipped, failed };
}

// ─── 3. Verify ─────────────────────────────────────────────────────────────────

async function runVerification() {
  console.log("\n── Verification ──────────────────────────────────────────────────────");

  const [
    customersWithProducts,
    customersWithCustomerProducts,
    leadsWithNullCatalog,
    leadsTotal,
    totalCustomerProducts,
    activeCustomerProducts,
    inactiveCustomerProducts,
  ] = await Promise.all([
    prisma.customer.count({ where: { products: { not: Prisma.JsonNull } } }),
    prisma.customer.count({ where: { customerProducts: { some: {} } } }),
    prisma.lead.count({ where: { productCatalogId: null, product: { not: Prisma.JsonNull } } }),
    prisma.lead.count({ where: { product: { not: Prisma.JsonNull } } }),
    prisma.customerProduct.count(),
    prisma.customerProduct.count({ where: { isActive: true } }),
    prisma.customerProduct.count({ where: { isActive: false } }),
  ]);

  console.log(`\n  Customers:`);
  console.log(`    With products JSON:       ${customersWithProducts}`);
  console.log(`    With CustomerProduct rows: ${customersWithCustomerProducts}`);
  console.log(`\n  CustomerProduct rows:`);
  console.log(`    Total:    ${totalCustomerProducts}`);
  console.log(`    Active:   ${activeCustomerProducts}`);
  console.log(`    Inactive: ${inactiveCustomerProducts} (history)`);
  console.log(`\n  Leads:`);
  console.log(`    Total with products:                    ${leadsTotal}`);
  console.log(`    Still missing productCatalogId:         ${leadsWithNullCatalog}`);
  console.log(`    Linked to catalog:                      ${leadsTotal - leadsWithNullCatalog}`);

  if (leadsWithNullCatalog > 0) {
    console.log(
      `\n  ⚠️  ${leadsWithNullCatalog} leads could not be matched to a ProductCatalog entry.`
    );
    console.log(`     These likely have custom/manual product titles not in the catalog.`);
  } else {
    console.log(`\n  ✅ All leads with products are linked to ProductCatalog.`);
  }

  return {
    customersWithProducts,
    customersWithCustomerProducts,
    totalCustomerProducts,
    activeCustomerProducts,
    inactiveCustomerProducts,
    leadsTotal,
    leadsWithNullCatalog,
  };
}

// ─── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       Customer Product Backfill v2 — Full Migration          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const start = Date.now();

  const customerResult = await backfillCustomerProducts();
  const leadResult = await backfillLeadCatalogId();
  const verification = await runVerification();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  Backfill complete in ${elapsed}s`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Customers processed:         ${customerResult.totalCustomers}`);
  console.log(`║  CustomerProducts created:`);
  console.log(`║    Active (from .active):     ${customerResult.active.linked}`);
  console.log(`║    Inactive (from .history):  ${customerResult.history.linked}`);
  console.log(`║  Leads linked to catalog:     ${leadResult.linked} / ${leadResult.total}`);
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());