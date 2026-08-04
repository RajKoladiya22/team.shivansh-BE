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
  uploadProjectAttachmentFile,
  addProjectAttachment,
  listProjectAttachments,
  deleteProjectAttachment,
} from "../../controller/project/attachment.controller";
import { projectAttachmentUpload } from "../../core/middleware/multer/projectAttachment";
import {
  createProjectCustomField,
  listProjectCustomFields,
  updateProjectCustomField,
  deleteProjectCustomField,
} from "../../controller/project/customField.controller";
import {
  listProjectComments,
  addProjectComment,
  updateProjectComment,
  deleteProjectComment,
} from "../../controller/project/comment.controller";
import { requireAuth, requireRole } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth);

// ── Project CRUD ────────────────────────────────────────────
router.get("/", listProjects);
router.post("/", requireRole("ADMIN"), projectAttachmentUpload.array("attachmentFiles", 20), createProject);
router.get("/:id", getProjectById);
router.patch("/:id", requireRole("ADMIN"), projectAttachmentUpload.array("attachmentFiles", 20), updateProject);
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
router.post("/attachments/upload", projectAttachmentUpload.single("file"), uploadProjectAttachmentFile);
router.post("/:id/attachments", addProjectAttachment);
router.get("/:id/attachments", listProjectAttachments);
router.delete("/:id/attachments/:attachmentId", deleteProjectAttachment);

// ── Custom Fields ───────────────────────────────────────────
router.post("/:id/custom-fields", requireRole("ADMIN"), createProjectCustomField);
router.get("/:id/custom-fields", listProjectCustomFields);
router.patch("/:id/custom-fields/:fieldId", requireRole("ADMIN"), updateProjectCustomField);
router.delete("/:id/custom-fields/:fieldId", requireRole("ADMIN"), deleteProjectCustomField);

// ── Comments ────────────────────────────────────────────────
router.get("/:id/comments", listProjectComments);
router.post("/:id/comments", addProjectComment);
router.patch("/:id/comments/:commentId", updateProjectComment);
router.delete("/:id/comments/:commentId", deleteProjectComment);

export default router;