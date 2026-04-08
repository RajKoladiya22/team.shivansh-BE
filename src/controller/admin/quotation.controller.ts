// src/controller/admin/quotation.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import {
  generateQuotationNumber,
  computeLineItems,
  computeFinancials,
  buildCustomerSnapshot,
  quotationFullSelect,
  LineItemInput,
  toNullableNumber,
  trySendQuotationEmail,
} from "../../services/quotation";

/* ─────────────────────────────────────────────
   POST /admin/quotations
   Create a new quotation (DRAFT)
───────────────────────────────────────────── */
export async function createQuotationAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const {
      customerId,
      leadId,
      lineItems: rawItems,
      subject,
      introNote,
      termsNote,
      footerNote,
      paymentTerms,
      paymentDueDays,
      deliveryScope,
      deliveryDays,
      validUntil,
      quotationDate,
      channel,
      taxType,
      gstin,
      customerGstin,
      placeOfSupply,
      extraDiscountType,
      extraDiscountValue,
      extraDiscountNote,
      internalNote,
      tags,
      preparedBy,
      templateId, // optional: load defaults from template
    } = req.body as Record<string, any>;

    if (!customerId)
      return sendErrorResponse(res, 400, "customerId is required");
    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0)
      return sendErrorResponse(res, 400, "At least one line item is required");

    // validate each item
    for (const item of rawItems as LineItemInput[]) {
      if (!item.name?.trim())
        return sendErrorResponse(res, 400, "Each line item must have a name");
      if (item.basePrice === undefined || item.basePrice < 0)
        return sendErrorResponse(
          res,
          400,
          `Invalid basePrice for "${item.name}"`,
        );
      if (!item.qty || item.qty < 1)
        return sendErrorResponse(res, 400, `Invalid qty for "${item.name}"`);
    }

    // fetch customer
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        mobile: true,
        email: true,
        customerCompanyName: true,
        city: true,
        state: true,
        isActive: true,
      },
    });
    if (!customer) return sendErrorResponse(res, 404, "Customer not found");

    // optionally load template defaults
    let templateDefaults: any = {};
    if (templateId) {
      const tpl = await prisma.quotationTemplate.findUnique({
        where: { id: templateId },
      });
      if (tpl) {
        templateDefaults = {
          introNote: tpl.introNote,
          termsNote: tpl.termsNote,
          footerNote: tpl.footerNote,
          paymentTerms: tpl.paymentTerms,
          subject: tpl.subject,
        };
      }
    }

    // compute financials
    const computed = computeLineItems(rawItems as LineItemInput[]);
    const financials = computeFinancials(
      computed,
      extraDiscountType,
      extraDiscountValue,
    );

    const quotationNumber = await generateQuotationNumber();
    const customerSnapshot = buildCustomerSnapshot(customer);

    const quotation = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          quotationNumber,
          status: "DRAFT",
          channel: channel ?? "EMAIL",
          customerId,
          customerSnapshot,
          createdBy: performerAccountId,
          preparedBy: preparedBy ?? null,
          leadId: leadId ?? null,
          lineItems: computed as any,
          subtotal: financials.subtotal,
          totalDiscount: financials.totalDiscount,
          totalTax: financials.totalTax,
          grandTotal: financials.grandTotal,
          extraDiscountType: extraDiscountType ?? null,
          extraDiscountValue: extraDiscountValue ?? null,
          extraDiscountNote: extraDiscountNote ?? null,
          taxType: taxType ?? "GST",
          gstin: gstin ?? null,
          customerGstin: customerGstin ?? null,
          placeOfSupply: placeOfSupply ?? null,
          quotationDate: quotationDate ? new Date(quotationDate) : new Date(),
          validUntil: validUntil ? new Date(validUntil) : null,
          subject: subject ?? templateDefaults.subject ?? null,
          introNote: introNote ?? templateDefaults.introNote ?? null,
          termsNote: termsNote ?? templateDefaults.termsNote ?? null,
          footerNote: footerNote ?? templateDefaults.footerNote ?? null,
          paymentTerms: paymentTerms ?? templateDefaults.paymentTerms ?? null,
          paymentDueDays: paymentDueDays ?? null,
          deliveryScope: deliveryScope ?? null,
          deliveryDays: deliveryDays ?? null,
          internalNote: internalNote ?? null,
          tags: tags ?? [],
          version: 1,
        },
        select: quotationFullSelect,
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: q.id,
          action: "CREATED",
          performedBy: performerAccountId,
          meta: {
            quotationNumber,
            customerId,
            grandTotal: financials.grandTotal,
          },
        },
      });

      return q;
    });

    return sendSuccessResponse(res, 201, "Quotation created", quotation);
  } catch (err: any) {
    console.error("Create quotation error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create quotation",
    );
  }
}

