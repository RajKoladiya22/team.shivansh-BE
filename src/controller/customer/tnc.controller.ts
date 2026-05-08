// src/controller/customer/tnc.controller.ts
//
// Four handlers for the T&C / onboarding flow:
//
//   POST /customers/:id/send-tnc          → admin sends onboarding email
//   GET  /tnc/:token                      → customer review page (fetch state)
//   POST /tnc/:token/accept               → customer clicks "Accept" on review page
//   GET  /tnc/:token/accept-redirect      → one-click accept in email → redirect to homepage
//
// Customer model fields used:
//   isTncAccepted   Boolean   @default(false)
//   tncAcceptedAt   DateTime?
//   tncToken        String?   @unique
//   (plus name, customerCompanyName, email, mobile, city, state,
//    joiningDate, customerCategory, businessCategory, products)

import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
    sendErrorResponse,
    sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { generateTncToken } from "../../core/middleware/jwt";
import { tncEmailHtml, tncEmailText } from "../../core/mailer/tncEmail";
import { sendMail } from "../../core/mailer";

const TNC_VERSION = "1.0";
const FRONTEND_URL = "https://shivanshinfosys.in";
const BACKEND_URL = "https://teamapi.shivanshinfosys.in";

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: extract product display names from the JSON field
// ─────────────────────────────────────────────────────────────────────────────
function parseProductNames(products: unknown): string[] {
    if (!products || !Array.isArray(products)) return [];
    return products
        .map((p: any) => p?.name ?? p?.productName ?? String(p))
        .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /customers/:id/send-tnc
//  Body (optional): { isReminder?: boolean }
//
//  Sends a branded onboarding email with:
//    • Customer's basic details (name, mobile, city, category, products …)
//    • Two CTAs:
//        1. directAcceptUrl  → GET /tnc/:token/accept-redirect  (one-click, then redirect)
//        2. acceptUrl        → opens review page (/tnc/:token)
// ─────────────────────────────────────────────────────────────────────────────
export const sendTncEmail = async (req: Request, res: Response) => {
    try {
        if (!req.user?.accountId) {
            return sendErrorResponse(res, 401, "Unauthorized");
        }

        const { id } = req.params;
        const isReminder = Boolean(req.body?.isReminder);

        const customer = await prisma.customer.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                customerCompanyName: true,
                contactPerson: true,
                email: true,
                mobile: true,
                city: true,
                state: true,
                joiningDate: true,
                customerCategory: true,
                businessCategory: true,
                products: true,
                isTncAccepted: true,
            },
        });

        if (!customer) {
            return sendErrorResponse(res, 404, "Customer not found");
        }

        if (!customer.email) {
            return sendErrorResponse(
                res,
                400,
                "Customer has no email address. Add an email before sending the onboarding mail.",
            );
        }

        if (customer.isTncAccepted && !isReminder) {
            return sendErrorResponse(
                res,
                400,
                "Customer has already accepted the T&C. Pass isReminder:true to force resend.",
            );
        }

        // Fresh one-time token
        const token = generateTncToken();

        await prisma.customer.update({
            where: { id },
            data: { tncToken: token },
        });

        // Two distinct links
        const acceptUrl = `${FRONTEND_URL}/tnc/${token}`;            // review page
        const directAcceptUrl = `${BACKEND_URL}/api/v1/public/tnc/${token}/accept-redirect`; // one-click

        const productNames = parseProductNames(customer.products);

        const html = tncEmailHtml({
            customerName: customer.name,
            customerCompanyName: customer.customerCompanyName,
            contactPerson: customer.contactPerson,
            mobile: customer.mobile,
            city: customer.city,
            state: customer.state,
            joiningDate: customer.joiningDate?.toISOString() ?? null,
            customerCategory: customer.customerCategory,
            businessCategory: customer.businessCategory,
            products: productNames.length ? productNames : null,
            acceptUrl,
            directAcceptUrl,
            tncVersion: TNC_VERSION,
            isReminder,
        });

        const text = tncEmailText({
            customerName: customer.name,
            customerCompanyName: customer.customerCompanyName,
            mobile: customer.mobile,
            city: customer.city,
            state: customer.state,
            joiningDate: customer.joiningDate?.toISOString() ?? null,
            customerCategory: customer.customerCategory,
            businessCategory: customer.businessCategory,
            products: productNames.length ? productNames : null,
            acceptUrl,
            directAcceptUrl,
            tncVersion: TNC_VERSION,
            isReminder,
        });

        await sendMail(
            customer.email,
            isReminder
                ? `Reminder: Action Required — Accept T&C to Activate Your Account`
                : `Welcome to Shivansh Infosys — Activate Your Account`,
            html,
            text,
        );

        return sendSuccessResponse(res, 200, "Onboarding email sent successfully", {
            customerId: customer.id,
            email: customer.email,
            acceptUrl,
            directAcceptUrl,
        });
    } catch (err: any) {
        console.error("sendTncEmail error:", err);
        return sendErrorResponse(
            res,
            500,
            err?.message ?? "Failed to send onboarding email",
        );
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET /tnc/:token
//
//  Customer review page fetches state.
//  Returns: customerName, customerCompanyName, isAccepted, acceptedAt, tncVersion
// ─────────────────────────────────────────────────────────────────────────────
export const getTncByToken = async (req: Request, res: Response) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({ message: "Token is required" });
        }

        const customer = await prisma.customer.findUnique({
            where: { tncToken: token },
            select: {
                id: true,
                name: true,
                customerCompanyName: true,
                isTncAccepted: true,
                tncAcceptedAt: true,
            },
        });

        if (!customer) {
            return res.status(404).json({
                message: "This link is invalid or has already been used.",
            });
        }

        return res.json({
            success: true,
            data: {
                customerName: customer.name,
                customerCompanyName: customer.customerCompanyName,
                isAccepted: customer.isTncAccepted,
                acceptedAt: customer.tncAcceptedAt ?? null,
                tncVersion: TNC_VERSION,
            },
        });
    } catch (err: any) {
        console.error("getTncByToken error:", err);
        return res.status(500).json({ message: "Something went wrong" });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST /tnc/:token/accept
//
//  Called when customer clicks "Accept" on the review page.
//  Marks isTncAccepted = true, nulls the token (one-time use).
//  Idempotent.
// ─────────────────────────────────────────────────────────────────────────────
export const acceptTnc = async (req: Request, res: Response) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({ message: "Token is required" });
        }

        const customer = await prisma.customer.findUnique({
            where: { tncToken: token },
            select: { id: true, isTncAccepted: true, name: true },
        });

        if (!customer) {
            return res.status(404).json({
                message: "This link is invalid or has already been used.",
            });
        }

        if (customer.isTncAccepted) {
            return res.json({
                success: true,
                message: "Terms & Conditions were already accepted.",
                alreadyAccepted: true,
            });
        }

        await prisma.customer.update({
            where: { id: customer.id },
            data: {
                isTncAccepted: true,
                tncAcceptedAt: new Date(),
                tncToken: null,
            },
        });

        return res.json({
            success: true,
            message: "Thank you! Terms & Conditions accepted successfully.",
            alreadyAccepted: false,
        });
    } catch (err: any) {
        console.error("acceptTnc error:", err);
        return res.status(500).json({ message: "Something went wrong" });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET /tnc/:token/accept-redirect
//
//  One-click accept triggered directly from the email button.
//  • Accepts T&C in the DB (same logic as acceptTnc).
//  • Redirects the customer's browser to the homepage.
//
//  Use a GET so that email clients can pre-fetch / open it without a form.
// ─────────────────────────────────────────────────────────────────────────────
export const acceptTncAndRedirect = async (req: Request, res: Response) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.redirect(`${FRONTEND_URL}/tnc?tnc=invalid`);
        }

        const customer = await prisma.customer.findUnique({
            where: { tncToken: token },
            select: { id: true, isTncAccepted: true },
        });

        if (!customer) {
            // Link already used or invalid — still redirect gracefully
            return res.redirect(`${FRONTEND_URL}/tnc?tnc=already-accepted`);
        }

        if (!customer.isTncAccepted) {
            await prisma.customer.update({
                where: { id: customer.id },
                data: {
                    isTncAccepted: true,
                    tncAcceptedAt: new Date(),
                    tncToken: null,
                },
            });
        }

        // Redirect to homepage with a success query so the frontend can show a toast
        return res.redirect(`${FRONTEND_URL}/tnc?tnc=accepted`);
    } catch (err: any) {
        console.error("acceptTncAndRedirect error:", err);
        return res.redirect(`${FRONTEND_URL}/tnc?tnc=error`);
    }
};