// src/routes/index.ts
import { Router } from "express";

const router = Router();
import profileRouter from "./profile.routes";
import bankRouter from "./bank.routes";
import tasksRouter from "./task.routes"
import leadRouter from "./lead.routes";
import attendanceRoutes from "./attendance.routes";
// import statusRouter from "./dailyStatus.routes";

// base path for each module
router.use("/", profileRouter);
router.use("/bank", bankRouter);
router.use("/tasks", tasksRouter);
router.use("/", leadRouter);
router.use("/attendance", attendanceRoutes);
// router.use("/ds", statusRouter);

// export main
export default router;