/* ─────────────────────────────────────────────
   GET /admin/quotations
   List with filters
───────────────────────────────────────────── */
export async function listQuotationsAdmin(req: Request, res: Response) {
  try {
    const {
      status,
      customerId,
      createdBy,
      leadId,
      search,
      fromDate,
      toDate,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(Number(page), 1);
    const pageSize = Math.min(Number(limit), 100);
    const skip = (pageNum - 1) * pageSize;

    const where: any = { deletedAt: null };

    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (createdBy) where.createdBy = createdBy;
    if (leadId) where.leadId = leadId;

    if (fromDate || toDate) {
      where.quotationDate = {};
      if (fromDate) where.quotationDate.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setDate(end.getDate() + 1);
        where.quotationDate.lt = end;
      }
    }

    if (search) {
      where.OR = [
        { quotationNumber: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { customer: { mobile: { contains: search } } },
      ];
    }

    const [total, quotations] = await Promise.all([
      prisma.quotation.count({ where }),
      prisma.quotation.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          channel: true,
          grandTotal: true,
          quotationDate: true,
          validUntil: true,
          sentAt: true,
          version: true,
          tags: true,
          subject: true,
          customer: {
            select: {
              id: true,
              name: true,
              mobile: true,
              customerCompanyName: true,
            },
          },
          createdByAcc: {
            select: { id: true, firstName: true, lastName: true },
          },
          lead: {
            select: { id: true, status: true, productTitle: true },
          },
          _count: { select: { revisions: true } },
        },
      }),
    ]);

    return sendSuccessResponse(res, 200, "Quotations fetched", {
      data: quotations,
      meta: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: pageNum * pageSize < total,
        hasPrev: pageNum > 1,
      },
    });
  } catch (err: any) {
    console.error("List quotations error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch quotations",
    );
  }
}

/* ─────────────────────────────────────────────
   GET /admin/quotations/:id
───────────────────────────────────────────── */
export async function getQuotationByIdAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const quotation = await prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      select: quotationFullSelect,
    });
    if (!quotation) return sendErrorResponse(res, 404, "Quotation not found");
    return sendSuccessResponse(res, 200, "Quotation fetched", quotation);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch quotation",
    );
  }
}

