// src/services/lead.service.ts
import { prisma } from "../../config/database.config";
import { randomUUID } from "crypto";

/* ─────────────────────────────────────────────
   TYPES
───────────────────────────────────────────── */

export interface LeadProductItem {
  id: string;
  title: string;
  slug?: string | null;
  link?: string | null;
  introVideoId?: string | null;
  cost?: number | null;
  isPrimary?: boolean;
}

/* ─────────────────────────────────────────────
   NORMALIZERS / DERIVERS
───────────────────────────────────────────── */

export const normalizeMobile = (m: unknown) =>
  String(m ?? "").replace(/\D/g, "");

export function normalizeLeadProducts(raw: unknown): LeadProductItem[] {
  if (Array.isArray(raw)) return raw as LeadProductItem[];
  if (raw && typeof raw === "object") return [raw as LeadProductItem]; // backwards compat
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

/* ─────────────────────────────────────────────
   SNAPSHOT RESOLVERS
───────────────────────────────────────────── */

export async function resolveAssigneeSnapshot(input: {
  accountId?: string | null;
  teamId?: string | null;
}) {
  if (input.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, firstName: true, lastName: true, designation: true },
    });
    return acc
      ? {
          type: "ACCOUNT" as const,
          id: acc.id,
          name: `${acc.firstName} ${acc.lastName}`,
          designation: acc.designation ?? null,
        }
      : null;
  }

  if (input.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      select: { id: true, name: true },
    });
    return team ? { type: "TEAM" as const, id: team.id, name: team.name } : null;
  }

  return null;
}

export async function resolvePerformerSnapshot(accountId: string | null) {
  if (!accountId) return null;
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      firstName: true,
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
  };
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
   PRODUCT COST SYNC
   Syncs a product cost change across:
     1. customer.products.active[].price   (matched by productId > title > oldTitle)
     2. All DRAFT quotations linked to this lead (lineItems + financials recomputed)

   Call INSIDE a transaction after updating lead.cost / lead.product.
───────────────────────────────────────────── */

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
): Promise<void> {
  const {
    leadId,
    customerId,
    productId,
    productSlug,
    productTitle,
    oldTitle,
    newCost,
  } = params;

  /* ── 1. Customer sync ─────────────────────────────────────────── */
  if (customerId) {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true, products: true },
    });

    if (customer) {
      const cp: any = customer.products ?? { active: [], history: [] };
      if (!Array.isArray(cp.active)) cp.active = [];

      // Match strictly by id first, then title, then oldTitle
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
      // If no match found, do NOT silently add — caller should have added it already
      // on lead creation. Avoids phantom duplicates.

      await tx.customer.update({
        where: { id: customerId },
        data: { products: cp, updatedAt: new Date() },
      });
    }
  }

  /* ── 2. Quotation sync (DRAFT only) ───────────────────────────── */
  const draftQuotations = await tx.quotation.findMany({
    where: { leadId, status: "DRAFT" },
    select: {
      id: true,
      lineItems: true,
      extraDiscountType: true,
      extraDiscountValue: true,
    },
  });

  for (const q of draftQuotations) {
    const items: any[] = Array.isArray(q.lineItems) ? q.lineItems : [];
    let changed = false;

    const updatedItems = items.map((item: any) => {
      // Match by productId (most reliable) → productSlug → name → oldTitle
      const matches =
        (productId && item.productId === productId) ||
        (productSlug && item.productSlug === productSlug) ||
        (productTitle && item.name === productTitle) ||
        (oldTitle && item.name === oldTitle);

      if (!matches) return item;
      changed = true;

      // Recompute line totals with new basePrice
      const qty = Math.max(Number(item.qty) || 1, 1);
      const dv = Number(item.discountValue) || 0;
      const tp = Number(item.taxPercent) || 0;

      let dp = newCost;
      if (item.discountType === "PERCENTAGE")
        dp = newCost - (newCost * dv) / 100;
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

    // Recompute quotation-level financials from updated items
    let subtotal = 0;
    let lineDiscountTotal = 0;
    let totalTax = 0;

    for (const item of updatedItems) {
      const qty = Math.max(Number(item.qty) || 1, 1);
      const base = Number(item.basePrice) || 0;
      const dv = Number(item.discountValue) || 0;
      let dp = base;
      if (item.discountType === "PERCENTAGE") dp = base - (base * dv) / 100;
      else if (item.discountType === "FLAT") dp = Math.max(base - dv, 0);
      subtotal += dp * qty;
      lineDiscountTotal += (base - dp) * qty;
      totalTax += Number(item.taxAmount) || 0;
    }

    // Apply extra discount (pre-tax, on subtotal only — correct GST treatment)
    const edv = Number(q.extraDiscountValue) || 0;
    let extraDiscount = 0;
    if (edv > 0 && q.extraDiscountType) {
      extraDiscount =
        q.extraDiscountType === "PERCENTAGE"
          ? (subtotal * edv) / 100
          : Math.min(edv, subtotal);
    }

    const totalDiscount = lineDiscountTotal + extraDiscount;
    const grandTotal = Math.max(subtotal - extraDiscount + totalTax, 0);

    await tx.quotation.update({
      where: { id: q.id },
      data: {
        lineItems: updatedItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        totalDiscount: parseFloat(totalDiscount.toFixed(2)),
        totalTax: parseFloat(totalTax.toFixed(2)),
        grandTotal: parseFloat(grandTotal.toFixed(2)),
      },
    });
  }
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