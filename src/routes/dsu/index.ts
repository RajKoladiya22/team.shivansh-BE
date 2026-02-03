// src/routes/dsu.routes.ts
// Covers BOTH admin + user DSU routes (clean separation via middleware)

import { Router } from "express";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../../core/middleware/auth";

import {
  /* -------- Templates (ADMIN) -------- */
  createDsuTemplate,
  updateDsuTemplate,
  deleteDsuTemplate,
  listDsuTemplates,
  getDsuTemplate,

  /* -------- Entries (USER / ADMIN) -------- */
  createOrSubmitDsu,
  getMyTodayDsu,
  updateDsuEntry,
  deleteDsuEntry,
  getDsuEntry,
  listDsuEntries,

  /* -------- Reports & Analytics (ADMIN) -------- */
  getDailySubmissionCounts,
  getTeamSubmissionCounts,
  getTemplateUsageStats,
  getSubmissionTimeStats,
  exportDsuEntries,
  getMyTeamTemplates,
  getDsuTemplateForUser,
  getAdminDsuReports,
} from "../../controller/dsu/dsu.controller";

const router = Router();

/* ======================================================
   USER DSU (Everyone – once per day)
   ====================================================== */

/**
 * Create / Submit DSU (draft or final)
 * POST /dsu
 */
router.post("/", requireAuth, createOrSubmitDsu);

/**
 * Get my today DSU
 * GET /dsu/me/today
 */
router.get("/me/today", requireAuth, getMyTodayDsu);

/**
 * List DSU entries
 * - user → only own
 * - admin → all
 * GET /dsu
 */
router.get("/", requireAuth, listDsuEntries);

/**
 * Get DSU entry by id
 * GET /dsu/:id
 */
router.get("/:id", requireAuth, getDsuEntry);

/**
 * Update DSU entry
 * PATCH /dsu/:id
 */
router.patch("/:id", requireAuth, updateDsuEntry);

/**
 * Delete DSU entry (soft)
 * DELETE /dsu/:id
 */
router.delete("/:id", requireAuth, deleteDsuEntry);

// Add these routes to your Express router:

router.get("/templates/my-team", requireAuth, getMyTeamTemplates);
router.get("/templates/:id", requireAuth, getDsuTemplateForUser);

/* ======================================================
   ADMIN – DSU TEMPLATES
   ====================================================== */

/**
 * Create DSU template
 * POST /dsu/admin/templates
 */
router.post(
  "/admin/templates",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  createDsuTemplate,
);

/**
 * List DSU templates
 * GET /dsu/admin/templates
 */
router.get(
  "/admin/templates",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  listDsuTemplates,
);

/**
 * Get DSU template (with versions)
 * GET /dsu/admin/templates/:id
 */
router.get(
  "/admin/templates/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getDsuTemplate,
);

/**
 * Update DSU template (creates new version)
 * PATCH /dsu/admin/templates/:id
 */
router.patch(
  "/admin/templates/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  updateDsuTemplate,
);

/**
 * Delete (deactivate) DSU template
 * DELETE /dsu/admin/templates/:id
 */
router.delete(
  "/admin/templates/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  deleteDsuTemplate,
);

/* ======================================================
   ADMIN – REPORTS & ANALYTICS
   ====================================================== */

/**
 * Daily submission count
 * GET /dsu/admin/reports/daily-submissions
 */
router.get(
  "/admin/reports/daily-submissions",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getDailySubmissionCounts,
);

/**
 * Team-wise submission counts
 * GET /dsu/admin/reports/team-submissions
 */
router.get(
  "/admin/reports/team-submissions",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getTeamSubmissionCounts,
);

/**
 * Template usage analytics
 * GET /dsu/admin/reports/template-usage
 */
router.get(
  "/admin/reports/template-usage",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getTemplateUsageStats,
);

/**
 * Submission time analytics (avg/min/max)
 * GET /dsu/admin/reports/submission-time-stats
 */
router.get(
  "/admin/reports/submission-time-stats",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getSubmissionTimeStats,
);

/**
 * Export DSU entries
 * POST /dsu/admin/reports/export
 */
router.post(
  "/admin/reports/export",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  exportDsuEntries,
);


router.get(
  "/admin/reports",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  getAdminDsuReports,
);

export default router;
