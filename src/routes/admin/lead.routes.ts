// // src/routes/admin/lead.routes.ts
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
  getLeadByIdAdmin,
  deleteLeadPermanentAdmin,
} from "../../controller/admin/lead.controller";

const router = Router();

/* ================= LEADS / SUPPORT ================= */

/**
 * Create Lead / Support
 * POST /admin/leads
 */
// router.post(
//   "/leads",
//   requireAuth,
//   requireRole("SALES", "ADMIN"),
//   requirePermission("ALL", "VIEW_LEADS"),
//   createLeadAdmin,
// );

// /**
//  * List Leads
//  * GET /admin/leads
//  */
// router.get(
//   "/leads",
//   requireAuth,
//   requireRole("SALES", "ADMIN"),
//   requirePermission("ALL", "VIEW_LEADS"),
//   listLeadsAdmin,
// );

router
  .route("/leads")
  .post(
    requireAuth,
    requireRole("ADMIN"),
    requirePermission("ALL"),
    createLeadAdmin,
  )
  .get(
    requireAuth,
    requireRole("SALES", "ADMIN"),
    requirePermission("ALL", "VIEW_LEADS"),
    listLeadsAdmin,
  );

/* ================= STATIC ROUTES (MUST COME FIRST) ================= */

/**
 * Lead Status Stats
 * GET /admin/leads/stats/status
 */
router.get(
  "/leads/stats/status",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  getLeadCountByStatusAdmin,
);

/**
 * Lead Activity Timeline
 * GET /admin/leads/:id/activity
 */
router.get(
  "/leads/:id/activity",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  getLeadActivityTimelineAdmin,
);

/* ================= DYNAMIC :id ROUTES ================= */

/**
 * Get Lead Details
 * GET /admin/leads/:id
 */
router.get(
  "/leads/:id",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  getLeadByIdAdmin,
);

/**
 * Update Lead
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
 * Close Lead (soft delete)
 * DELETE /admin/leads/:id
 */
router.delete(
  "/leads/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  closeLeadAdmin,
);

/**
 * Permanent Delete
 * DELETE /admin/leads/:id/permanent
 */
router.delete(
  "/leads/:id/permanent",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  deleteLeadPermanentAdmin,
);

/**
 * Add Helper
 * POST /admin/leads/:id/helpers
 */
router.post(
  "/leads/:id/helpers",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  addLeadHelperAdmin,
);

/**
 * Remove Helper
 * DELETE /admin/leads/:id/helpers/:accountId
 */
router.delete(
  "/leads/:id/helpers/:accountId",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  removeLeadHelperAdmin,
);

export default router;
