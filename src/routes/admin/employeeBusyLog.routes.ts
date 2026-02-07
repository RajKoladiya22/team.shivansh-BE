import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  requireRole,
} from "../../core/middleware/auth";


import {  getEmployeeBusyLogs, getMyBusyLogs } from "../../controller/admin/employeeBusyLog.controller";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/employees/:id/busy-logs", getEmployeeBusyLogs);
router.get("/my/busy-logs", getMyBusyLogs);
export default router;