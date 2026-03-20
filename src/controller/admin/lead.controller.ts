// src/controller/admin/lead.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { randomUUID } from "crypto";
import { triggerAssignmentNotification } from "../../services/notifications";
import { getIo } from "../../core/utils/socket";
import { Lead_Status } from "@prisma/client";

interface LeadProductItem {
  id: string;
  title: string;
  slug?: string | null;
  link?: string | null;
  introVideoId?: string | null;
  cost?: number | null;
  isPrimary?: boolean;
}

/**
 * Helper: get accountId from req.user.id (user table -> accountId)
 */
const normalizeMobile = (m: unknown) => String(m ?? "").replace(/\D/g, "");

export async function getUserIdFromAccountId(
  accountId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: {
      accountId: accountId,
    },
    select: {
      id: true,
    },
  });

  return user?.id ?? null;
}

async function resolveAssigneeSnapshot(input: {
  accountId?: string | null;
  teamId?: string | null;
}) {
  if (input.accountId) {
    const acc = await prisma.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, firstName: true, lastName: true },
    });
    return acc
      ? {
          type: "ACCOUNT",
          id: acc.id,
          name: `${acc.firstName} ${acc.lastName}`,
        }
      : null;
  }

  if (input.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: input.teamId },
      select: { id: true, name: true },
    });
    return team
      ? {
          type: "TEAM",
          id: team.id,
          name: team.name,
        }
      : null;
  }

  return null;
}

async function resolvePerformerSnapshot(accountId: string) {
  const acc = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
    },
  });

  if (!acc) return null;

  return {
    id: acc.id,
    name: `${acc.firstName} ${acc.lastName}`,
    designation: acc.designation ?? null,
  };
}

function normalizeLeadProducts(raw: unknown): LeadProductItem[] {
  if (Array.isArray(raw)) return raw as LeadProductItem[];
  if (raw && typeof raw === "object") return [raw as LeadProductItem]; // backwards compat
  return [];
}

function deriveLeadMeta(products: LeadProductItem[]) {
  const productTitle =
    products
      .map((p) => p.title)
      .filter(Boolean)
      .join(", ") || null;
  const cost = products.reduce((sum, p) => sum + (p.cost ?? 0), 0) || null;
  return { productTitle, cost };
}

/**
 * Syncs a product cost change across:
 *  1. customer.products.active[].price
 *  2. All DRAFT quotations linked to this lead (lineItems + financials recomputed)
 *
 * Call this INSIDE a transaction after updating lead.cost / lead.product.
 */
async function syncProductCostToEntities(
  tx: any,
  params: {
    leadId: string;
    customerId: string | null;
    productId?: string | null;
    productSlug?: string | null;
    productTitle?: string | null;
    oldTitle?: string | null; // previous title — fallback match in customer/quotation
    newCost: number;
  },
) {
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

    // Recompute quotation-level financials
    let subtotal = 0,
      totalDiscount = 0,
      totalTax = 0;
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

    // Extra discount
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
        lineItems: updatedItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        totalDiscount: parseFloat(totalDiscount.toFixed(2)),
        totalTax: parseFloat(totalTax.toFixed(2)),
        grandTotal: parseFloat(grandTotal.toFixed(2)),
      },
    });
  }
}

/* ==========================
   ADMIN CONTROLLER ACTIONS
   ========================== */

/**
 * POST /admin/leads
 */
export async function createLeadAdmin(req: Request, res: Response) {
  try {
    const creatorAccountId = req.user?.accountId;

    // const creatorAccountId = await getAccountIdFromReqUser(adminUserId);
    if (!creatorAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    // Destructure with different name to avoid shadowing creator accountId
    const {
      source,
      type,
      customerName,
      mobileNumber,
      customerCompanyName,
      product,
      cost,
      remark,
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
      demoDate,
      followUps,
    } = req.body as Record<string, any>;

    // console.log("\n\n\n\ndemoDate:", demoDate);

    if (!source || !type)
      return sendErrorResponse(res, 400, "Lead source and type are required");
    if (!customerName || !mobileNumber)
      return sendErrorResponse(
        res,
        400,
        "Customer name and mobile are required",
      );

    // XOR: either account or team must be provided (not both)
    if (!assigneeAccountId && !assigneeTeamId)
      return sendErrorResponse(res, 400, "Assign to account or team");
    if (assigneeAccountId && assigneeTeamId)
      return sendErrorResponse(
        res,
        400,
        "Provide either accountId or teamId, not both",
      );

    // normalize
    const normalizedMobile = normalizeMobile(mobileNumber);

    const resolvedProduct = product
      ? {
          id: product.id || randomUUID(),
          slug: product.slug ?? null,
          link: product.link ?? null,
          title: product.title ?? null,
        }
      : undefined;
    const productTitle =
      resolvedProduct?.title ?? req.body.productTitle ?? null;

    const initialAssignee = await resolveAssigneeSnapshot({
      accountId: assigneeAccountId,
      teamId: assigneeTeamId,
    });

    // Create lead + initial assignment + CREATED activity in single transaction
    const {
      lead,
      recipients,
      followUps: createdFollowUps,
    } = await prisma.$transaction(async (tx) => {
      // 1️⃣ find existing customer first
      let customer = await tx.customer.findUnique({
        where: { normalizedMobile },
      });

      // 2️⃣ prepare product object
      const newProduct =
        resolvedProduct?.title || cost
          ? {
              id: randomUUID(),
              name: resolvedProduct?.title ?? productTitle ?? "Unknown Product",
              price: cost ?? null,
              addedAt: new Date(),
              status: "ACTIVE",
            }
          : null;

      // 3️⃣ if customer exists → update products JSON
      if (customer) {
        let existingProducts: any = customer.products ?? {
          active: [],
          history: [],
        };

        // ensure structure
        if (!existingProducts.active) existingProducts.active = [];
        if (!existingProducts.history) existingProducts.history = [];

        // if (newProduct) {
        //   // set new active product
        //   existingProducts.active = [newProduct];
        // }
        if (newProduct) {
          if (!existingProducts.active) {
            existingProducts.active = [];
          }

          const alreadyExists = existingProducts.active.some(
            (p: any) => p.id === newProduct.id,
          );

          if (!alreadyExists) {
            existingProducts.active.push(newProduct);
          }
        }

        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            name: customerName || customer.name,
            customerCompanyName:
              customerCompanyName || customer.customerCompanyName,
            products: existingProducts,
            updatedAt: new Date(),
          },
        });
      } else {
        // 4️⃣ create new customer
        customer = await tx.customer.create({
          data: {
            name: customerName,
            mobile: mobileNumber,
            customerCompanyName: customerCompanyName,
            normalizedMobile,
            createdBy: creatorAccountId,
            products: newProduct
              ? {
                  active: [newProduct],
                  history: [],
                }
              : undefined,
          },
        });

        // console.log("\n\n\n\ncustomer", customer, "\n\n\n\n\n\n\n\n\n\n\n\n");
      }
      // const customer = await tx.customer.upsert({
      //   where: { normalizedMobile },
      //   create: {
      //     name: customerName,
      //     mobile: mobileNumber,
      //     normalizedMobile,
      //     createdBy: creatorAccountId,
      //   },
      //   update: {
      //     name: customerName || undefined,
      //     updatedAt: new Date(),
      //   },
      // });

      const created = await tx.lead.create({
        data: {
          source,
          type,
          customerId: customer.id,
          customerName: customer.name,
          customerCompanyName: customer.customerCompanyName,
          mobileNumber: normalizedMobile,
          product: resolvedProduct,
          productTitle,
          cost: cost ?? undefined,
          remark: remark ?? undefined,
          createdBy: creatorAccountId,
          demoScheduledAt: demoDate ? new Date(demoDate) : undefined,
          demoCount: demoDate ? 1 : 0,
          demoMeta: demoDate
            ? {
                history: [
                  {
                    type: "SCHEDULED",
                    at: new Date(demoDate),
                    by: creatorAccountId,
                  },
                ],
              }
            : undefined,
        },
      });

      const assignment = await tx.leadAssignment.create({
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
          },
        },
      });

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

      // After tx.leadAssignment.create(...)

      // ── Follow-ups ────────────────────────────────────────────────
      let createdFollowUps: any[] = [];

      if (Array.isArray(followUps) && followUps.length > 0) {
        // validate: all must have scheduledAt
        const invalid = followUps.some((f) => !f.scheduledAt);
        if (invalid) throw new Error("Each follow-up must have a scheduledAt");

        const data = followUps.map((f) => ({
          leadId: created.id,
          type: f.type ?? "CALL",
          status: "PENDING" as const,
          scheduledAt: new Date(f.scheduledAt),
          remark: f.remark ?? null,
          createdBy: creatorAccountId, // or `accountId` in createMyLead
        }));

        await tx.leadFollowUp.createMany({ data });

        createdFollowUps = await tx.leadFollowUp.findMany({
          where: { leadId: created.id },
          orderBy: { scheduledAt: "asc" },
        });

        // sync aggregates on lead
        const earliest = createdFollowUps[0];
        await tx.lead.update({
          where: { id: created.id },
          data: {
            followUpCount: createdFollowUps.length,
            nextFollowUpAt: earliest.scheduledAt,
          },
        });

        // single activity log for all scheduled follow-ups
        await tx.leadActivityLog.create({
          data: {
            leadId: created.id,
            action: "FOLLOW_UP_SCHEDULED",
            performedBy: creatorAccountId, // or `accountId`
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

      // ── return from transaction ───────────────────────────────────
      return {
        lead: created,
        recipients: recipientAccountIds,
        followUps: createdFollowUps,
      };

      // return { lead: created, recipients: recipientAccountIds };
    });

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

      // optional admin dashboard room
      // io.to("leads:admin").emit("lead:created", socketPayload);
    } catch (e) {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Lead created successfully", {
      ...lead,
      followUps: createdFollowUps,
    });
  } catch (err: any) {
    console.error("Create lead error:", err);
    // Prisma common error handling
    if (err?.code === "P2002") {
      return sendErrorResponse(res, 400, "Duplicate customer/mobile");
    }
    return sendErrorResponse(res, 500, err?.message ?? "Failed to create lead");
  }
}

