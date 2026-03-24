// src/routes/task/index.ts
import { Router } from "express";

const router = Router();
import taskAssignmentRouter from "./task.routes";


router.use("/", taskAssignmentRouter);

// export main
export default router;
