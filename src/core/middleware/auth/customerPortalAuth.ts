// src/core/middleware/auth/customerPortalAuth.ts

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../../../config/database.config";

declare global {
  namespace Express {
    interface Request {
      customer?: any;
      customerToken?: any;
    }
  }
}

/**
 * Middleware to authenticate requests to /api/v1/public/portal/*
 * Expects token in:
 * - Header: X-Customer-Token
 * - Header: Authorization (Bearer <token>)
 * - Query param: ?token=<token>
 */
export async function verifyCustomerPortalToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    let rawToken: string | undefined;

    // 1. Check X-Customer-Token header
    const customHeader = req.headers["x-customer-token"];
    if (typeof customHeader === "string" && customHeader.trim()) {
      rawToken = customHeader.trim();
    }

    // 2. Check Authorization header
    if (!rawToken) {
      const authHeader = req.headers["authorization"] || req.headers["Authorization"];
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        rawToken = authHeader.split(" ")[1].trim();
      }
    }

    // 3. Check query param
    if (!rawToken && typeof req.query.token === "string" && req.query.token.trim()) {
      rawToken = req.query.token.trim();
    }

    if (!rawToken) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Customer access token is required",
      });
    }

    // Hash token with SHA-256 for secure database lookup
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // Look up token in DB
    const portalToken = await prisma.customerPortalToken.findUnique({
      where: { tokenHash },
      include: {
        customer: true,
      },
    });

    if (!portalToken || !portalToken.isActive || !portalToken.customer.isActive) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid or inactive customer access link",
      });
    }

    // Check expiration if set
    if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Access link has expired. Please contact support.",
      });
    }

    // Attach customer and token metadata to request
    req.customer = portalToken.customer;
    req.customerToken = portalToken;

    // Asynchronously update lastAccessedAt and accessCount
    prisma.customerPortalToken
      .update({
        where: { id: portalToken.id },
        data: {
          lastAccessedAt: new Date(),
          accessCount: { increment: 1 },
        },
      })
      .catch((err) => console.error("Error updating portal token metadata:", err));

    return next();
  } catch (error) {
    console.error("[CustomerPortalAuth] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during portal authentication",
    });
  }
}

/**
 * Helper to log portal audit events
 */
export async function logCustomerPortalAudit(
  customerId: string,
  action: string,
  req: Request,
  meta?: any
) {
  try {
    const ipAddress =
      (req.headers["x-forwarded-for"] as string) ||
      req.socket.remoteAddress ||
      undefined;
    const userAgent = req.headers["user-agent"] || undefined;

    await prisma.customerPortalAuditLog.create({
      data: {
        customerId,
        action,
        ipAddress,
        userAgent,
        meta: meta || undefined,
      },
    });
  } catch (err) {
    console.error("Failed to log customer portal audit:", err);
  }
}
