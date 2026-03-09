// src/controller/public/quotation.public.controller.ts
//
// All routes here are PUBLIC — no authentication middleware.
// Customers access their quotation via a short token embedded in the share link.
// e.g.  GET /api/v1/public/quotations/:token
//
// The token IS the quotation's `id` (cuid).
// If you want more security, swap it for a separate signed token field
// on the Quotation model (e.g. `shareToken String @unique @default(cuid())`).

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { isQuotationExpired } from "../../services/quotation";

/* ─────────────────────────────────────────────
   Public select — strips internal-only fields
   (internalNote, createdBy details, etc.)
───────────────────────────────────────────── */
const publicQuotationSelect = {
  id: true,
  quotationNumber: true,
  status: true,
  customerSnapshot: true,
  lineItems: true,
  subtotal: true,
  totalDiscount: true,
  totalTax: true,
  grandTotal: true,
  currency: true,
  extraDiscountType: true,
  extraDiscountValue: true,
  extraDiscountNote: true,
  taxType: true,
  gstin: true,
  customerGstin: true,
  placeOfSupply: true,
  quotationDate: true,
  validUntil: true,
  sentAt: true,
  viewedAt: true,
  respondedAt: true,
  subject: true,
  introNote: true,
  termsNote: true,
  footerNote: true,
  paymentTerms: true,
  paymentDueDays: true,
  deliveryScope: true,
  deliveryDays: true,
  version: true,
  acceptedBy: true,
  acceptanceNote: true,
  rejectionReason: true,
  createdAt: true,
  // Prepared by — show name + contact so customer knows who to call
  preparedByAcc: {
    select: {
      firstName: true,
      lastName: true,
      designation: true,
      contactPhone: true,
    },
  },
  createdByAcc: {
    select: {
      firstName: true,
      lastName: true,
      designation: true,
      contactPhone: true,
    },
  },
};

/* ─────────────────────────────────────────────
   GET /api/v1/public/quotations/:token
   Customer views their quotation (no login)
   Marks as VIEWED on first open
───────────────────────────────────────────── */
export async function getPublicQuotation(req: Request, res: Response) {
  try {
    const { token } = req.params; // token = quotation id (or shareToken if added)

    if (!token?.trim())
      return sendErrorResponse(res, 400, "Invalid quotation link");

    const quotation = await prisma.quotation.findFirst({
      where: {
        id: token,
        deletedAt: null,
      },
      select: {
        ...publicQuotationSelect,
        // need these internally to decide whether to mark VIEWED
        status: true,
        viewedAt: true,
        validUntil: true,
      },
    });

    if (!quotation)
      return sendErrorResponse(res, 404, "Quotation not found or link is invalid");

    // auto-expire check — return expired status but still show the document
    const expired = isQuotationExpired(quotation.validUntil);

    // mark as VIEWED the first time a customer opens it
    if (!quotation.viewedAt && quotation.status === "SENT") {
      await prisma.$transaction(async (tx) => {
        await tx.quotation.update({
          where: { id: token },
          data: {
            viewedAt: new Date(),
            status: expired ? "EXPIRED" : "VIEWED",
          },
        });

        await tx.quotationActivity.create({
          data: {
            quotationId: token,
            action: expired ? "EXPIRED" : "VIEWED",
            performedBy: null, // system / customer, no account
            meta: {
              ip: req.ip ?? null,
              userAgent: req.headers["user-agent"] ?? null,
              expired,
            },
          },
        });
      });

      // reflect the change in response
      (quotation as any).viewedAt = new Date().toISOString();
      if (!expired) (quotation as any).status = "VIEWED";
      else (quotation as any).status = "EXPIRED";
    }

    // if already viewed but now expired, auto-flip status
    if (
      expired &&
      quotation.status !== "EXPIRED" &&
      quotation.status !== "ACCEPTED" &&
      quotation.status !== "REJECTED" &&
      quotation.status !== "CONVERTED" &&
      quotation.status !== "CANCELLED"
    ) {
      await prisma.quotation.update({
        where: { id: token },
        data: { status: "EXPIRED" },
      });
      (quotation as any).status = "EXPIRED";
    }

    return sendSuccessResponse(res, 200, "Quotation fetched", {
      quotation,
      isExpired: expired,
      canRespond:
        !expired &&
        ["SENT", "VIEWED"].includes((quotation as any).status),
    });
  } catch (err: any) {
    console.error("Public get quotation error:", err);
    return sendErrorResponse(res, 500, "Failed to fetch quotation");
  }
}