/* ─────────────────────────────────────────────
   PATCH /admin/quotations/:id
   Update draft quotation (cannot edit SENT/ACCEPTED/CONVERTED)
───────────────────────────────────────────── */
export async function updateQuotationAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const existing = await prisma.quotation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return sendErrorResponse(res, 404, "Quotation not found");

    const locked: string[] = [
      "ACCEPTED",
      "CONVERTED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
    ];
    if (locked.includes(existing.status)) {
      return sendErrorResponse(
        res,
        400,
        `Cannot edit a quotation with status ${existing.status}. Revise it instead.`,
      );
    }

    const {
      lineItems: rawItems,
      subject,
      introNote,
      termsNote,
      footerNote,
      paymentTerms,
      paymentDueDays,
      deliveryScope,
      deliveryDays,
      validUntil,
      quotationDate,
      channel,
      taxType,
      gstin,
      customerGstin,
      placeOfSupply,
      extraDiscountType,
      extraDiscountValue,
      extraDiscountNote,
      internalNote,
      tags,
      preparedBy,
    } = req.body as Record<string, any>;

    const updateData: any = {};

    // recompute if line items changed
    if (rawItems && Array.isArray(rawItems) && rawItems.length > 0) {
      const computed = computeLineItems(rawItems as LineItemInput[]);
      // const financials = computeFinancials(
      //   computed,
      //   extraDiscountType ?? (existing.extraDiscountType as any),
      //   extraDiscountValue ?? Number(existing.extraDiscountValue),
      // );
      const financials = computeFinancials(
        computed,
        extraDiscountType ?? (existing.extraDiscountType as any),
        toNullableNumber(extraDiscountValue ?? existing.extraDiscountValue),
      );
      updateData.lineItems = computed;
      updateData.subtotal = financials.subtotal;
      updateData.totalDiscount = financials.totalDiscount;
      updateData.totalTax = financials.totalTax;
      updateData.grandTotal = financials.grandTotal;
    } else if (
      extraDiscountType !== undefined ||
      extraDiscountValue !== undefined
    ) {
      // extra discount changed but no new line items — recompute from existing
      const existing2 = await prisma.quotation.findUnique({ where: { id } });
      const computed = existing2!.lineItems as any[];
      // const financials = computeFinancials(
      //   computed as any,
      //   extraDiscountType ?? (existing.extraDiscountType as any),
      //   extraDiscountValue ?? Number(existing.extraDiscountValue),
      // );
      const financials = computeFinancials(
        existing.lineItems as any,
        extraDiscountType ?? (existing.extraDiscountType as any),
        toNullableNumber(extraDiscountValue ?? existing.extraDiscountValue),
      );
      updateData.subtotal = financials.subtotal;
      updateData.totalDiscount = financials.totalDiscount;
      updateData.totalTax = financials.totalTax;
      updateData.grandTotal = financials.grandTotal;
    }

    const optionalFields: Record<string, any> = {
      subject,
      introNote,
      termsNote,
      footerNote,
      paymentTerms,
      paymentDueDays,
      deliveryScope,
      deliveryDays,
      channel,
      taxType,
      gstin,
      customerGstin,
      placeOfSupply,
      extraDiscountType,
      extraDiscountValue,
      extraDiscountNote,
      internalNote,
      tags,
      preparedBy,
    };
    for (const [k, v] of Object.entries(optionalFields)) {
      if (v !== undefined) updateData[k] = v;
    }
    if (validUntil !== undefined)
      updateData.validUntil = validUntil ? new Date(validUntil) : null;
    if (quotationDate !== undefined)
      updateData.quotationDate = new Date(quotationDate);

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id },
        data: updateData,
        select: quotationFullSelect,
      });
      await tx.quotationActivity.create({
        data: {
          quotationId: id,
          action: "UPDATED",
          performedBy: performerAccountId,
          meta: { fields: Object.keys(updateData) },
        },
      });
      return q;
    });

    return sendSuccessResponse(res, 200, "Quotation updated", updated);
  } catch (err: any) {
    console.error("Update quotation error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update quotation",
    );
  }
}

/* ─────────────────────────────────────────────
   POST /admin/quotations/:id/send
   Mark as SENT and record send history
───────────────────────────────────────────── */
export async function sendQuotationAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const { channel, sentTo, note } = req.body as Record<string, string>;

    const existing = await prisma.quotation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return sendErrorResponse(res, 404, "Quotation not found");

    const unsendable = ["CANCELLED", "CONVERTED", "REJECTED", "EXPIRED"];
    if (unsendable.includes(existing.status)) {
      return sendErrorResponse(
        res,
        400,
        `Cannot send a ${existing.status} quotation. Create a revision first.`,
      );
    }

    const existingHistory = Array.isArray(existing.sendHistory)
      ? (existing.sendHistory as any[])
      : [];

    const newEntry = {
      sentAt: new Date().toISOString(),
      channel: channel ?? existing.channel,
      sentTo: sentTo ?? null,
      sentBy: performerAccountId,
      note: note ?? null,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id },
        data: {
          status: "SENT",
          sentAt: existing.sentAt ?? new Date(), // only set first time
          sendHistory: [...existingHistory, newEntry],
          channel: (channel as any) ?? existing.channel,
        },
        select: quotationFullSelect,
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: id,
          action: "SENT",
          performedBy: performerAccountId,
          meta: { channel, sentTo, note },
        },
      });

      return q;
    });

    console.log("\n\n\n\n\n\n\n\n\n\n\nsend updated", updated,  "\n\n\n");

    void trySendQuotationEmail(updated, false);

    return sendSuccessResponse(res, 200, "Quotation marked as sent", updated);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to send quotation",
    );
  }
}

