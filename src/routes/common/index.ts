// src/routes/admin/lead.routes.ts

import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { listEmployees } from "../../controller/common/employee.controller";

const router = Router();

/* ================= LEADS / SUPPORT ================= */

/**
 * Create Lead / Support
 * GET /employees
 */
router.get("/employees", requireAuth, listEmployees);

export default router;
