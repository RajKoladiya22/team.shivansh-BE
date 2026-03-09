// src/routes/public/quotation.public.routes.ts
//
// These routes are mounted under /api/v1/public — NO authentication middleware.
// Rate limiting is recommended in production (e.g. express-rate-limit).

import { Router } from "express";
import {
  getPublicQuotation,
  acceptPublicQuotation,
  rejectPublicQuotation,
  queryPublicQuotation,
} from "../../controller/public/quotation.public.controller";

const router = Router();

/**
 * GET /api/v1/public/quotations/:token
 *
 * Customer views their quotation (no login required).
 * - :token is the quotation's `id` (cuid) — embed it in the share link.
 * - Automatically marks the quotation as VIEWED on first open.
 * - Automatically marks it EXPIRED if validUntil has passed.
 *
 * Share link format:
 *   https://app.shivanshinfosys.in/quotation/:token
 *   → frontend fetches GET /api/v1/public/quotations/:token
 *
 * Response: { quotation, isExpired, canRespond }
 */
router.get("/:token", getPublicQuotation);

/**
 * POST /api/v1/public/quotations/:token/accept
 *
 * Customer accepts the quotation.
 * Body (all optional):
 *   { acceptedBy: "Rajan Mehta", acceptanceNote: "Please proceed with GST invoice" }
 *
 * Restrictions:
 *   - Cannot accept if already ACCEPTED / REJECTED / CANCELLED / CONVERTED / EXPIRED
 *   - Cannot accept if validUntil has passed
 */
router.post("/:token/accept", acceptPublicQuotation);

/**
 * POST /api/v1/public/quotations/:token/reject
 *
 * Customer rejects the quotation.
 * Body (optional):
 *   { rejectionReason: "Budget constraints for now" }
 */
router.post("/:token/reject", rejectPublicQuotation);

/**
 * POST /api/v1/public/quotations/:token/query
 *
 * Customer sends a question about the quotation.
 * Stored as a QuotationActivity NOTE_ADDED entry.
 * Body:
 *   { name?: string, contactNumber?: string, message: string (required) }
 */
router.post("/:token/query", queryPublicQuotation);

export default router;