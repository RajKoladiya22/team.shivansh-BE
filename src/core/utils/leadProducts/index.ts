// ─────────────────────────────────────────────────────────────────────────────
// FILE 1: src/utils/leadProducts.ts
// Shared across user + admin lead controllers
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

export interface NormalizedProduct {
  id: string;
  slug: string | null;
  link: string | null;
  title: string | null;
}

export interface ProductInput {
  id?: string;
  slug?: string | null;
  link?: string | null;
  title?: string | null;
}

export interface IncomingProductItem {
  id?: string | null;
  title?: string | null;
  slug?: string | null;
  link?: string | null;
  introVideoId?: string | null;
  cost?: number | null;
  isPrimary?: boolean;
}

export interface NormalizedProductItem {
  id: string;
  title: string;
  slug: string | null;
  link: string | null;
  introVideoId: string | null;
  cost: number | null;
  isPrimary: boolean;
}

export function normalizeIncomingProducts(
  body: Record<string, any>,
): NormalizedProductItem[] | null {
  // ── Shape 1: new array format ──
  if (Array.isArray(body.product) && body.product.length > 0) {
    return (body.product as IncomingProductItem[])
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
    const p = body.product as IncomingProductItem;
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

export function deriveLeadScalars(
  products: NormalizedProductItem[] | null,
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


export function buildCustomerProductEntries(
  products: NormalizedProductItem[],
): Array<{
  id: string;
  name: string;
  price: number | null;
  slug: string | null;
  addedAt: Date;
  status: string;
}> {
  return products.map((p) => ({
    id: p.id,
    name: p.title,
    price: p.cost,
    slug: p.slug,
    addedAt: new Date(),
    status: "ACTIVE",
  }));
}















/**
 * Normalize whatever is stored in the `product` Json column → NormalizedProduct[].
 *
 *   null / undefined   → []
 *   legacy plain obj   → [obj]      ← backward-compat with old single-product data
 *   array              → array
 */
export function parseProducts(raw: unknown): NormalizedProduct[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as NormalizedProduct[];
  if (typeof raw === "object") return [raw as NormalizedProduct];
  return [];
}

/**
 * Build a single product entry, generating an id when not supplied.
 */
export function buildProduct(input: ProductInput): NormalizedProduct {
  return {
    id: input.id ?? randomUUID(),
    slug: input.slug ?? null,
    link: input.link ?? null,
    title: input.title ?? null,
  };
}

/**
 * The first product's title is stored in `productTitle` for search compatibility.
 */
export function deriveProductTitle(
  products: NormalizedProduct[],
): string | null {
  return products[0]?.title ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE 2: Add these three routes to your existing user leads router
// e.g. src/routes/user/lead.routes.ts
// ─────────────────────────────────────────────────────────────────────────────

/*

import {
  addLeadProduct,
  removeLeadProduct,
  replaceLeadProducts,
  // ... your existing imports
} from "../../controller/user/lead.controller";

// ── Multi-product endpoints (add alongside existing lead routes) ──
router.post("/:id/products",            authMiddleware, addLeadProduct);
router.put("/:id/products",             authMiddleware, replaceLeadProducts);
router.delete("/:id/products/:productId", authMiddleware, removeLeadProduct);

*/

// ─────────────────────────────────────────────────────────────────────────────
// FILE 3: Admin lead controller patch
//
// In your admin lead controller, add/update these two handlers using the
// same shared utility. No DB changes needed.
// ─────────────────────────────────────────────────────────────────────────────

/*

// src/controller/admin/lead.controller.ts  (additions only)

import { parseProducts, buildProduct, deriveProductTitle, ProductInput } from "../../utils/leadProducts";

// POST /admin/leads/:id/products
export async function addAdminLeadProduct(req: Request, res: Response) {
  const performerAccountId = req.user?.accountId;
  if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

  const { id: leadId } = req.params;
  const input = req.body as ProductInput;

  if (!input.title && !input.slug)
    return sendErrorResponse(res, 400, "title or slug required");

  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, product: true } });
  if (!lead) return sendErrorResponse(res, 404, "Lead not found");

  const existing = parseProducts(lead.product);
  const newProduct = buildProduct(input);

  const isDuplicate = existing.some(
    (p) => (newProduct.id && p.id === newProduct.id) || (newProduct.slug && p.slug === newProduct.slug),
  );
  if (isDuplicate) return sendErrorResponse(res, 409, "Product already on this lead");

  const updated = [...existing, newProduct];

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { product: updated, productTitle: deriveProductTitle(updated) } });
    await tx.leadActivityLog.create({
      data: { leadId, action: "UPDATED", performedBy: performerAccountId, meta: { change: "PRODUCT_ADDED", product: newProduct } },
    });
  });

  return sendSuccessResponse(res, 200, "Product added", { products: updated });
}

// DELETE /admin/leads/:id/products/:productId
export async function removeAdminLeadProduct(req: Request, res: Response) {
  const performerAccountId = req.user?.accountId;
  if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

  const { id: leadId, productId } = req.params;

  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, product: true } });
  if (!lead) return sendErrorResponse(res, 404, "Lead not found");

  const existing = parseProducts(lead.product);
  if (existing.length === 1) return sendErrorResponse(res, 400, "Cannot remove the last product");

  const target = existing.find((p) => p.id === productId);
  if (!target) return sendErrorResponse(res, 404, "Product not found on lead");

  const updated = existing.filter((p) => p.id !== productId);

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { product: updated, productTitle: deriveProductTitle(updated) } });
    await tx.leadActivityLog.create({
      data: { leadId, action: "UPDATED", performedBy: performerAccountId, meta: { change: "PRODUCT_REMOVED", removedProduct: target } },
    });
  });

  return sendSuccessResponse(res, 200, "Product removed", { products: updated });
}

// PUT /admin/leads/:id/products  (replace all)
export async function replaceAdminLeadProducts(req: Request, res: Response) {
  const performerAccountId = req.user?.accountId;
  if (!performerAccountId) return sendErrorResponse(res, 401, "Invalid session user");

  const { id: leadId } = req.params;
  const { products } = req.body as { products: ProductInput[] };

  if (!Array.isArray(products) || products.length === 0)
    return sendErrorResponse(res, 400, "products[] required");

  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, product: true } });
  if (!lead) return sendErrorResponse(res, 404, "Lead not found");

  const newProducts = products.map(buildProduct);
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { product: newProducts, productTitle: deriveProductTitle(newProducts) } });
    await tx.leadActivityLog.create({
      data: { leadId, action: "UPDATED", performedBy: performerAccountId, meta: { change: "PRODUCTS_REPLACED", from: parseProducts(lead.product), to: newProducts } },
    });
  });

  return sendSuccessResponse(res, 200, "Products updated", { products: newProducts });
}

*/
