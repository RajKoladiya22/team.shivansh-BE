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
  updateLeadCustomerAdmin,
  updateLeadProductAdmin,
  getLeadValueStatsAdmin,
  addLeadProductsAdmin,
  createFollowUp,
  updateFollowUp,
  getLeadFollowUps,
  listFollowUps,
  deleteFollowUp,
  sendLeadReminder,
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

router.patch("/leads/:id/product", requireAuth, updateLeadProductAdmin);

router
  .route("/leads")
  .post(
    requireAuth,
    requireRole("SALES", "ADMIN"),
    requirePermission("ALL", "VIEW_LEADS"),
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
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  updateLeadAdmin,
);

/**
 * Assign / Reassign Lead
 * POST /admin/leads/:id/assign
 */
router.post(
  "/leads/:id/assign",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  assignLeadAdmin,
);

/**
 * Close Lead (soft delete)
 * DELETE /admin/leads/:id
 */
router.delete(
  "/leads/:id",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  closeLeadAdmin,
);

/**
 * Permanent Delete
 * DELETE /admin/leads/:id/permanent
 */
router.delete(
  "/leads/:id/permanent",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  deleteLeadPermanentAdmin,
);

/**
 * Add Helper
 * POST /admin/leads/:id/helpers
 */
router.post(
  "/leads/:id/helpers",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  addLeadHelperAdmin,
);

/**
 * Remove Helper
 * DELETE /admin/leads/:id/helpers/:accountId
 */
router.delete(
  "/leads/:id/helpers/:accountId",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  removeLeadHelperAdmin,
);

router.patch("/leads/:id/customer", requireAuth, updateLeadCustomerAdmin);

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

router.get("/leads/stats/value", requireAuth, getLeadValueStatsAdmin);

router.post("/leads/:id/products", requireAuth, addLeadProductsAdmin);


router.post("/leads/:leadId/follow-ups", requireAuth, createFollowUp);
router.patch("/leads/:leadId/follow-ups/:id", requireAuth, updateFollowUp);
router.get("/leads/:leadId/follow-ups", requireAuth, getLeadFollowUps);
router.get("/leads/follow-ups", requireAuth, listFollowUps);
router.delete("/leads/:leadId/follow-ups/:id", requireAuth, deleteFollowUp);

router.post("/:leadId/remind", requireAuth, requireRole("ADMIN", "SALES"), sendLeadReminder);

export default router;
