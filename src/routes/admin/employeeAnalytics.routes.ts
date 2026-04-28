import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
    requireRole,
} from "../../core/middleware/auth";

import {
    getEmployeeTaskAnalytics
} from "../../controller/admin/employeeAnalytics.controller";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/employees/tasks", getEmployeeTaskAnalytics);

export default router;