/**
 * PATCH /admin/leads/:id
 */
export async function updateLeadAdmin(req: Request, res: Response) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");

    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

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
    ];
    const data: Record<string, any> = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }

    // normalizations
    if (data.mobileNumber)
      data.mobileNumber = normalizeMobile(data.mobileNumber);
    if (data.product)
      data.productTitle = data.product.title ?? data.productTitle ?? null;
    if (data.productTitle === undefined && data.product?.title)
      data.productTitle = data.product.title;

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        statusMark: true,
        demoScheduledAt: true,
        demoDoneAt: true,
        demoCount: true,
        demoMeta: true,
        cost: true,
        remark: true,
        customerId: true,
        product: true,
        productTitle: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    // prepare statusMark safely
    const statusMark = {
      ...(existing.statusMark as Record<string, boolean> | null),
    };

    if (data.status === "CLOSED") statusMark.close = true;
    if (data.status === "DEMO_DONE") {
      statusMark.demo = true;
      data.demoDoneAt = new Date();
    }
    if (data.status === "CONVERTED") {
      statusMark.converted = true;
      data.closedAt = new Date();
    }

    // only assign if something changed
    if (Object.keys(statusMark).length > 0) {
      data.statusMark = statusMark;
    }

    // -------------------------
    // Demo Reschedule Handling
    // -------------------------
    if (data.demoScheduledAt) {
      const newDate = new Date(data.demoScheduledAt);

      if (
        !existing.demoScheduledAt ||
        existing.demoScheduledAt.getTime() !== newDate.getTime()
      ) {
        data.demoCount = { increment: 1 };

        // Append to demoMeta history
        const existingMeta = (existing as any).demoMeta as any;
        // console.log("\n\n\n\n\n\n\n\n\n\nExisting:\n", existing);
        // console.log("\n\nExisting existingMeta:\n", existingMeta);
        const history = existingMeta?.history ?? [];
        // console.log("\n\nExisting demoMeta history:\n", history);

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

    const diff: Record<string, any> = {};
    Object.keys(data).forEach((key) => {
      diff[key] = {
        from: (existing as any)[key] ?? null,
        to: data[key],
      };
    });

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
          assignments: {
            include: {
              account: true,
              team: true,
            },
          },
        },
      });

      if (data.cost !== undefined && existing.customerId) {
        await syncProductCostToEntities(tx, {
          leadId: id,
          customerId: existing.customerId,
          productId: (existing.product as any)?.id ?? null,
          productSlug: (existing.product as any)?.slug ?? null,
          productTitle:
            (existing.product as any)?.title ?? existing.productTitle ?? null,
          newCost: Number(data.cost),
        });
      }

      // await tx.leadActivityLog.create({
      //   data: {
      //     leadId: id,
      //     action: "UPDATED",
      //     performedBy: performerAccountId,
      //     meta: {
      //       fromState: existing,
      //       toState: lead,
      //     },
      //   },
      // });

      // --- Replace diff calculation ---
      const diff: Record<string, any> = {};
      Object.keys(data).forEach((key) => {
        const oldVal = (existing as any)[key] ?? null;
        const newVal = data[key];

        // compare properly (handles object/date)
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          diff[key] = {
            from: oldVal,
            to: newVal,
          };
        }
      });

      // --- Replace activity log creation ---
      if (Object.keys(diff).length > 0) {
        await tx.leadActivityLog.create({
          data: {
            leadId: id,
            action: "UPDATED",
            performedBy: performerAccountId,
            meta: {
              fromState: Object.fromEntries(
                Object.entries(diff).map(([k, v]) => [k, v.from]),
              ),
              toState: Object.fromEntries(
                Object.entries(diff).map(([k, v]) => [k, v.to]),
              ),
            },
          },
        });
      }

      return lead;
    });

    // console.log(
    //   "\n\n\n\n\n\n\n\n\n\n\n\n\\n\n\n\n",
    //   {
    //     fromState: existing,
    //     toState: updated,
    //   },

    //   "\n\n\n",
    // );

    // -------------------------
    // Resolve recipients
    // -------------------------
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
          demoScheduledAt: updated.demoScheduledAt,
          demoDoneAt: updated.demoDoneAt,
          demoCount: updated.demoCount,
          updatedAt: updated.updatedAt,
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch (e) {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead updated", updated);
  } catch (err: any) {
    console.error("Update lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to update lead");
  }
}