/* ─────────────────────────────────────────────
   POST /api/v1/public/quotations/:token/accept
   Customer accepts the quotation
───────────────────────────────────────────── */
export async function acceptPublicQuotation(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const { acceptedBy, acceptanceNote } = req.body as Record<string, string>;

    const quotation = await prisma.quotation.findFirst({
      where: { id: token, deletedAt: null },
      select: {
        id: true,
        status: true,
        validUntil: true,
        quotationNumber: true,
        grandTotal: true,
      },
    });

    if (!quotation)
      return sendErrorResponse(res, 404, "Quotation not found or link is invalid");

    if (isQuotationExpired(quotation.validUntil)) {
      await prisma.quotation.update({
        where: { id: token },
        data: { status: "EXPIRED" },
      });
      return sendErrorResponse(res, 410, "This quotation has expired and can no longer be accepted");
    }

    const notRespondable = ["ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED", "EXPIRED"];
    if (notRespondable.includes(quotation.status)) {
      return sendErrorResponse(
        res,
        400,
        `Quotation is already ${quotation.status.toLowerCase()} and cannot be accepted`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id: token },
        data: {
          status: "ACCEPTED",
          respondedAt: new Date(),
          acceptedBy: acceptedBy?.trim() || null,
          acceptanceNote: acceptanceNote?.trim() || null,
        },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          grandTotal: true,
          respondedAt: true,
          acceptedBy: true,
          acceptanceNote: true,
        },
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: token,
          action: "ACCEPTED",
          performedBy: null,
          meta: {
            acceptedBy: acceptedBy ?? null,
            acceptanceNote: acceptanceNote ?? null,
            ip: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          },
        },
      });

      return q;
    });

    return sendSuccessResponse(res, 200, "Quotation accepted successfully! Our team will be in touch shortly.", updated);
  } catch (err: any) {
    console.error("Public accept quotation error:", err);
    return sendErrorResponse(res, 500, "Failed to accept quotation");
  }
}

/* ─────────────────────────────────────────────
   POST /api/v1/public/quotations/:token/reject
   Customer rejects the quotation
───────────────────────────────────────────── */
export async function rejectPublicQuotation(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const { rejectionReason } = req.body as Record<string, string>;

    const quotation = await prisma.quotation.findFirst({
      where: { id: token, deletedAt: null },
      select: {
        id: true,
        status: true,
        validUntil: true,
        quotationNumber: true,
      },
    });

    if (!quotation)
      return sendErrorResponse(res, 404, "Quotation not found or link is invalid");

    if (isQuotationExpired(quotation.validUntil)) {
      return sendErrorResponse(res, 410, "This quotation has already expired");
    }

    const notRespondable = ["ACCEPTED", "REJECTED", "CANCELLED", "CONVERTED", "EXPIRED"];
    if (notRespondable.includes(quotation.status)) {
      return sendErrorResponse(
        res,
        400,
        `Quotation is already ${quotation.status.toLowerCase()}`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id: token },
        data: {
          status: "REJECTED",
          respondedAt: new Date(),
          rejectionReason: rejectionReason?.trim() || null,
        },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          respondedAt: true,
          rejectionReason: true,
        },
      });

      await tx.quotationActivity.create({
        data: {
          quotationId: token,
          action: "REJECTED",
          performedBy: null,
          meta: {
            rejectionReason: rejectionReason ?? null,
            ip: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          },
        },
      });

      return q;
    });

    return sendSuccessResponse(res, 200, "Response recorded. Thank you for letting us know.", updated);
  } catch (err: any) {
    console.error("Public reject quotation error:", err);
    return sendErrorResponse(res, 500, "Failed to record response");
  }
}

/* ─────────────────────────────────────────────
   POST /api/v1/public/quotations/:token/query
   Customer asks a question about the quotation
   (stored as activity log, no extra table needed)
───────────────────────────────────────────── */
export async function queryPublicQuotation(req: Request, res: Response) {
  try {
    const { token } = req.params;
    const { name, message, contactNumber } = req.body as Record<string, string>;

    if (!message?.trim())
      return sendErrorResponse(res, 400, "Message is required");

    const quotation = await prisma.quotation.findFirst({
      where: { id: token, deletedAt: null },
      select: { id: true, status: true, quotationNumber: true },
    });

    if (!quotation)
      return sendErrorResponse(res, 404, "Quotation not found or link is invalid");

    if (["CANCELLED", "CONVERTED"].includes(quotation.status))
      return sendErrorResponse(res, 400, "This quotation is no longer active");

    await prisma.quotationActivity.create({
      data: {
        quotationId: token,
        action: "NOTE_ADDED",
        performedBy: null,
        meta: {
          type: "CUSTOMER_QUERY",
          name: name?.trim() ?? null,
          contactNumber: contactNumber?.trim() ?? null,
          message: message.trim(),
          ip: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        },
      },
    });

    return sendSuccessResponse(
      res,
      200,
      "Your query has been submitted. Our team will respond shortly.",
      { quotationNumber: quotation.quotationNumber },
    );
  } catch (err: any) {
    console.error("Public query quotation error:", err);
    return sendErrorResponse(res, 500, "Failed to submit query");
  }
}