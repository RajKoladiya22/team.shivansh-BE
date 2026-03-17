// src/routes/admin/quotation.routes.ts
import { Router } from "express";
import {
  createQuotationAdmin,
  listQuotationsAdmin,
  getQuotationByIdAdmin,
  updateQuotationAdmin,
  sendQuotationAdmin,
  remindQuotationAdmin,
  updateQuotationStatusAdmin,
  reviseQuotationAdmin,
  deleteQuotationAdmin,
  getQuotationActivityAdmin,
  getQuotationStatsAdmin,
  createTemplateAdmin,
  listTemplatesAdmin,
  updateTemplateAdmin,
} from "../../controller/admin/quotation.controller";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../../core/middleware/auth";

const router = Router();

// All admin quotation routes require authentication
router.use(requireAuth, requireRole("ADMIN", "SALES", "MARKETING"));

/* ─────────────────────────────────────────────
   STATS  (before /:id to avoid param collision)
───────────────────────────────────────────── */

/**
 * GET /admin/quotations/stats
 * Aggregate counts + values grouped by status
 * Query: ?fromDate=2024-01-01&toDate=2024-12-31&createdBy=accountId
 */
router.get("/stats", getQuotationStatsAdmin);

/* ─────────────────────────────────────────────
   TEMPLATES
───────────────────────────────────────────── */

/**
 * GET  /admin/quotations/templates      — list all active templates
 * POST /admin/quotations/templates      — create a template
 */
router.get("/templates", listTemplatesAdmin);
router.post("/templates", createTemplateAdmin);

/**
 * PATCH /admin/quotations/templates/:id  — update / toggle default
 */
router.patch("/templates/:id", updateTemplateAdmin);

/* ─────────────────────────────────────────────
   QUOTATION CRUD
───────────────────────────────────────────── */

/**
 * GET  /admin/quotations
 * Query: status, customerId, createdBy, leadId, search, fromDate, toDate, page, limit
 */
router.get("/", listQuotationsAdmin);

/**
 * POST /admin/quotations
 * Body: { customerId, lineItems[], leadId?, templateId?, subject?, validUntil?, ...}
 */
router.post("/", createQuotationAdmin);

/**
 * GET /admin/quotations/:id
 */
router.get("/:id", getQuotationByIdAdmin);

/**
 * PATCH /admin/quotations/:id
 * Update a DRAFT or SENT quotation's content
 * Body: partial — only send changed fields
 */
router.patch("/:id", updateQuotationAdmin);

/**
 * DELETE /admin/quotations/:id
 * Soft delete — sets deletedAt and status=CANCELLED
 */
router.delete("/:id", deleteQuotationAdmin);

/* ─────────────────────────────────────────────
   QUOTATION ACTIONS
───────────────────────────────────────────── */

/**
 * POST /admin/quotations/:id/send
 * Mark as sent + record send history entry
 * Body: { channel?, sentTo?, note? }
 */
router.post("/:id/send", sendQuotationAdmin);

/**
 * POST /admin/quotations/:id/remind
 * Log a follow-up reminder (quotation must be in SENT status)
 * Body: { channel?, sentTo?, note? }
 */
router.post("/:id/remind", remindQuotationAdmin);

/**
 * PATCH /admin/quotations/:id/status
 * Manually update status: ACCEPTED | REJECTED | CANCELLED | CONVERTED | EXPIRED
 * Body: { status, rejectionReason?, acceptedBy?, acceptanceNote? }
 */
router.patch("/:id/status", updateQuotationStatusAdmin);

/**
 * POST /admin/quotations/:id/revise
 * Create a new version of an existing quotation (bumps version, links parentId)
 * Body: partial — only changed fields; inherits everything else from parent
 */
router.post("/:id/revise", reviseQuotationAdmin);

/**
 * GET /admin/quotations/:id/activity
 * Full audit trail for a quotation
 */
router.get("/:id/activity", getQuotationActivityAdmin);

export default router;