/**
 * GET /admin/leads
 * Fully optimized (DB-first ordering, minimal payload, no JS sorting)
 */
export async function listLeadsAdmin(req: Request, res: Response) {
  try {
    const {
      status,
      source,
      search,
      assignedToAccountId,
      assignedToTeamId,
      helperAccountId,
      helperRole,
      fromDate,
      toDate,
      demoFromDate,
      demoToDate,
      demoStatus,
      page = "1",
      limit = "20",
      followUpStatus, // PENDING | DONE | MISSED | RESCHEDULED
      followUpType, // CALL | DEMO | MEETING | VISIT | WHATSAPP | OTHER
      followUpRange, // today | tomorrow | week | overdue | upcoming | custom
      followUpFromDate,
      followUpToDate,
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    // console.log("\n\n\n\n\n\n\n req.query", req.query);

    /* -------------------------
       WHERE (index-friendly)
    ------------------------- */
    const where: any = {};

    if (status) where.status = status;
    if (source) where.source = source;
    // console.log("fromDate:", fromDate);
    // console.log("toDate:", toDate);

    // if (fromDate || toDate) {
    //   where.createdAt = {};
    //   if (fromDate) where.createdAt.gte = new Date(fromDate);
    //   if (toDate) where.createdAt.lte = new Date(toDate);
    // }

    if (fromDate || toDate) {
      where.createdAt = {};

      if (fromDate) {
        where.createdAt.gte = new Date(fromDate);
      }

      if (toDate) {
        const end = new Date(toDate);
        end.setDate(end.getDate() + 1);
        where.createdAt.lt = end;
      }
    }

    // console.log("Constructed where clause:", JSON.stringify(where, null, 2));
    // console.log(
    //   "\nConstructed where clause:",
    //   JSON.stringify(where.createdAt, null, 2),
    // );

    /* -------------------------
       DEMO DATE FILTER (INDEXED)
    ------------------------- */

    if (demoFromDate || demoToDate) {
      where.demoScheduledAt = {};
      if (demoFromDate) where.demoScheduledAt.gte = new Date(demoFromDate);
      if (demoToDate) where.demoScheduledAt.lte = new Date(demoToDate);
    }

    if (demoStatus) {
      const now = new Date();

      if (demoStatus === "scheduled") {
        where.demoScheduledAt = { not: null };
        where.demoDoneAt = null;
      }

      if (demoStatus === "done") {
        where.demoDoneAt = { not: null };
      }

      if (demoStatus === "overdue") {
        where.demoScheduledAt = { lt: now };
        where.demoDoneAt = null;
      }

      if (demoStatus === "upcoming") {
        where.demoScheduledAt = { gt: now };
        where.demoDoneAt = null;
      }
    }

    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: "insensitive" } },
        { customerCompanyName: { contains: search, mode: "insensitive" } },
        { mobileNumber: { contains: search } },
        { productTitle: { contains: search, mode: "insensitive" } },
      ];
    }

    if (assignedToAccountId || assignedToTeamId) {
      where.assignments = {
        some: {
          isActive: true,
          ...(assignedToAccountId ? { accountId: assignedToAccountId } : {}),
          ...(assignedToTeamId ? { teamId: assignedToTeamId } : {}),
        },
      };
    }

    if (helperAccountId || helperRole) {
      where.leadHelpers = {
        some: {
          isActive: true,
          ...(helperAccountId ? { accountId: helperAccountId } : {}),
          ...(helperRole ? { role: helperRole as any } : {}),
        },
      };
    }

    /* -------------------------------------------------------
       ✅ FOLLOW-UP FILTERS
       Filters leads that HAVE a matching follow-up
    ------------------------------------------------------- */
    if (
      followUpStatus ||
      followUpType ||
      followUpRange ||
      followUpFromDate ||
      followUpToDate
    ) {
      const followUpWhere: any = {};

      // status filter
      if (followUpStatus) followUpWhere.status = followUpStatus;

      // type filter
      if (followUpType) followUpWhere.type = followUpType;

      // date range filter
      if (followUpRange) {
        const now = new Date();

        if (followUpRange === "today") {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          const end = new Date(now);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt = { gte: start, lte: end };
        } else if (followUpRange === "tomorrow") {
          const start = new Date(now);
          start.setDate(start.getDate() + 1);
          start.setHours(0, 0, 0, 0);
          const end = new Date(start);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt = { gte: start, lte: end };
        } else if (followUpRange === "week") {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          const end = new Date(now);
          end.setDate(end.getDate() + 7);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt = { gte: start, lte: end };
        } else if (followUpRange === "overdue") {
          followUpWhere.status = "PENDING";
          followUpWhere.scheduledAt = { lt: now };
        } else if (followUpRange === "upcoming") {
          followUpWhere.status = "PENDING";
          followUpWhere.scheduledAt = { gt: now };
        } else if (followUpRange === "custom") {
          followUpWhere.scheduledAt = {};
          if (followUpFromDate)
            followUpWhere.scheduledAt.gte = new Date(followUpFromDate);
          if (followUpToDate) {
            const end = new Date(followUpToDate);
            end.setHours(23, 59, 59, 999);
            followUpWhere.scheduledAt.lte = end;
          }
        }
      } else if (followUpFromDate || followUpToDate) {
        // custom range without followUpRange=custom
        followUpWhere.scheduledAt = {};
        if (followUpFromDate)
          followUpWhere.scheduledAt.gte = new Date(followUpFromDate);
        if (followUpToDate) {
          const end = new Date(followUpToDate);
          end.setHours(23, 59, 59, 999);
          followUpWhere.scheduledAt.lte = end;
        }
      }

      // attach to lead where: lead must have at least one matching follow-up
      where.followUps = { some: followUpWhere };
    }

    /* ------------------------------------------------------- */

    /* -------------------------
       DB ORDERING (NO JS SORT)
       Priority:
       1. Working leads
       2. Status
       3. Newest first
    ------------------------- */
    const orderBy = [
      { isWorking: "desc" as const }, // indexed boolean
      { status: "asc" as const }, // enum index
      { createdAt: "desc" as const }, // btree index
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // console.log("\n where", JSON.stringify(where), "\n\n" );

    /* -------------------------
       QUERY (minimal payload)
    ------------------------- */
    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: {
          id: true,
          source: true,
          type: true,
          status: true,
          customerName: true,
          mobileNumber: true,
          productTitle: true,
          cost: true,
          remark: true,
          isWorking: true,
          demoScheduledAt: true,
          demoDoneAt: true,
          demoCount: true,
          statusMark: true,
          totalWorkSeconds: true,
          createdAt: true,
          updatedAt: true,

          followUps: {
            where: { status: "PENDING" },
            orderBy: { scheduledAt: "asc" },
            // take: 1,
            select: {
              id: true,
              type: true,
              status: true,
              scheduledAt: true,
              remark: true,
            },
          },

          assignments: {
            where: { isActive: true },
            select: {
              id: true,
              type: true,
              isActive: true,
              assignedAt: true,
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  contactPhone: true,
                },
              },
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },

          leadHelpers: {
            where: { isActive: true },
            select: {
              role: true,
              isActive: true,
              account: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  designation: true,
                  contactPhone: true,
                },
              },
            },
          },

          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
              customerCompanyName: true,
              products: true,
              customerCategory: true,
            },
          },
        },
      }),
    ]);

    // console.log("\n Leads Response----> ", leads);

    /* -------------------------
       RESPONSE
    ------------------------- */
    return sendSuccessResponse(res, 200, "Leads fetched", {
      data: leads,
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
    console.error("Optimized list leads error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch leads");
  }
}

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
        : {
            type: "TEAM",
            id: previousAssignment.team!.id,
            name: previousAssignment.team!.name,
          }
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
          meta: {
            from: fromSnapshot,
            to: toSnapshot,
            remark: remark ?? null,
          },
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

      // include old account if existed
      const oldRecipients = previousAssignment?.accountId
        ? [previousAssignment.accountId]
        : [];

      return {
        recipients: [...new Set([...newRecipients, ...oldRecipients])],
      };
    });

    try {
      const io = getIo();

      const patchPayload = {
        id,
        patch: {
          assignment: toSnapshot,
          updatedAt: new Date(),
        },
      };

      recipients.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch (e) {
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

/**
 * GET /admin/leads/:id
 * Fetch single lead detail (optimized)
 */
export async function getLeadByIdAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // console.log("\n\n\n\nLead ID param:", id);

    if (!id) {
      return sendErrorResponse(res, 400, "Lead ID is required");
    }

    const lead = await prisma.lead.findUnique({
      where: { id },

      select: {
        id: true,
        source: true,
        type: true,
        status: true,
        statusMark: true,

        demoScheduledAt: true,
        demoDoneAt: true,
        demoCount: true,
        demoMeta: true,

        customerName: true,
        mobileNumber: true,

        product: true,
        productTitle: true,
        cost: true,
        remark: true,

        isWorking: true,
        totalWorkSeconds: true,

        createdAt: true,
        updatedAt: true,
        closedAt: true,

        /* -------------------------
           ACTIVE ASSIGNMENTS
        ------------------------- */
        assignments: {
          where: { isActive: true },
          select: {
            id: true,
            type: true,
            remark: true,
            assignedAt: true,
            isActive: true,

            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactPhone: true,
              },
            },

            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },

        /* -------------------------
           ACTIVE HELPERS
        ------------------------- */
        leadHelpers: {
          where: { isActive: true },
          select: {
            role: true,
            addedAt: true,
            isActive: true,

            account: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                contactPhone: true,
              },
            },
          },
        },

        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            customerCompanyName: true,
            products: true,
            customerCategory: true,
          },
        },
      },
    });

    if (!lead) {
      return sendErrorResponse(res, 404, "Lead not found");
    }

    return sendSuccessResponse(res, 200, "Lead fetched", lead);
  } catch (err: any) {
    console.error("Get lead by ID error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch lead");
  }
}

