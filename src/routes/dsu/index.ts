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
} from "../../controller/dsu/dsu.controller";

const router = Router();

/* ======================================================
   USER DSU (Everyone – once per day)
   ====================================================== */

/**
 * Create / Submit DSU (draft or final)
 * POST /dsu
 */
router.post(
  "/",
  requireAuth,
  createOrSubmitDsu,
);

/**
 * Get my today DSU
 * GET /dsu/me/today
 */
router.get(
  "/me/today",
  requireAuth,
  getMyTodayDsu,
);

/**
 * List DSU entries
 * - user → only own
 * - admin → all
 * GET /dsu
 */
router.get(
  "/",
  requireAuth,
  listDsuEntries,
);

/**
 * Get DSU entry by id
 * GET /dsu/:id
 */
router.get(
  "/:id",
  requireAuth,
  requirePermission("DSU_READ"),
  getDsuEntry,
);

/**
 * Update DSU entry
 * PATCH /dsu/:id
 */
router.patch(
  "/:id",
  requireAuth,
  updateDsuEntry,
);

/**
 * Delete DSU entry (soft)
 * DELETE /dsu/:id
 */
router.delete(
  "/:id",
  requireAuth,
  deleteDsuEntry,
);

/* ======================================================
   ADMIN – DSU TEMPLATES
   ====================================================== */

/**
 * Create DSU template
 * POST /admin/dsu/templates
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
 * GET /admin/dsu/templates
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
 * GET /admin/dsu/templates/:id
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
 * PATCH /admin/dsu/templates/:id
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
 * DELETE /admin/dsu/templates/:id
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
 * GET /admin/dsu/reports/daily-submissions
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
 * GET /admin/dsu/reports/team-submissions
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
 * GET /admin/dsu/reports/template-usage
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
 * GET /admin/dsu/reports/submission-time-stats
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
 * POST /admin/dsu/reports/export
 */
router.post(
  "/admin/reports/export",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  exportDsuEntries,
);

export default router;
