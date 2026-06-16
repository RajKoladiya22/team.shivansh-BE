import { Router } from "express";
import {
  createPipelineTemplate,
  getPipelineTemplates,
  getPipelineTemplateById,
  updatePipelineTemplate,
  deletePipelineTemplate,
} from "../../controller/pipeline/pipelineTemplate.controller";
import { requireAuth, requireRole } from "../../core/middleware/auth";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.post("/", createPipelineTemplate);
router.get("/", getPipelineTemplates);
router.get("/:id", getPipelineTemplateById);
router.patch("/:id", updatePipelineTemplate);
router.delete("/:id", deletePipelineTemplate);

export default router;