/**
 * DELETE /admin/leads/:id   (soft close)
 */
export async function closeLeadAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;

    const performerSnapshot =
      await resolvePerformerSnapshot(performerAccountId);

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        statusMark: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });

    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    if (existing.status === "CLOSED")
      return sendErrorResponse(res, 400, "Lead already closed");

    const updated = await prisma.$transaction(async (tx) => {
      const statusMark = {
        ...(existing.statusMark as Record<string, boolean> | null),
        close: true,
      };
      await tx.lead.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          isWorking: false,
          statusMark,
        },
      });

      // deactivate active assignments
      await tx.leadAssignment.updateMany({
        where: { leadId: id, isActive: true },
        data: {
          isActive: false,
          unassignedAt: new Date(),
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "CLOSED",
          performedBy: performerAccountId,
          meta: {
            closedBy: performerSnapshot,
            closedAt: new Date().toISOString(),
          },
        },
      });
    });

    // -------------------------
    // Resolve recipients
    // -------------------------
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
          status: "CLOSED",
          isWorking: false,
          closedAt: new Date(),
          updatedAt: new Date(),
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Lead closed successfully");
  } catch (err: any) {
    console.error("Close lead error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to close lead");
  }
}

/**
 * DELETE /admin/leads/:id/permanent
 * Hard delete lead with all related records
 */
export async function deleteLeadPermanentAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) {
      return sendErrorResponse(res, 401, "Invalid session user");
    }

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
      },
    });

    if (!existing) {
      return sendErrorResponse(res, 404, "Lead not found");
    }

    if (existing.isWorking) {
      return sendErrorResponse(
        res,
        400,
        "Cannot delete lead while work is active",
      );
    }

    await prisma.$transaction(async (tx) => {
      // 1️⃣ Delete activity logs
      await tx.leadActivityLog.deleteMany({
        where: { leadId: id },
      });

      // 2️⃣ Delete assignments
      await tx.leadAssignment.deleteMany({
        where: { leadId: id },
      });

      // 3️⃣ Delete helpers
      await tx.leadHelper.deleteMany({
        where: { leadId: id },
      });

      // --- Inside transaction (add BEFORE deleting lead) ---

      // 🧹 Remove this lead's product from customer
      if (existing.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: existing.customerId },
          select: { id: true, products: true },
        });

        const customerProducts: any = customer?.products ?? {
          active: [],
          history: [],
        };
        if (
          Array.isArray(customerProducts.active) &&
          customerProducts.active.length
        ) {
          const oldTitle =
            (existing.product as any)?.title ?? existing.productTitle;
          const oldCost = existing.cost;

          const filteredActive = customerProducts.active.filter((p: any) => {
            const titleMatch = oldTitle && p.name === oldTitle;
            const costMatch =
              oldCost !== undefined &&
              oldCost !== null &&
              String(p.price) === String(oldCost);

            // ❌ remove only matching product
            return !(titleMatch || costMatch);
          });

          await tx.customer.update({
            where: { id: existing.customerId },
            data: {
              products: {
                ...customerProducts,
                active: filteredActive,
              },
              updatedAt: new Date(),
            },
          });
        }
      }

      // 4️⃣ Disconnect M2M accounts (if any)
      await tx.lead.update({
        where: { id },
        data: {
          accounts: {
            set: [],
          },
        },
      });

      // 5️⃣ Finally delete lead
      await tx.lead.delete({
        where: { id },
      });
    });

    // Socket patch → remove from UI
    try {
      const io = getIo();

      io.to("leads:admin").emit("lead:deleted", { id });
      io.emit("lead:deleted", { id });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(
      res,
      200,
      "Lead permanently deleted successfully",
    );
  } catch (err: any) {
    console.error("Permanent delete lead error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to permanently delete lead",
    );
  }
}