/* ─────────────────────────────────────────────
   POST /admin/quotations/:id/remind
   Log a reminder sent
───────────────────────────────────────────── */
export async function remindQuotationAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const { channel, sentTo, note } = req.body as Record<string, string>;

    const existing = await prisma.quotation.findFirst({
      where: { id, deletedAt: null, status: { in: ["SENT", "VIEWED"] } },
    });
    if (!existing)
      return sendErrorResponse(
        res,
        404,
        "Quotation not found or not in a remindable state (must be SENT or VIEWED)",
      );

    const existingHistory = Array.isArray(existing.sendHistory)
      ? (existing.sendHistory as any[])
      : [];

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id },
        data: {
          reminderSentAt: new Date(),
          sendHistory: [
            ...existingHistory,
            {
              sentAt: new Date().toISOString(),
              channel: channel ?? existing.channel,
              sentTo: sentTo ?? null,
              sentBy: performerAccountId,
              note: note ?? "Reminder",
              isReminder: true,
            },
          ],
        },
        // select: { id: true, quotationNumber: true, reminderSentAt: true },
        select: quotationFullSelect,
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: id,
          action: "REMINDER_SENT",
          performedBy: performerAccountId,
          meta: { channel, sentTo, note },
        },
      });

      return q;
    });

    console.log("\n\n\n\n\n\n\n\n\n\n\nremind updated", updated,  "\n\n\n");
    

    void trySendQuotationEmail(updated, true);

    return sendSuccessResponse(res, 200, "Reminder logged", updated);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to log reminder",
    );
  }
}

/* ─────────────────────────────────────────────
   PATCH /admin/quotations/:id/status
   Generic status change (ACCEPTED / REJECTED / CANCELLED / CONVERTED)
───────────────────────────────────────────── */
export async function updateQuotationStatusAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const { status, rejectionReason, acceptedBy, acceptanceNote } =
      req.body as Record<string, string>;

    const allowed = [
      "ACCEPTED",
      "REJECTED",
      "CANCELLED",
      "CONVERTED",
      "EXPIRED",
    ];
    if (!allowed.includes(status))
      return sendErrorResponse(
        res,
        400,
        `Invalid status. Allowed: ${allowed.join(", ")}`,
      );

    const existing = await prisma.quotation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return sendErrorResponse(res, 404, "Quotation not found");

    if (existing.status === "CANCELLED" || existing.status === "CONVERTED") {
      return sendErrorResponse(
        res,
        400,
        `Quotation is already ${existing.status}`,
      );
    }

    const updateData: Record<string, any> = { status };

    if (status === "ACCEPTED" || status === "REJECTED") {
      updateData.respondedAt = new Date();
    }
    if (status === "CONVERTED") {
      updateData.convertedAt = new Date();
    }
    if (status === "REJECTED") {
      updateData.rejectionReason = rejectionReason ?? null;
    }
    if (status === "ACCEPTED") {
      updateData.acceptedBy = acceptedBy ?? null;
      updateData.acceptanceNote = acceptanceNote ?? null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          updatedAt: true,
        },
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: id,
          action: status as any,
          performedBy: performerAccountId,
          meta: { rejectionReason, acceptedBy, acceptanceNote },
        },
      });

      return q;
    });

    return sendSuccessResponse(
      res,
      200,
      `Quotation ${status.toLowerCase()}`,
      updated,
    );
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update status",
    );
  }
}

