// src/routes/task.routes.ts
import { Router } from "express";
import {
  // ── Admin ──────────────────────────────────────────────────────
  createTaskAdmin,
  assignTaskAdmin,
  updateTaskAdmin,
  deleteTaskAdmin,
  listTasksAdmin,
  getTaskByIdAdmin,
  getTaskActivityAdmin,
  getTaskStatsAdmin,
  bulkUpdateTasksAdmin,
  bulkDeleteTasksAdmin,
  duplicateTaskAdmin,
  addTaskDependencyAdmin,
  removeTaskDependencyAdmin,
  getProjectKanbanAdmin,
  updateTaskLabelsAdmin,
  listRecurringTasksAdmin,
  triggerRecurringSchedulerAdmin,
  listTaskInstancesAdmin,
  // ── User ──────────────────────────────────────────────────────
  createSelfTaskUser,
  getMyTasksUser,
  getMyTaskStatsUser,
  getTaskByIdUser,
  updateSelfTaskUser,
  deleteSelfTaskUser,
  updateTaskStatusUser,
  completeTaskUser,
  getTaskActivityUser,
  // Comments
  addCommentUser,
  getTaskCommentsUser,
  editCommentUser,
  deleteCommentUser,
  reactToCommentUser,
  // Checklist
  addChecklistItemUser,
  updateChecklistItemUser,
  deleteChecklistItemUser,
  reorderChecklistUser,
  // Time
  startTimeEntryUser,
  stopTimeEntryUser,
  logManualTimeUser,
  getTimeEntriesUser,
  deleteTimeEntryUser,
  // Watchers
  toggleWatchTaskUser,
  // Attachments
  addAttachmentUser,
  deleteAttachmentUser,
  // Subtasks
  createSubtaskUser,
} from "../../controller/user/task.controller";
import { requireAuth, requireRole } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth);

/* ═══════════════════════════════════════════════════════════════
   ADMIN — /admin/tasks/*
═══════════════════════════════════════════════════════════════ */

// ── Static paths first (before /:id) ──────────────────────────
router.get("/admin/tasks/stats", requireRole("ADMIN"), getTaskStatsAdmin);
router.get("/admin/tasks/kanban", requireRole("ADMIN"), getProjectKanbanAdmin);
router.post("/admin/tasks/bulk-update", requireRole("ADMIN"), bulkUpdateTasksAdmin);
router.delete("/admin/tasks/bulk-delete", requireRole("ADMIN"), bulkDeleteTasksAdmin);

// ── Core CRUD ──────────────────────────────────────────────────
router.post("/admin/tasks", requireRole("ADMIN"), createTaskAdmin);
router.get("/admin/tasks", requireRole("ADMIN"), listTasksAdmin);
router.get("/admin/tasks/:id", requireRole("ADMIN"), getTaskByIdAdmin);
router.patch("/admin/tasks/:id", requireRole("ADMIN"), updateTaskAdmin);
router.delete("/admin/tasks/:id", requireRole("ADMIN"), deleteTaskAdmin);

// ── Task-level actions ─────────────────────────────────────────
router.post("/admin/tasks/:id/assign", requireRole("ADMIN"), assignTaskAdmin);
router.post("/admin/tasks/:id/duplicate", requireRole("ADMIN"), duplicateTaskAdmin);
router.get("/admin/tasks/:id/activity", requireRole("ADMIN"), getTaskActivityAdmin);
router.patch("/admin/tasks/:id/labels", requireRole("ADMIN"), updateTaskLabelsAdmin);

// ── Dependencies ───────────────────────────────────────────────
router.post("/admin/tasks/:id/dependencies", requireRole("ADMIN"), addTaskDependencyAdmin);
router.delete(
  "/admin/tasks/:id/dependencies/:blockingTaskId",
  requireRole("ADMIN"),
  removeTaskDependencyAdmin,
);

// List all recurring task definitions
router.get(
  "/admin/tasks/recurring",
  requireRole("ADMIN"),
  listRecurringTasksAdmin,
);

// Manually trigger the recurring scheduler (useful for testing/admin ops)
router.post(
  "/admin/tasks/recurring/trigger",
  requireRole("ADMIN"),
  triggerRecurringSchedulerAdmin,
);

// List all spawned instances for a given parent task
// (Add this alongside the existing /admin/tasks/:id/activity route)
router.get(
  "/admin/tasks/:id/instances",
  requireRole("ADMIN"),
  listTaskInstancesAdmin,
);

/* ═══════════════════════════════════════════════════════════════
   USER — /user/tasks/*
═══════════════════════════════════════════════════════════════ */

// ── Static paths first ─────────────────────────────────────────
router.get("/user/tasks/stats", getMyTaskStatsUser);

// ── Core CRUD ──────────────────────────────────────────────────
router.post("/user/tasks", createSelfTaskUser);
router.get("/user/tasks", getMyTasksUser);
router.get("/user/tasks/:id", getTaskByIdUser);
router.patch("/user/tasks/:id", updateSelfTaskUser);        // self-tasks only
router.delete("/user/tasks/:id", deleteSelfTaskUser);       // self-tasks only

// ── Status transitions ─────────────────────────────────────────
router.patch("/user/tasks/:id/status", updateTaskStatusUser);
router.post("/user/tasks/:id/complete", completeTaskUser);

// ── Activity ───────────────────────────────────────────────────
router.get("/user/tasks/:id/activity", getTaskActivityUser);

// ── Watchers ───────────────────────────────────────────────────
router.post("/user/tasks/:id/watch", toggleWatchTaskUser);

// ── Subtasks ───────────────────────────────────────────────────
router.post("/user/tasks/:id/subtasks", createSubtaskUser);

// ── Checklist ──────────────────────────────────────────────────
router.post("/user/tasks/:id/checklist", addChecklistItemUser);
router.patch("/user/tasks/:id/checklist/reorder", reorderChecklistUser);
router.patch("/user/tasks/:id/checklist/:itemId", updateChecklistItemUser);
router.delete("/user/tasks/:id/checklist/:itemId", deleteChecklistItemUser);

// ── Comments ───────────────────────────────────────────────────
router.post("/user/tasks/:id/comments", addCommentUser);
router.get("/user/tasks/:id/comments", getTaskCommentsUser);
router.patch("/user/tasks/:id/comments/:commentId", editCommentUser);
router.delete("/user/tasks/:id/comments/:commentId", deleteCommentUser);
router.post("/user/tasks/:id/comments/:commentId/reactions", reactToCommentUser);

// ── Time tracking ──────────────────────────────────────────────
router.get("/user/tasks/:id/time", getTimeEntriesUser);
router.post("/user/tasks/:id/time/start", startTimeEntryUser);
router.post("/user/tasks/:id/time/:entryId/stop", stopTimeEntryUser);
router.post("/user/tasks/:id/time/log", logManualTimeUser);
router.delete("/user/tasks/:id/time/:entryId", deleteTimeEntryUser);

// ── Attachments ────────────────────────────────────────────────
router.post("/user/tasks/:id/attachments", addAttachmentUser);
router.delete("/user/tasks/:id/attachments/:attachmentId", deleteAttachmentUser);

export default router;