/**
 * GET /admin/leads/:id/activity
 */
export async function getLeadActivityTimelineAdmin(
  req: Request,
  res: Response,
) {
  try {
    const adminUserId = req.user?.id;
    if (!adminUserId) return sendErrorResponse(res, 401, "Unauthorized");
    // if (!req.user?.roles?.includes?.("ADMIN"))
    //   return sendErrorResponse(res, 403, "Admin access required");

    const { id } = req.params;
    const leadExists = await prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!leadExists) return sendErrorResponse(res, 404, "Lead not found");

    const activity = await prisma.leadActivityLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      include: {
        performedByAccount: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            contactPhone: true,
          },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Lead activity timeline fetched", {
      leadId: id,
      total: activity.length,
      activity,
    });
  } catch (err: any) {
    console.error("Admin lead activity timeline error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead activity",
    );
  }
}

/**
 * POST /admin/leads/:id/helpers
 * Add helper/export employee to lead
 */
export async function addLeadHelperAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { id: leadId } = req.params;
    const { accountId, role = "EXPORT" } = req.body;

    if (!accountId) {
      return sendErrorResponse(res, 400, "accountId is required");
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!lead) return sendErrorResponse(res, 404, "Lead not found");

    const { helper } = await prisma.$transaction(async (tx) => {
      const upserted = await tx.leadHelper.upsert({
        where: {
          leadId_accountId: {
            leadId,
            accountId,
          },
        },
        update: {
          isActive: true,
          removedAt: null,
          role,
        },
        create: {
          leadId,
          accountId,
          role,
          addedBy: performerAccountId,
        },
      });

      const initialAssignee = await resolveAssigneeSnapshot({
        accountId: accountId,
      });

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "HELPER_ADDED",
          performedBy: performerAccountId,
          meta: {
            initialAssignment: initialAssignee,
            role,
          },
        },
      });

      return { helper: upserted };
    });

    let recipientAccountIds: string[] = [accountId]; // notify helper

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
        patch: {
          helperAdded: {
            accountId,
            role,
            addedAt: new Date(),
          },
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Helper added to lead", helper);
  } catch (err: any) {
    console.error(err);
    return sendErrorResponse(res, 500, "Failed to add helper");
  }
}

/**
 * DELETE /admin/leads/:id/helpers/:accountId"
 * Remove helper/export employee from lead
 */
export async function removeLeadHelperAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    const { id: leadId, accountId } = req.params;

    if (!leadId || !accountId)
      return sendErrorResponse(res, 400, "Invalid parameters");

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
      const initialAssignee = await resolveAssigneeSnapshot({
        accountId: accountId,
      });

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "HELPER_REMOVED",
          performedBy: performerAccountId!,
          meta: { initialAssignment: initialAssignee },
        },
      });
    });

    let recipientAccountIds: string[] = [accountId]; // notify removed helper

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
        patch: {
          helperRemoved: {
            accountId,
            removedAt: new Date(),
          },
        },
      };

      recipientAccountIds.forEach((accId) => {
        io.to(`leads:user:${accId}`).emit("lead:patch", patchPayload);
      });

      io.to("leads:admin").emit("lead:patch", patchPayload);
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Helper removed");
  } catch (err) {
    return sendErrorResponse(res, 500, "Failed to remove helper");
  }
}

/**
 * PATCH /admin/leads/:id/customer
 * Correct customer details on an existing lead
 */
export async function updateLeadCustomerAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const { customerName, mobileNumber, customerCompanyName } =
      req.body as Record<string, string>;

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
      const lead = await tx.lead.update({
        where: { id },
        data: updateData,
      });

      // also sync customer record if mobile changed
      if (updateData.mobileNumber) {
        // Check if another customer already owns the new mobile
        const targetCustomer = await tx.customer.findUnique({
          where: { normalizedMobile: updateData.mobileNumber },
          select: { id: true },
        });

        if (targetCustomer) {
          // ── Case A: New mobile belongs to an existing customer ──
          // Re-link the lead to that customer and update their name/company if provided.
          await tx.lead.update({
            where: { id },
            data: { customerId: targetCustomer.id },
          });

          await tx.customer.update({
            where: { id: targetCustomer.id },
            data: {
              ...(updateData.customerName
                ? { name: updateData.customerName }
                : {}),
              ...(updateData.customerCompanyName !== undefined
                ? { customerCompanyName: updateData.customerCompanyName }
                : {}),
              updatedAt: new Date(),
            },
          });
        } else {
          // ── Case B: No one owns this mobile yet — safe to update ──
          await tx.customer.updateMany({
            where: { normalizedMobile: existing.mobileNumber },
            data: {
              ...(updateData.customerName
                ? { name: updateData.customerName }
                : {}),
              ...(updateData.customerCompanyName !== undefined
                ? { customerCompanyName: updateData.customerCompanyName }
                : {}),
              mobile: mobileNumber,
              normalizedMobile: updateData.mobileNumber,
              updatedAt: new Date(),
            },
          });
        }
      } else if (
        updateData.customerName ||
        updateData.customerCompanyName !== undefined
      ) {
        // No mobile change — just update name/company on the existing customer
        await tx.customer.updateMany({
          where: { normalizedMobile: existing.mobileNumber },
          data: {
            ...(updateData.customerName
              ? { name: updateData.customerName }
              : {}),
            ...(updateData.customerCompanyName !== undefined
              ? { customerCompanyName: updateData.customerCompanyName }
              : {}),
            updatedAt: new Date(),
          },
        });
      }

      return lead;
    });

    // socket patch
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
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update customer details",
    );
  }
}

/**
 * PATCH /admin/leads/:id/product
 * Correct product information on an existing lead
 */
