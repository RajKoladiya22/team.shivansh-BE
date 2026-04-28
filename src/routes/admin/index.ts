// src/routes/admin/index.ts
import { Router } from "express";

const router = Router();
import employeesRouter from "./employees.routes";
import registerRouter from "./register.routes";
import teamRouter from "./team.routes";
import salaryRoutes from "./salary.routes";
import leadRoutes from "./lead.routes";
import busyLogsRoutes from "./employeeBusyLog.routes";
import attendanceRoutes from "./attendance.routes";
import quotationRoutes from "./quotation.routes";
import employeeAnalyticsRoutes from "./employeeAnalytics.routes";
// import holidayRoutes from "./holiday.routes"
// import pipelineRouter from "./pipelineTemplate.routes"
// import tasksRoutes from "./task.routes"

// base path for each module
router.use("/quotations", quotationRoutes);
router.use("/", leadRoutes);
router.use("/", employeesRouter);
router.use("/", registerRouter);
router.use("/", teamRouter);
router.use("/salary", salaryRoutes);
router.use("/", busyLogsRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/analytics", employeeAnalyticsRoutes);

// router.use("/holiday", holidayRoutes);
// router.use("/pipeline-templates", pipelineRouter);
// router.use("/tasks", tasksRoutes);

// export main
export default router;
