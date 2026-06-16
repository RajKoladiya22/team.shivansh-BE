import { Router } from "express";
import { createLabel, listLabels, updateLabel, deleteLabel } from "../../controller/label/label.controller";
import { requireAuth, requireRole } from "../../core/middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/", listLabels);
router.post("/", requireRole("ADMIN"), createLabel);
router.patch("/:id", requireRole("ADMIN"), updateLabel);
router.delete("/:id", requireRole("ADMIN"), deleteLabel);

export default router;