export async function updateLeadProductAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;

    // console.log("\n - - performerAccountId", performerAccountId , "\n");

    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const { product, productTitle, cost } = req.body as Record<string, any>;

    if (!product && !productTitle && cost === undefined)
      return sendErrorResponse(res, 400, "At least one field is required");

    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        product: true,
        productTitle: true,
        cost: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    const resolvedProduct = product
      ? {
          id: product.id || randomUUID(),
          slug: product.slug ?? null,
          link: product.link ?? null,
          title: product.title ?? null,
          introVideoId: product.introVideoId ?? null,
        }
      : undefined;

    const resolvedProductTitle = resolvedProduct?.title ?? productTitle ?? null;

    const updateData: Record<string, any> = {};
    if (resolvedProduct) updateData.product = resolvedProduct;
    if (resolvedProductTitle) updateData.productTitle = resolvedProductTitle;
    if (cost !== undefined) updateData.cost = cost;

    const updated = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.update({
        where: { id },
        data: updateData,
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

      // ── Sync customer products JSON ──────────────────────────────
      // if (lead.customerId && (resolvedProductTitle || cost !== undefined)) {
      //   const customer = await tx.customer.findUnique({
      //     where: { id: lead.customerId },
      //     select: { id: true, products: true },
      //   });

      //   if (customer) {
      //     const existingProducts: any = customer.products ?? {
      //       active: [],
      //       history: [],
      //     };
      //     if (!existingProducts.active) existingProducts.active = [];

      //     // Match by old product title (before update) so we update the right entry
      //     const oldTitle =
      //       (existing.product as any)?.title ?? existing.productTitle;
      //     const oldCost = existing.cost;

      //     const idx = existingProducts.active.findIndex((p: any) => {
      //       const titleMatch = oldTitle && p.name === oldTitle;
      //       const costMatch =
      //         oldCost !== undefined &&
      //         oldCost !== null &&
      //         String(p.price) === String(oldCost);
      //       return titleMatch || costMatch;
      //     });

      //     if (idx !== -1) {
      //       // Update matched entry
      //       if (resolvedProductTitle) {
      //         existingProducts.active[idx].name = resolvedProductTitle;
      //       }
      //       if (cost !== undefined) {
      //         existingProducts.active[idx].price = cost;
      //       }
      //     } else if (resolvedProductTitle || cost !== undefined) {
      //       // No match found — add a new active entry so customer record stays consistent
      //       existingProducts.active.push({
      //         id: resolvedProduct?.id ?? randomUUID(),
      //         name: resolvedProductTitle ?? "Unknown Product",
      //         price: cost ?? null,
      //         addedAt: new Date(),
      //         status: "ACTIVE",
      //       });
      //     }

      //     await tx.customer.update({
      //       where: { id: customer.id },
      //       data: {
      //         products: existingProducts,
      //         updatedAt: new Date(),
      //       },
      //     });
      //   }
      // }

      // Replace the manual customer sync block with:
      if (cost !== undefined || resolvedProductTitle) {
        await syncProductCostToEntities(tx, {
          leadId: id,
          customerId: lead.customerId,
          productId:
            (existing.product as any)?.id ?? resolvedProduct?.id ?? null,
          productSlug:
            (existing.product as any)?.slug ?? resolvedProduct?.slug ?? null,
          productTitle: resolvedProductTitle,
          oldTitle:
            (existing.product as any)?.title ?? existing.productTitle ?? null,
          newCost:
            cost !== undefined ? Number(cost) : Number(existing.cost ?? 0),
        });
      }
      // ─────────────────────────────────────────────────────────────

      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "UPDATED",
          performedBy: performerAccountId,
          meta: {
            type: "PRODUCT_CORRECTED",
            changes: {
              ...(resolvedProduct
                ? { product: { from: existing.product, to: resolvedProduct } }
                : {}),
              ...(resolvedProductTitle
                ? {
                    productTitle: {
                      from: existing.productTitle,
                      to: resolvedProductTitle,
                    },
                  }
                : {}),
              ...(cost !== undefined
                ? { cost: { from: existing.cost, to: cost } }
                : {}),
            },
          },
        },
      });

      return lead;
    });

    // socket patch
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
          product: updated.product,
          productTitle: updated.productTitle,
          cost: updated.cost,
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

    return sendSuccessResponse(res, 200, "Product details updated", updated);
  } catch (err: any) {
    console.error("Update lead product error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update product details",
    );
  }
}

/**
 * GET /admin/leads/stats/status
 * Optional filters: fromDate, toDate, source
 */
export async function getLeadCountByStatusAdmin(req: Request, res: Response) {
  try {
    const {
      fromDate,
      toDate,
      source,
      accountId,
      demoFromDate,
      demoToDate,
      demoStatus,
    } = req.query as Record<string, string>;

    const where: any = {};
    const now = new Date();

    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
      if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
    }

    if (demoFromDate || demoToDate) {
      where.demoScheduledAt = {
        ...(demoFromDate && {
          gte: new Date(`${demoFromDate}T00:00:00.000+05:30`),
        }),
        ...(demoToDate && {
          lte: new Date(`${demoToDate}T23:59:59.999+05:30`),
        }),
      };
    }

    if (demoStatus === "overdue") {
      where.demoScheduledAt = { lt: now };
      where.demoDoneAt = null;
    }
    if (demoStatus === "upcoming") {
      where.demoScheduledAt = { gt: now };
      where.demoDoneAt = null;
    }
    if (demoStatus === "done") {
      where.demoDoneAt = { not: null };
    }

    if (accountId) {
      where.assignments = {
        some: {
          accountId,
          isActive: true,
        },
      };
    }

    // console.log("\n\n\n\n\nfromDate", fromDate);
    // console.log("\ntoDate", toDate);

    /**
     * Use groupBy (single DB roundtrip, very fast)
     */
    const grouped = await prisma.lead.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    });

    /**
     * Normalize output to include all statuses
     */
    const result = {
      PENDING: 0,
      IN_PROGRESS: 0,
      FOLLOW_UPS: 0,
      DEMO_DONE: 0,
      INTERESTED: 0,
      CONVERTED: 0,
      CLOSED: 0,
      TOTAL: 0,
    };

    for (const row of grouped) {
      result[row.status as keyof typeof result] = row._count._all;
      result.TOTAL += row._count._all;
    }

    return sendSuccessResponse(res, 200, "Lead counts fetched", result);
  } catch (err: any) {
    console.error("Lead count by status error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead counts",
    );
  }
}

/**
 * GET /admin/lead/stats/leads/value
 * Total lead value (cost) grouped by status + grand total
 * Optional filters: fromDate, toDate, source, accountId
 */
export async function getLeadValueStatsAdmin(req: Request, res: Response) {
  try {
    const { fromDate, toDate, source, accountId } = req.query as Record<
      string,
      string
    >;

    const where: any = {};

    if (source) where.source = source;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setDate(end.getDate() + 1);
        where.createdAt.lt = end;
      }
    }

    if (accountId) {
      where.assignments = {
        some: { accountId, isActive: true },
      };
    }

    // only leads that have a cost value
    // where.cost = { not: null };

    const grouped = await prisma.lead.groupBy({
      by: ["status"],
      where,
      _sum: { cost: true },
      _count: { _all: true },
    });

    const statuses: Lead_Status[] = [
      "PENDING",
      "IN_PROGRESS",
      "FOLLOW_UPS",
      "DEMO_DONE",
      "INTERESTED",
      "CONVERTED",
      "CLOSED",
    ];

    // normalize — include all statuses even if no leads
    const byStatus = statuses.reduce(
      (acc, status) => {
        const row = grouped.find((r) => r.status === status);
        acc[status] = {
          totalValue: row?._sum?.cost ? Number(row._sum.cost) : 0,
          count: row?._count?._all ?? 0,
        };
        return acc;
      },
      {} as Record<string, { totalValue: number; count: number }>,
    );

    const grandTotal = grouped.reduce(
      (sum, row) => sum + (row._sum?.cost ? Number(row._sum.cost) : 0),
      0,
    );

    const totalCount = grouped.reduce(
      (sum, row) => sum + (row._count?._all ?? 0),
      0,
    );

    return sendSuccessResponse(res, 200, "Lead value stats fetched", {
      byStatus,
      total: {
        totalValue: grandTotal,
        count: totalCount,
      },
    });
  } catch (err: any) {
    console.error("Lead value stats error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch lead value stats",
    );
  }
}

