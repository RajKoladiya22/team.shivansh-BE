// src/routes/adminExpertise.routes.ts
// Mount under: /api/v1/admin/expertise/tdl

import { Router } from "express";
import {
    adminGetEmployeeExpertiseList,
    adminGetEmployeeExpertiseDetail,
    adminGetProductCoverageOverview,
} from "../../controller/expertise/admin.expertise.controller";
import { requireAuth } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth);

// router.use(requireAdmin); // ← uncomment to protect all routes below

/**
 * GET /expertise/tdl/admin/employees
 *
 * List all employees with their expertise summary.
 * Query: search, expertiseLevel, minProducts, sortBy, sortOrder, page, limit
 */
router.get("/employees", adminGetEmployeeExpertiseList);

/**
 * GET /expertise/tdl/admin/employees/:employeeId
 *
 * Full expertise breakdown for one employee —
 * every product they've marked, stats, skills, certs, notes.
 * Query: expertiseLevel, sortBy, sortOrder
 */
router.get("/employees/:employeeId", adminGetEmployeeExpertiseDetail);

/**
 * GET /expertise/tdl/admin/products
 *
 * Per-product coverage: how many employees marked each product
 * and at what level. Great for spotting skill gaps.
 * Query: search, needsCoverage, categorySlug, sortBy, sortOrder, page, limit
 */
router.get("/products", adminGetProductCoverageOverview);

export default router;