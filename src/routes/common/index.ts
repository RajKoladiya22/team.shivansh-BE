// src/routes/admin/lead.routes.ts

import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { getEmployeeById, listEmployees } from "../../controller/common/employee.controller";
import { getCommonTeamById, listCommonTeams } from "../../controller/common/team.controller";

const router = Router();

/* ================= LEADS / SUPPORT ================= */

/**
 * Create Lead / Support
 * GET /employees
 */
router.get("/employees", requireAuth, listEmployees);
router.get("/employees/:id", requireAuth, getEmployeeById);


router.get("/teams", requireAuth, listCommonTeams);
router.get("/teams/:id", requireAuth, getCommonTeamById);

export default router;
