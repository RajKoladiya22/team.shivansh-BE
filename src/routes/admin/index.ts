// src/routes/index.ts
import { Router } from "express";

const router = Router();
import employeesRouter from "./employees.routes"
import registerRouter from "./register.routes"
import teamRouter from "./team.routes"
import pipelineRouter from "./pipelineTemplate.routes"
import salaryRoutes from "./salary.routes"
import tasksRoutes from "./task.routes"
import leadRoutes from "./lead.routes"
import busyLogsRoutes from "./employeeBusyLog.routes"
import attendanceRoutes from "./attendance.routes";

// base path for each module
router.use("/", employeesRouter);
router.use("/", registerRouter);
router.use("/", teamRouter);
router.use("/pipeline-templates", pipelineRouter);
router.use("/salary", salaryRoutes);
router.use("/tasks", tasksRoutes);
router.use("/", leadRoutes);
router.use("/", busyLogsRoutes);
router.use("/attendance", attendanceRoutes);

// export main
export default router;
