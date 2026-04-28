import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
    requireRole,
} from "../../core/middleware/auth";

import {
    getEmployeeTaskAnalytics, getEmployeeAnalyticsV2
} from "../../controller/admin/employeeAnalytics.controller";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/employees/tasks", getEmployeeTaskAnalytics);
router.get("/employees/detailed", getEmployeeAnalyticsV2);

export default router;
