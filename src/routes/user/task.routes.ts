// src/routes/task.routes.ts
import { Router } from "express";

import {
  // Admin
  createTaskAdmin,
  assignTaskAdmin,
  updateTaskAdmin,
  deleteTaskAdmin,
  listTasksAdmin,
  getTaskByIdAdmin,
  getTaskActivityAdmin,
  getTaskStatsAdmin,
  // User
  getMyTasksUser,
  getTaskByIdUser,
  updateTaskStatusUser,
  completeTaskUser,
  getTaskActivityUser,
  addCommentUser,
  getTaskCommentsUser,
} from "../../controller/user/task.controller";
import { requireAuth, requireRole } from "../../core/middleware/auth";

const router = Router();

// All routes require a valid session
router.use(requireAuth);

/* ═══════════════════════════════════════════════════════════════
   ADMIN ROUTES  —  /admin/tasks/*
   Require ADMIN role (checked again inside each handler for safety)
═══════════════════════════════════════════════════════════════ */

// Stats must be registered before /:id to avoid route shadowing
router.get(  "/admin/tasks/stats",        requireRole("ADMIN"), getTaskStatsAdmin);

router.post( "/admin/tasks",              requireRole("ADMIN"), createTaskAdmin);
router.get(  "/admin/tasks",              requireRole("ADMIN"), listTasksAdmin);
router.get(  "/admin/tasks/:id",          requireRole("ADMIN"), getTaskByIdAdmin);
router.patch("/admin/tasks/:id",          requireRole("ADMIN"), updateTaskAdmin);
router.delete("/admin/tasks/:id",         requireRole("ADMIN"), deleteTaskAdmin);

router.post( "/admin/tasks/:id/assign",   requireRole("ADMIN"), assignTaskAdmin);
router.get(  "/admin/tasks/:id/activity", requireRole("ADMIN"), getTaskActivityAdmin);

/* ═══════════════════════════════════════════════════════════════
   USER ROUTES  —  /user/tasks/*
   Accessible to any authenticated user.
   Each handler enforces isAssignedToTask() internally.
═══════════════════════════════════════════════════════════════ */

router.get( "/user/tasks",                 getMyTasksUser);
router.get( "/user/tasks/:id",             getTaskByIdUser);

router.patch("/user/tasks/:id/status",     updateTaskStatusUser);
router.post( "/user/tasks/:id/complete",   completeTaskUser);

router.get(  "/user/tasks/:id/activity",   getTaskActivityUser);

router.post( "/user/tasks/:id/comments",   addCommentUser);
router.get(  "/user/tasks/:id/comments",   getTaskCommentsUser);

export default router;