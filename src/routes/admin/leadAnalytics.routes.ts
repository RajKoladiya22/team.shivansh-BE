import { Router } from "express";
import { requireAuth, requireRole, requirePermission } from "../../core/middleware/auth";
import { getLeadAnalytics } from "../../controller/admin/leadAnalytics.controller";

const router = Router();

/**
 * Get full lead analytics dashboard data
 * GET /api/admin/analytics/leads
 */
router.get(
  "/leads",
  requireAuth,
  requireRole("ADMIN", "SALES"),
  requirePermission("ALL", "VIEW_LEADS"),
  getLeadAnalytics
);

export default router;