/* ─────────────────────────────────────────────
   POST /admin/quotations/:id/revise
   Create a new version of a quotation
───────────────────────────────────────────── */
export async function reviseQuotationAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const { id } = req.params;
    const existing = await prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      select: quotationFullSelect,
    });
    if (!existing) return sendErrorResponse(res, 404, "Quotation not found");

    const {
      lineItems: rawItems,
      subject,
      introNote,
      termsNote,
      footerNote,
      paymentTerms,
      paymentDueDays,
      deliveryScope,
      deliveryDays,
      validUntil,
      channel,
      taxType,
      gstin,
      customerGstin,
      placeOfSupply,
      extraDiscountType,
      extraDiscountValue,
      extraDiscountNote,
      internalNote,
      tags,
    } = req.body as Record<string, any>;

    // console.log("\n\n extraDiscountType--->", extraDiscountType);
    // console.log("\n\n extraDiscountValue--->", extraDiscountValue);

    // use new line items if provided, otherwise copy from parent
    const itemsToUse = rawItems?.length
      ? rawItems
      : (existing.lineItems as any[]);
    // const edType = extraDiscountType ?? existing.extraDiscountType;
    // const edValue =
    //   extraDiscountValue !== undefined
    //     ? extraDiscountValue
    //     : toNullableNumber(existing.extraDiscountValue);
    const edType = extraDiscountType
      // extraDiscountType !== undefined
      //   ? extraDiscountType
      //   : existing.extraDiscountType;
    

    const edValue = 
      edType !== undefined
        ? extraDiscountValue
        : undefined

    // console.log("\n\n edType--->", edType);
    // console.log("\n\n edValue--->", edValue);

    const computed = computeLineItems(itemsToUse as LineItemInput[]);
    const financials = computeFinancials(computed, edType as any, edValue);

    const quotationNumber = await generateQuotationNumber();

    const revised = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          quotationNumber,
          status: "DRAFT",
          channel: channel ?? existing.channel,
          customerId: existing.customerId,
          customerSnapshot: existing.customerSnapshot as any,
          createdBy: performerAccountId,
          preparedBy: existing.preparedBy,
          leadId: existing.leadId,
          lineItems: computed as any,
          subtotal: financials.subtotal,
          totalDiscount: financials.totalDiscount,
          totalTax: financials.totalTax,
          grandTotal: financials.grandTotal,
          extraDiscountType: (edType as any) ?? null,
          extraDiscountValue: edValue || null,
          extraDiscountNote:
            extraDiscountNote ?? (existing.extraDiscountNote as any),
          taxType: (taxType ?? existing.taxType) as any,
          gstin: gstin ?? existing.gstin,
          customerGstin: customerGstin ?? existing.customerGstin,
          placeOfSupply: placeOfSupply ?? existing.placeOfSupply,
          quotationDate: new Date(),
          validUntil: validUntil ? new Date(validUntil) : existing.validUntil,
          subject: subject ?? existing.subject,
          introNote: introNote ?? existing.introNote,
          termsNote: termsNote ?? existing.termsNote,
          footerNote: footerNote ?? existing.footerNote,
          paymentTerms: paymentTerms ?? existing.paymentTerms,
          paymentDueDays: paymentDueDays ?? existing.paymentDueDays,
          deliveryScope: deliveryScope ?? existing.deliveryScope,
          deliveryDays: deliveryDays ?? existing.deliveryDays,
          internalNote: internalNote ?? null,
          tags: tags ?? (existing.tags as string[]),
          version: existing.version + 1,
          parentId: existing.parentId ?? existing.id, // link to root
        },
        select: quotationFullSelect,
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: q.id,
          action: "REVISED",
          performedBy: performerAccountId,
          meta: {
            parentId: id,
            parentNumber: existing.quotationNumber,
            version: q.version,
          },
        },
      });

      return q;
    });

    return sendSuccessResponse(res, 201, "Revised quotation created", revised);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to revise quotation",
    );
  }
}

/* ─────────────────────────────────────────────
   DELETE /admin/quotations/:id
   Soft delete
───────────────────────────────────────────── */


/* ─────────────────────────────────────────────
   DELETE /admin/quotations/:id
   Hard delete
───────────────────────────────────────────── */
export async function deleteQuotationAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;

    if (!performerAccountId) {
      return sendErrorResponse(res, 401, "Invalid session user");
    }

    const { id } = req.params;

    const existing = await prisma.quotation.findUnique({
      where: { id },
      select: { id: true, status: true, quotationNumber: true },
    });

    if (!existing) {
      return sendErrorResponse(res, 404, "Quotation not found");
    }

    if (existing.status === "CONVERTED") {
      return sendErrorResponse(res, 400, "Cannot delete a converted quotation");
    }

    await prisma.quotation.delete({ where: { id } });

    return sendSuccessResponse(res, 200, "Quotation permanently deleted");
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete quotation",
    );
  }
}

