import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { adminParseVoiceLead } from "../../controller/admin/voice.controller";

const router = Router();
router.use(requireAuth);

router.post("/voice-parse", adminParseVoiceLead);

export default router;
