// src/routes/admin/lead.routes.ts

import { Router } from "express";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../../core/middleware/auth";

import {
  createLeadAdmin,
  assignLeadAdmin,
  updateLeadAdmin,
  closeLeadAdmin,
  listLeadsAdmin,
  getLeadActivityTimelineAdmin,
  getLeadCountByStatusAdmin,
  addLeadHelperAdmin,
  removeLeadHelperAdmin,
} from "../../controller/admin/lead.controller";

const router = Router();

/* ================= LEADS / SUPPORT ================= */

/**
 * Create Lead / Support
 * POST /admin/leads
 */
router.post(
  "/leads",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  createLeadAdmin,
);

/**
 * List Leads (filters: status, source, pagination)
 * GET /admin/leads
 */
router.get(
  "/leads",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  listLeadsAdmin,
);

/**
 * Update Lead (status, remark, product, cost, etc.)
 * PATCH /admin/leads/:id
 */
router.patch(
  "/leads/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  updateLeadAdmin,
);

/**
 * Assign / Reassign Lead
 * POST /admin/leads/:id/assign
 */
router.post(
  "/leads/:id/assign",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  assignLeadAdmin,
);

/**
 * Close Lead (soft close)
 * DELETE /admin/leads/:id
 */
router.delete(
  "/leads/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  closeLeadAdmin,
);

router.get(
  "/leads/:id/activity",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getLeadActivityTimelineAdmin,
);

router.get(
  "/leads/stats/status",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getLeadCountByStatusAdmin,
);


router.post(
  "/leads/:id/helpers",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  addLeadHelperAdmin,
);
router.delete(
  "/leads/:id/helpers/:accountId",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  removeLeadHelperAdmin,
);

export default router;
