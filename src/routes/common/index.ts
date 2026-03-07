// src/routes/common/index.ts

import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { getEmployeeById, listEmployees } from "../../controller/common/employee.controller";
import { getCommonTeamById, listCommonTeams } from "../../controller/common/team.controller";
import { getDashboardStats } from "../../controller/common/dashboardStats.controller";

const router = Router();


// BASE : api/v1/common
router.get("/employees", requireAuth, listEmployees);
router.get("/employees/:id", requireAuth, getEmployeeById);


router.get("/teams", requireAuth, listCommonTeams);
router.get("/teams/:id", requireAuth, getCommonTeamById);


router.get("/dashboard/stats", requireAuth, getDashboardStats);

export default router;