/**
 * POST /admin/leads/:id/products
 * Add / replace products on a lead and sync to customer.
 *
 * Body:
 * {
 *   products: LeadProductItem[]   // full new list OR items to merge
 *   mode: "replace" | "merge"     // default: "merge"
 * }
 */
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

    /* ── Validate ───────────────────────────────────────────────── */
    if (!Array.isArray(incomingProducts) || incomingProducts.length === 0)
      return sendErrorResponse(res, 400, "products array is required");

    for (const p of incomingProducts) {
      if (!p.id || !p.title)
        return sendErrorResponse(
          res,
          400,
          `Each product must have id and title (got: ${JSON.stringify(p)})`,
        );
    }

    /* ── Fetch existing lead ────────────────────────────────────── */
    const existing = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        product: true,
        productTitle: true,
        cost: true,
        assignments: {
          where: { isActive: true },
          select: { accountId: true, teamId: true },
        },
      },
    });
    if (!existing) return sendErrorResponse(res, 404, "Lead not found");

    /* ── Build new products list ────────────────────────────────── */
    let currentProducts = normalizeLeadProducts(existing.product);

    if (mode === "replace") {
      currentProducts = incomingProducts;
    } else {
      // merge: upsert by id
      for (const incoming of incomingProducts) {
        const idx = currentProducts.findIndex((p) => p.id === incoming.id);
        if (idx !== -1) {
          currentProducts[idx] = { ...currentProducts[idx], ...incoming };
        } else {
          currentProducts.push(incoming);
        }
      }
    }

    // ensure exactly one isPrimary (first wins if none set)
    const hasPrimary = currentProducts.some((p) => p.isPrimary);
    if (!hasPrimary && currentProducts.length > 0) {
      currentProducts[0].isPrimary = true;
    }

    const { productTitle, cost: derivedCost } = deriveLeadMeta(currentProducts);

    /* ── Transaction ────────────────────────────────────────────── */
    const updated = await prisma.$transaction(async (tx) => {
      /* 1. Update lead */
      const lead = await tx.lead.update({
        where: { id },
        data: {
          product: currentProducts as any,
          productTitle,
          cost: derivedCost ?? undefined,
        },
        select: {
          id: true,
          customerId: true,
          product: true,
          productTitle: true,
          cost: true,
          updatedAt: true,
        },
      });

      /* 2. Sync customer.products.active ── */
      if (lead.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: lead.customerId },
          select: { id: true, products: true },
        });

        if (customer) {
          const customerProducts: any = customer.products ?? {
            active: [],
            history: [],
          };
          if (!Array.isArray(customerProducts.active))
            customerProducts.active = [];
          if (!Array.isArray(customerProducts.history))
            customerProducts.history = [];

          for (const lp of currentProducts) {
            const existingIdx = customerProducts.active.findIndex(
              (cp: any) => cp.id === lp.id || cp.name === lp.title,
            );

            if (existingIdx !== -1) {
              // update price if changed
              if (lp.cost !== undefined && lp.cost !== null) {
                customerProducts.active[existingIdx].price = lp.cost;
              }
              customerProducts.active[existingIdx].name = lp.title;
            } else {
              // add as new active product
              customerProducts.active.push({
                id: lp.id,
                name: lp.title,
                price: lp.cost ?? null,
                addedAt: new Date(),
                status: "ACTIVE",
              });
            }
          }

          await tx.customer.update({
            where: { id: customer.id },
            data: {
              products: customerProducts,
              updatedAt: new Date(),
            },
          });
        }
      }

      // Replace the manual customer sync loop with:
      
      // for (const lp of currentProducts) {
      //   if (lp.cost !== undefined && lp.cost !== null) {
      //     await syncProductCostToEntities(tx, {
      //       leadId: id,
      //       customerId: lead.customerId,
      //       productId: lp.id ?? null,
      //       productSlug: lp.slug ?? null,
      //       productTitle: lp.title ?? null,
      //       newCost: Number(lp.cost),
      //     });
      //   }
      // }

      /* 3. Activity log */
      await tx.leadActivityLog.create({
        data: {
          leadId: id,
          action: "UPDATED",
          performedBy: performerAccountId,
          meta: {
            type: "PRODUCTS_UPDATED",
            mode,
            products: currentProducts as any,
            productTitle,
          },
        },
      });

      return lead;
    });

    /* ── Socket ─────────────────────────────────────────────────── */
    try {
      const io = getIo();
      const patchPayload = {
        id,
        patch: {
          product: updated.product,
          productTitle: updated.productTitle,
          cost: updated.cost,
          updatedAt: updated.updatedAt,
        },
      };

      const assignee = existing.assignments[0];
      if (assignee?.accountId) {
        io.to(`leads:user:${assignee.accountId}`).emit(
          "lead:patch",
          patchPayload,
        );
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

    return sendSuccessResponse(res, 200, "Products updated", {
      products: updated.product,
      productTitle: updated.productTitle,
      cost: updated.cost,
    });
  } catch (err: any) {
    console.error("Add lead products error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update products",
    );
  }
}

/* ─────────────────────────────────────────
    FOLLOW UPS
───────────────────────────────────────── */

/**
 * Recalculates and syncs Lead.nextFollowUpAt + Lead.lastFollowUpDoneAt
 * Must be called inside a transaction after any follow-up mutation.
 */
async function syncLeadFollowUpAggregates(
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

/* ─────────────────────────────────────────
   POST /leads/:leadId/follow-ups
   Create a new follow-up for a lead
───────────────────────────────────────── */
export async function createFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId } = req.params;
    const {
      type = "CALL",
      scheduledAt,
      remark,
    } = req.body as {
      type?: "CALL" | "DEMO" | "MEETING" | "VISIT" | "WHATSAPP" | "OTHER";
      scheduledAt: string;
      remark?: string;
    };

    if (!scheduledAt)
      return sendErrorResponse(res, 400, "scheduledAt is required");

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

      // increment followUpCount + sync nextFollowUpAt
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

    // socket
    try {
      getIo().to("leads:admin").emit("followup:created", { leadId, followUp });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 201, "Follow-up scheduled", followUp);
  } catch (err: any) {
    console.error("Create follow-up error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create follow-up",
    );
  }
}

