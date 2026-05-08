// // src/controller/customer/tnc.controller.ts
// //
// // Three public handlers for the T&C flow:
// //
// //   POST /customers/:id/send-tnc      → admin sends T&C link to customer
// //   GET  /tnc/:token                  → customer page fetches state (accepted or not)
// //   POST /tnc/:token/accept           → customer clicks "Accept" button
// //
// // The Customer table already has:
// //   isTncAccepted   Boolean   @default(false)
// //   tncAcceptedAt   DateTime?
// //   tncToken        String?   @unique


// // Admin → send email
// //         ↓
// // Customer clicks link (/tnc/:token)
// //         ↓
// // Reads T&C → clicks Accept
// //         ↓
// // DB: isTncAccepted = true
// //      tncAcceptedAt = timestamp

// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import {
//     sendErrorResponse,
//     sendSuccessResponse,
// } from "../../core/utils/httpResponse";
// import { generateTncToken } from "../../core/middleware/jwt";
// import { tncEmailHtml, tncEmailText } from "../../core/mailer/tncEmail";
// import { sendMail } from "../../core/mailer";

// // ─── current T&C version (bump this string when your T&C document changes) ────
// const TNC_VERSION = "1.0";
// const FRONTEND_URL = "https://shivanshinfosys.in";

// // ─────────────────────────────────────────────────────────────────────────────
// //  POST /customers/:id/send-tnc
// //  Body (optional): { isReminder?: boolean }
// //
// //  • Generates a fresh token and stores it on the customer row.
// //  • Sends the branded HTML email via the nodemailer transporter.
// //  • Returns { customerId, email, tncLink } so the admin can copy-paste
// //    the link if the customer's email bounces.
// // ─────────────────────────────────────────────────────────────────────────────
// export const sendTncEmail = async (req: Request, res: Response) => {
//     try {
//         if (!req.user?.accountId) {
//             return sendErrorResponse(res, 401, "Unauthorized");
//         }

//         const { id } = req.params;
//         const isReminder = Boolean(req.body?.isReminder);

//         // Fetch customer — we need email + name to compose the mail
//         const customer = await prisma.customer.findUnique({
//             where: { id },
//             select: {
//                 id: true,
//                 name: true,
//                 customerCompanyName: true,
//                 email: true,
//                 isTncAccepted: true,
//             },
//         });

//         if (!customer) {
//             return sendErrorResponse(res, 404, "Customer not found");
//         }

//         if (!customer.email) {
//             return sendErrorResponse(
//                 res,
//                 400,
//                 "Customer has no email address. Add an email before sending the T&C link.",
//             );
//         }

//         // Don't re-send if already accepted (unless explicitly a reminder — edge case)
//         if (customer.isTncAccepted && !isReminder) {
//             return sendErrorResponse(
//                 res,
//                 400,
//                 "Customer has already accepted the T&C. Pass isReminder:true to force resend.",
//             );
//         }

//         // Generate a fresh one-time token and persist it
//         const token = generateTncToken();

//         await prisma.customer.update({
//             where: { id },
//             data: { tncToken: token },
//         });

//         // Build the accept URL that the customer will open
//         const tncLink = `${FRONTEND_URL}/tnc/${token}`;

//         // Compose & send email
//         const html = tncEmailHtml({
//             customerName: customer.name,
//             customerCompanyName: customer.customerCompanyName,
//             acceptUrl: tncLink,
//             tncVersion: TNC_VERSION,
//             isReminder,
//         });

//         const text = tncEmailText({
//             customerName: customer.name,
//             acceptUrl: tncLink,
//             tncVersion: TNC_VERSION,
//             isReminder,
//         });

//         await sendMail(
//             customer.email,
//             isReminder
//                 ? `Reminder: Please accept our Terms & Conditions`
//                 : `Action Required: Accept our Terms & Conditions`,
//             html,
//             text,
//         );

//         return sendSuccessResponse(res, 200, "T&C email sent successfully", {
//             customerId: customer.id,
//             email: customer.email,
//             tncLink, // handy for admin if email bounces
//         });
//     } catch (err: any) {
//         console.error("sendTncEmail error:", err);
//         return sendErrorResponse(
//             res,
//             500,
//             err?.message ?? "Failed to send T&C email",
//         );
//     }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// //  GET /tnc/:token
// //
// //  Called by the customer's browser when they open the T&C page.
// //  Returns just enough info for the front-end to render the page:
// //    • customerName / companyName  → personalise the page header
// //    • isAccepted                  → show "Already accepted" state if true
// //  Does NOT expose any PII like mobile or internal IDs.
// // ─────────────────────────────────────────────────────────────────────────────
// export const getTncByToken = async (req: Request, res: Response) => {
//     try {
//         const { token } = req.params;

//         if (!token) {
//             return res.status(400).json({ message: "Token is required" });
//         }

//         const customer = await prisma.customer.findUnique({
//             where: { tncToken: token },
//             select: {
//                 id: true,
//                 name: true,
//                 customerCompanyName: true,
//                 isTncAccepted: true,
//                 tncAcceptedAt: true,
//             },
//         });

//         if (!customer) {
//             return res.status(404).json({
//                 message: "This link is invalid or has already been used.",
//             });
//         }

//         return res.json({
//             success: true,
//             data: {
//                 customerName: customer.name,
//                 customerCompanyName: customer.customerCompanyName,
//                 isAccepted: customer.isTncAccepted,
//                 acceptedAt: customer.tncAcceptedAt ?? null,
//                 tncVersion: TNC_VERSION,
//             },
//         });
//     } catch (err: any) {
//         console.error("getTncByToken error:", err);
//         return res.status(500).json({ message: "Something went wrong" });
//     }
// };

// // ─────────────────────────────────────────────────────────────────────────────
// //  POST /tnc/:token/accept
// //
// //  Called when the customer clicks "Accept Terms & Conditions".
// //  • Marks isTncAccepted = true with a timestamp.
// //  • Nulls the token so the link cannot be re-used.
// //  Idempotent: if already accepted, returns 200 with a friendly message.
// // ─────────────────────────────────────────────────────────────────────────────
// export const acceptTnc = async (req: Request, res: Response) => {
//     try {
//         const { token } = req.params;

//         if (!token) {
//             return res.status(400).json({ message: "Token is required" });
//         }

//         const customer = await prisma.customer.findUnique({
//             where: { tncToken: token },
//             select: { id: true, isTncAccepted: true, name: true },
//         });

//         if (!customer) {
//             return res.status(404).json({
//                 message: "This link is invalid or has already been used.",
//             });
//         }

//         // Idempotent — don't error, just inform
//         if (customer.isTncAccepted) {
//             return res.json({
//                 success: true,
//                 message: "Terms & Conditions were already accepted.",
//                 alreadyAccepted: true,
//             });
//         }

//         await prisma.customer.update({
//             where: { id: customer.id },
//             data: {
//                 isTncAccepted: true,
//                 tncAcceptedAt: new Date(),
//                 tncToken: null, // invalidate — one-time use
//             },
//         });

//         return res.json({
//             success: true,
//             message: "Thank you! Terms & Conditions accepted successfully.",
//             alreadyAccepted: false,
//         });
//     } catch (err: any) {
//         console.error("acceptTnc error:", err);
//         return res.status(500).json({ message: "Something went wrong" });
//     }
// };



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