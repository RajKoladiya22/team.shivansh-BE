// src/routes/template.routes.ts
import { Router } from "express";
import {
  createTemplate,
  listTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  pinTemplateForAccount,
  setTemplateVisibility,
  setTemplateActive,
} from "../../controller/template/message.controller";
import { requireAuth } from "../../core/middleware/auth";


const router = Router();

router.post("/message", requireAuth, createTemplate);
router.get("/message",requireAuth, listTemplates); // listing public allowed
router.get("/message/:id", requireAuth, getTemplateById);

router.patch("/message/:id", requireAuth, updateTemplate);
router.delete("/message/:id", requireAuth, deleteTemplate);

// per-account actions
router.post("/message/:id/pin", requireAuth, pinTemplateForAccount);
router.post("/message/:id/visibility", requireAuth, setTemplateVisibility); // visibility logic inside checks admin
router.post("/message/:id/activate", requireAuth, setTemplateActive);

export default router;
