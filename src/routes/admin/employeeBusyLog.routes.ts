import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  requireRole,
} from "../../core/middleware/auth";


import { getEmployeeBusyLogs } from "../../controller/admin/employeeBusyLog.controller";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/employees/:id/busy-logs", getEmployeeBusyLogs);
export default router;
