// src/routes/index.ts
import { Router } from "express";

const router = Router();
import profileRouter from "./profile.routes";
import bankRouter from "./bank.routes";
import tasksRouter from "./task.routes"
import leadRouter from "./lead.routes";

// base path for each module
router.use("/", profileRouter);
router.use("/bank", bankRouter);
router.use("/tasks", tasksRouter);
router.use("/", leadRouter);

// export main
export default router;
