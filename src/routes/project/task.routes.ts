// src/routes/project/task.routes.ts

import { Router } from "express";
import {
  createProjectTask,
  assignTask,
} from "../../controller/project/task.controller";
import { requireAuth } from "../../core/middleware/auth";

const router = Router();

router.post("/:projectId/tasks", requireAuth, createProjectTask);
router.post("/tasks/:taskId/assign", requireAuth, assignTask);

export default router;
