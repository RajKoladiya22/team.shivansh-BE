import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { randomUUID } from "crypto";
import { triggerPublicLeadNotification } from "../../services/notifications";
import { buildCustomerProductEntries } from "../../core/utils/leadProducts";

const normalizeMobile = (m: unknown) => String(m ?? "").replace(/\D/g, "");

const ALLOWED_SOURCES = ["WEBSITE", "INQUIRY_FORM", "YOUTUBE"] as const;
type PublicLeadSource = (typeof ALLOWED_SOURCES)[number];

/**
 * POST /public/leads
 * No auth required. Source must be WEBSITE | INQUIRY_FORM | YOUTUBE.
 */
export async function createPublicLead(req: Request, res: Response) {
  try {
    const {
      source,
      customerName,
      mobileNumber,
      customerCompanyName,
      email,
      productTitle,
      cost,
      remark,
      product,
      customerCategory,
      businessCategory,
      state,
      city,
      tallySerial,
      tallyVersion,
    } = req.body as Record<string, any>;

    /* ── Validation ─────────────────────────────── */
    if (!source || !ALLOWED_SOURCES.includes(source)) {
      return sendErrorResponse(
        res,
        400,
        `source must be one of: ${ALLOWED_SOURCES.join(", ")}`,
      );
    }
    if (!customerName?.trim()) {
      return sendErrorResponse(res, 400, "customerName is required");
    }
    if (!mobileNumber) {
      return sendErrorResponse(res, 400, "mobileNumber is required");
    }

    const normalizedMobile = normalizeMobile(mobileNumber);
    if (normalizedMobile.length < 10) {
      return sendErrorResponse(res, 400, "Invalid mobile number");
    }

    /* ── Resolve product ────────────────────────── */
    const resolvedProduct = product
      ? {
        id: product.id || randomUUID(),
        slug: product.slug ?? null,
        link: product.link ?? null,
        title: product.title ?? null,
        cost: product.cost ?? null
      }
      : undefined;

    const resolvedProductTitle = resolvedProduct?.title ?? productTitle ?? null;
    const resolvedCost = resolvedProduct?.cost ?? cost ?? null;

    /* ── Transaction ────────────────────────────── */
    const lead = await prisma.$transaction(async (tx) => {
      // Upsert customer
      let customer = await tx.customer.findUnique({
        where: { normalizedMobile },
      });

      if (customer) {
        const existingProducts: any = customer.products ?? {
          active: [],
          history: [],
        };
        if (!Array.isArray(existingProducts.active))
          existingProducts.active = [];
        if (!Array.isArray(existingProducts.history))
          existingProducts.history = [];

        const productArray = Array.isArray(product)
          ? product
          : product
            ? [product]
            : [];


        if (productArray && productArray.length > 0) {
          for (const entry of buildCustomerProductEntries(productArray)) {
            const alreadyExists = existingProducts.active.some(
              (p: any) => p.id === entry.id || p.name === entry.name,
            );
            if (!alreadyExists) {
              existingProducts.active.push(entry);
            }
          }
        }

        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            name: customerName || customer.name,
            customerCompanyName:
              customerCompanyName || customer.customerCompanyName,
            products: existingProducts,
            ...(customerCategory && { customerCategory }),
            ...(email && { email }),
            ...(businessCategory && { businessCategory }),
            ...(state && { state }),
            ...(city && { city }),
            ...(tallySerial && { tallySerial }),
            ...(tallyVersion && { tallyVersion }),
            updatedAt: new Date(),
          },
        });
      } else {
        const productArray = Array.isArray(product)
          ? product
          : product
            ? [product]
            : [];
        const customerProducts =
          productArray && productArray.length > 0
            ? {
              active: buildCustomerProductEntries(productArray),
              history: [],
            }
            : undefined;
        customer = await tx.customer.create({
          data: {
            name: customerName,
            mobile: mobileNumber,
            email: email ,
            customerCompanyName: customerCompanyName,
            normalizedMobile,
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

      const created = await tx.lead.create({
        data: {
          source: source as PublicLeadSource,
          type: "LEAD",
          customerId: customer.id,
          customerName: customer.name,
          customerCompanyName: customer.customerCompanyName,
          mobileNumber: normalizedMobile,
          product: resolvedProduct,
          productTitle: resolvedProductTitle,
          cost: resolvedCost,
          remark: remark?.trim() || null,
          // No createdBy, no assignment
        },
      });

      await tx.leadActivityLog.create({
        data: {
          leadId: created.id,
          action: "CREATED",
          performedBy: null,
          meta: {
            source,
            type: "LEAD",
            origin: "public_api",
          },
        },
      });

      return created;
    });

    /* ── Notify admins (non-blocking) ───────────── */
    void triggerPublicLeadNotification({ leadId: lead.id, source });

    return sendSuccessResponse(res, 201, "Inquiry submitted successfully", {
      id: lead.id,
    });
  } catch (err: any) {
    console.error("Public lead create error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to submit inquiry",
    );
  }
}
