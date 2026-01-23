import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  createTaskAdmin,
  updateTaskAdmin,
  deleteTask,
} from "../../controller/admin/task.controller";

const router = Router();

/**
 * ==========================
 *    ADMIN TASK ROUTES
 * ==========================
 */

// Create task (admin only)
router.post("/create", requireAuth, createTaskAdmin);

// Update entire task (admin only)
router.patch("/update/:id", requireAuth, updateTaskAdmin);

// Soft delete task (admin only)
router.delete("/delete/:id", requireAuth, deleteTask);

export default router;