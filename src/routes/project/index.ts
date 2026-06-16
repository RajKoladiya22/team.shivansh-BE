// src/routes/project/index.ts
import { Router } from "express";
import projectsRouter from "./project.routes";
import projectTasksRouter from "./task.routes";

const router = Router();

router.use("/", projectsRouter);
router.use("/", projectTasksRouter);

export default router;
