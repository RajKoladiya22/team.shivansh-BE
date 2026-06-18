// src/routes/common/index.ts

import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { getEmployeeById, listEmployees } from "../../controller/common/employee.controller";
import { getCommonTeamById, listCommonTeams } from "../../controller/common/team.controller";
import { getDashboardStats } from "../../controller/common/dashboardStats.controller";
import {
  getDashboardTasksWidget,
  getDashboardQuotationsWidget,
  getDashboardRemindersWidget,
  getDashboardTDLWidget,
  getDashboardNotificationsWidget,
  getDashboardAdminMonitoringWidget,
} from "../../controller/common/dashboardWidgets.controller";

const router = Router();


// BASE : api/v1/common
router.get("/employees", requireAuth, listEmployees);
router.get("/employees/:id", requireAuth, getEmployeeById);


router.get("/teams", requireAuth, listCommonTeams);
router.get("/teams/:id", requireAuth, getCommonTeamById);


router.get("/dashboard/stats", requireAuth, getDashboardStats);

router.get("/dashboard/widgets/tasks", requireAuth, getDashboardTasksWidget);
router.get("/dashboard/widgets/quotations", requireAuth, getDashboardQuotationsWidget);
router.get("/dashboard/widgets/reminders", requireAuth, getDashboardRemindersWidget);
router.get("/dashboard/widgets/tdl", requireAuth, getDashboardTDLWidget);
router.get("/dashboard/widgets/notifications", requireAuth, getDashboardNotificationsWidget);
router.get("/dashboard/widgets/admin-monitoring", requireAuth, getDashboardAdminMonitoringWidget);

export default router;