/* ─────────────────────────────────────────────
   GET /admin/quotations/:id/activity
───────────────────────────────────────────── */
export async function getQuotationActivityAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const exists = await prisma.quotation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) return sendErrorResponse(res, 404, "Quotation not found");

    const activity = await prisma.quotationActivity.findMany({
      where: { quotationId: id },
      orderBy: { createdAt: "desc" },
      include: {
        performedByAcc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
          },
        },
      },
    });

    return sendSuccessResponse(res, 200, "Activity fetched", activity);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch activity",
    );
  }
}

/* ─────────────────────────────────────────────
   GET /admin/quotations/stats
───────────────────────────────────────────── */
export async function getQuotationStatsAdmin(req: Request, res: Response) {
  try {
    const { fromDate, toDate, createdBy } = req.query as Record<string, string>;

    const where: any = { deletedAt: null };
    if (createdBy) where.createdBy = createdBy;
    if (fromDate || toDate) {
      where.quotationDate = {};
      if (fromDate) where.quotationDate.gte = new Date(fromDate);
      if (toDate) {
        const end = new Date(toDate);
        end.setDate(end.getDate() + 1);
        where.quotationDate.lt = end;
      }
    }

    const grouped = await prisma.quotation.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { grandTotal: true },
    });

    const statuses = [
      "DRAFT",
      "SENT",
      "VIEWED",
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
      "CONVERTED",
      "CANCELLED",
    ];
    const result = statuses.reduce(
      (acc, s) => {
        const row = grouped.find((r) => r.status === s);
        acc[s] = {
          count: row?._count._all ?? 0,
          totalValue: row?._sum.grandTotal ? Number(row._sum.grandTotal) : 0,
        };
        return acc;
      },
      {} as Record<string, { count: number; totalValue: number }>,
    );

    const grandTotal = grouped.reduce(
      (sum, r) => sum + (r._sum.grandTotal ? Number(r._sum.grandTotal) : 0),
      0,
    );
    const totalCount = grouped.reduce((sum, r) => sum + r._count._all, 0);

    return sendSuccessResponse(res, 200, "Quotation stats fetched", {
      byStatus: result,
      total: { count: totalCount, value: grandTotal },
    });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch stats");
  }
}

/* ─────────────────────────────────────────────
   TEMPLATE CRUD
───────────────────────────────────────────── */

export async function createTemplateAdmin(req: Request, res: Response) {
  try {
    const performerAccountId = req.user?.accountId;
    if (!performerAccountId)
      return sendErrorResponse(res, 401, "Invalid session user");

    const {
      name,
      subject,
      introNote,
      termsNote,
      footerNote,
      paymentTerms,
      isDefault,
    } = req.body as Record<string, any>;

    if (!name?.trim())
      return sendErrorResponse(res, 400, "Template name is required");

    // if setting as default, unset others first
    if (isDefault) {
      await prisma.quotationTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const template = await prisma.quotationTemplate.create({
      data: {
        name: name.trim(),
        subject: subject ?? null,
        introNote: introNote ?? null,
        termsNote: termsNote ?? null,
        footerNote: footerNote ?? null,
        paymentTerms: paymentTerms ?? null,
        isDefault: isDefault ?? false,
        createdBy: performerAccountId,
      },
    });

    return sendSuccessResponse(res, 201, "Template created", template);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create template",
    );
  }
}

export async function listTemplatesAdmin(req: Request, res: Response) {
  try {
    const templates = await prisma.quotationTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return sendSuccessResponse(res, 200, "Templates fetched", templates);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch templates",
    );
  }
}

export async function updateTemplateAdmin(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const {
      name,
      subject,
      introNote,
      termsNote,
      footerNote,
      paymentTerms,
      isDefault,
      isActive,
    } = req.body as Record<string, any>;

    if (isDefault) {
      await prisma.quotationTemplate.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const template = await prisma.quotationTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(introNote !== undefined ? { introNote } : {}),
        ...(termsNote !== undefined ? { termsNote } : {}),
        ...(footerNote !== undefined ? { footerNote } : {}),
        ...(paymentTerms !== undefined ? { paymentTerms } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });

    return sendSuccessResponse(res, 200, "Template updated", template);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update template",
    );
  }
}
