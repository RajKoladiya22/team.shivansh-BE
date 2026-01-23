import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";

import {
  createSelfTask,
  getMyTasks,
  updateTaskStatus,
  getKanbanTasks,
  getTaskHistory,
  getTaskDetails,
} from "../../controller/user/task.controller";

const router = Router();

// Create self-task (employee personal task)
router.post("/self", requireAuth, createSelfTask);

// Get tasks assigned to logged-in user (team + individual)
router.get("/my", requireAuth, getMyTasks);

// Update task status (employee or admin)
router.patch("/update-status", requireAuth, updateTaskStatus);

// Kanban board (admin = all tasks, user = only their tasks)
router.get("/kanban", requireAuth, getKanbanTasks);

// Task history logs
router.get("/history/:id", requireAuth, getTaskHistory);

// Complete task data (assignments, subtasks, project, team mapping)
router.get("/details/:id", requireAuth, getTaskDetails);

export default router;