/* ─────────────────────────────────────────
   PATCH /leads/:leadId/follow-ups/:id
   Mark done | reschedule | update remark
───────────────────────────────────────── */
export async function updateFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId, id } = req.params;
    const {
      action, // "done" | "reschedule" | "missed" | "update"
      scheduledAt, // required when action = "reschedule"
      remark,
      type,
    } = req.body as {
      action: "done" | "reschedule" | "missed" | "update";
      scheduledAt?: string;
      remark?: string;
      type?: "CALL" | "DEMO" | "MEETING" | "VISIT" | "WHATSAPP" | "OTHER";
    };

    if (!action)
      return sendErrorResponse(
        res,
        400,
        "action is required: done | reschedule | missed | update",
      );

    const existing = await prisma.leadFollowUp.findFirst({
      where: { id, leadId },
    });
    if (!existing) return sendErrorResponse(res, 404, "Follow-up not found");

    if (existing.status === "DONE")
      return sendErrorResponse(res, 400, "Follow-up already marked as done");

    const result = await prisma.$transaction(async (tx) => {
      let updated: any;
      let newFollowUp: any = null;
      let activityAction: string;

      // ── DONE ──────────────────────────────────────────────────────────
      if (action === "done") {
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: {
            status: "DONE",
            doneAt: new Date(),
            doneBy: accountId,
            remark: remark ?? existing.remark,
          },
        });
        activityAction = "FOLLOW_UP_DONE";
      }

      // ── RESCHEDULE ────────────────────────────────────────────────────
      else if (action === "reschedule") {
        if (!scheduledAt)
          throw new Error("scheduledAt is required for reschedule");

        // mark old one as RESCHEDULED
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: { status: "RESCHEDULED" },
        });

        // create new follow-up linked to old one
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

        await tx.lead.update({
          where: { id: leadId },
          data: { followUpCount: { increment: 1 } },
        });

        activityAction = "FOLLOW_UP_RESCHEDULED";
      }

      // ── MISSED ────────────────────────────────────────────────────────
      else if (action === "missed") {
        updated = await tx.leadFollowUp.update({
          where: { id },
          data: { status: "MISSED" },
        });
        activityAction = "FOLLOW_UP_MISSED";
      }

      // ── UPDATE (remark / type only) ───────────────────────────────────
      else if (action === "update") {
        const patch: any = {};
        if (remark !== undefined) patch.remark = remark;
        if (type !== undefined) patch.type = type;
        if (scheduledAt !== undefined)
          patch.scheduledAt = new Date(scheduledAt);

        updated = await tx.leadFollowUp.update({ where: { id }, data: patch });
        activityAction = "FOLLOW_UP_SCHEDULED"; // reuse — or add FOLLOW_UP_UPDATED enum
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
      getIo()
        .to("leads:admin")
        .emit("followup:updated", { leadId, ...result });
    } catch {
      console.warn("Socket emit skipped");
    }

    return sendSuccessResponse(res, 200, "Follow-up updated", result);
  } catch (err: any) {
    console.error("Update follow-up error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update follow-up",
    );
  }
}

/* ─────────────────────────────────────────
   GET /leads/:leadId/follow-ups
   Follow-ups for a specific lead
───────────────────────────────────────── */
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
        createdByAcc: {
          select: { id: true, firstName: true, lastName: true },
        },
        doneByAcc: {
          select: { id: true, firstName: true, lastName: true },
        },
        rescheduledTo: {
          select: { id: true, scheduledAt: true, status: true },
        },
        rescheduledFrom: {
          select: { id: true, scheduledAt: true, status: true },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Follow-ups fetched", followUps);
  } catch (err: any) {
    console.error("Get lead follow-ups error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch follow-ups",
    );
  }
}

/* ─────────────────────────────────────────
   GET /follow-ups
   Global list — filter by status / type /
   date range / assignee / overdue etc.
───────────────────────────────────────── */
export async function listFollowUps(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const {
      status, // PENDING | DONE | MISSED | RESCHEDULED
      type, // CALL | DEMO | MEETING | ...
      range, // today | tomorrow | week | overdue | custom
      fromDate,
      toDate,
      assignedToAccountId,
      assignedToTeamId,
      leadId,
      sortBy = "scheduledAt", // scheduledAt | createdAt
      sortOrder = "asc",
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNumber - 1) * pageSize;

    const now = new Date();

    /* ── where ── */
    const where: any = {};

    if (leadId) where.leadId = leadId;
    if (status) where.status = status;
    if (type) where.type = type;

    // ── date range shortcuts ──────────────────────────────────────────
    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "tomorrow") {
      const start = new Date(now);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "week") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      end.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: start, lte: end };
    } else if (range === "overdue") {
      where.status = "PENDING";
      where.scheduledAt = { lt: now };
    } else if (range === "custom") {
      where.scheduledAt = {};
      if (fromDate) where.scheduledAt.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        where.scheduledAt.lte = end;
      }
    }

    // ── filter by lead's assignee ─────────────────────────────────────
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

    /* ── orderBy ── */
    const validSortFields: Record<string, boolean> = {
      scheduledAt: true,
      createdAt: true,
      doneAt: true,
    };
    const safeSortBy = validSortFields[sortBy] ? sortBy : "scheduledAt";
    const safeOrder = sortOrder === "desc" ? "desc" : "asc";
    const orderBy = [{ [safeSortBy]: safeOrder }];

    /* ── query ── */
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
                  account: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                  team: { select: { id: true, name: true } },
                },
              },
            },
          },
          createdByAcc: {
            select: { id: true, firstName: true, lastName: true },
          },
          doneByAcc: {
            select: { id: true, firstName: true, lastName: true },
          },
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
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch follow-ups",
    );
  }
}

/* ─────────────────────────────────────────
   DELETE /leads/:leadId/follow-ups/:id
   Only PENDING follow-ups can be deleted
───────────────────────────────────────── */
export async function deleteFollowUp(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

    const { leadId, id } = req.params;

    const existing = await prisma.leadFollowUp.findFirst({
      where: { id, leadId },
    });
    if (!existing) return sendErrorResponse(res, 404, "Follow-up not found");
    if (existing.status !== "PENDING")
      return sendErrorResponse(
        res,
        400,
        "Only PENDING follow-ups can be deleted",
      );

    await prisma.$transaction(async (tx) => {
      await tx.leadFollowUp.delete({ where: { id } });

      await tx.lead.update({
        where: { id: leadId },
        data: { followUpCount: { decrement: 1 } },
      });

      await syncLeadFollowUpAggregates(tx, leadId);

      await tx.leadActivityLog.create({
        data: {
          leadId,
          action: "FOLLOW_UP_SCHEDULED", // log deletion in meta
          performedBy: accountId,
          meta: {
            followUpId: id,
            action: "DELETED",
            scheduledAt: existing.scheduledAt,
          },
        },
      });
    });

    return sendSuccessResponse(res, 200, "Follow-up deleted");
  } catch (err: any) {
    console.error("Delete follow-up error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete follow-up",
    );
  }
}
