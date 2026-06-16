// src/routes/project/project.routes.ts
import { Router } from "express";
import {
  listProjects,
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
  getProjectTasks,
  getProjectStats,
} from "../../controller/project/project.controller";
import {
  addProjectAttachment,
  listProjectAttachments,
  deleteProjectAttachment,
} from "../../controller/project/attachment.controller";
import {
  createProjectCustomField,
  listProjectCustomFields,
  updateProjectCustomField,
  deleteProjectCustomField,
} from "../../controller/project/customField.controller";
import { requireAuth, requireRole } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth);

// ── Project CRUD ────────────────────────────────────────────
router.get("/", listProjects);
router.post("/", requireRole("ADMIN"), createProject);
router.get("/:id", getProjectById);
router.patch("/:id", requireRole("ADMIN"), updateProject);
router.delete("/:id", requireRole("ADMIN"), deleteProject);

// ── Stats ───────────────────────────────────────────────────
router.get("/:id/stats", getProjectStats);

// ── Tasks (flat list) ───────────────────────────────────────
router.get("/:id/tasks", getProjectTasks);

// ── Members ─────────────────────────────────────────────────
router.post("/:id/members", requireRole("ADMIN"), addProjectMember);
router.patch("/:id/members/:accountId", requireRole("ADMIN"), updateProjectMember);
router.delete("/:id/members/:accountId", requireRole("ADMIN"), removeProjectMember);

// ── Attachments ─────────────────────────────────────────────
router.post("/:id/attachments", addProjectAttachment);
router.get("/:id/attachments", listProjectAttachments);
router.delete("/:id/attachments/:attachmentId", deleteProjectAttachment);

// ── Custom Fields ───────────────────────────────────────────
router.post("/:id/custom-fields", requireRole("ADMIN"), createProjectCustomField);
router.get("/:id/custom-fields", listProjectCustomFields);
router.patch("/:id/custom-fields/:fieldId", requireRole("ADMIN"), updateProjectCustomField);
router.delete("/:id/custom-fields/:fieldId", requireRole("ADMIN"), deleteProjectCustomField);

export default router;