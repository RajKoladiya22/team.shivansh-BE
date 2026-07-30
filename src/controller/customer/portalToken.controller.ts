// src/controller/customer/portalToken.controller.ts

import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../config/database.config";

/**
 * POST /api/v1/customers/:id/portal-token
 * Internal CRM endpoint for generating a long secure access token for a customer.
 * Returns the unhashed token URL to the CRM staff to copy/send.
 */
export async function generateCustomerPortalToken(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { label, expiresInDays } = req.body;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    // Generate 64-character hex secret token (256-bit entropy)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    let expiresAt: Date | undefined = undefined;
    if (expiresInDays && typeof expiresInDays === "number") {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const portalToken = await prisma.customerPortalToken.create({
      data: {
        customerId: id,
        tokenHash,
        label: label?.trim() || "Portal Direct Access Link",
        expiresAt,
      },
    });

    const portalBaseUrl = process.env.CUSTOMER_PORTAL_URL || "https://customer.shivanshinfosys.in";
    const portalUrl = `${portalBaseUrl}/portal?token=${rawToken}`;

    return res.status(201).json({
      success: true,
      message: "Customer Portal access token generated",
      data: {
        id: portalToken.id,
        label: portalToken.label,
        portalUrl,
        rawToken,
        createdAt: portalToken.createdAt,
        expiresAt: portalToken.expiresAt,
      },
    });
  } catch (error: any) {
    console.error("[generateCustomerPortalToken] Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to generate portal token" });
  }
}

/**
 * GET /api/v1/customers/:id/portal-tokens
 * Internal CRM endpoint to list active portal tokens and access stats for a customer.
 */
export async function listCustomerPortalTokens(req: Request, res: Response) {
  try {
    const { id } = req.params;

    const tokens = await prisma.customerPortalToken.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        isActive: true,
        accessCount: true,
        lastAccessedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return res.json({
      success: true,
      data: tokens,
    });
  } catch (error: any) {
    console.error("[listCustomerPortalTokens] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to list portal tokens" });
  }
}

/**
 * PATCH /api/v1/customers/:id/portal-tokens/:tokenId/revoke
 * Revoke/Deactivate a customer portal token.
 */
export async function revokeCustomerPortalToken(req: Request, res: Response) {
  try {
    const { id, tokenId } = req.params;

    const updated = await prisma.customerPortalToken.updateMany({
      where: { id: tokenId, customerId: id },
      data: { isActive: false },
    });

    return res.json({
      success: true,
      message: "Portal token revoked successfully",
      data: updated,
    });
  } catch (error: any) {
    console.error("[revokeCustomerPortalToken] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to revoke token" });
  }
}
