// src/routes/lead/lead.user.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";

import {
  listMyLeads,
  getMyLeadById,
  updateMyLeadStatus,
  getMyLeadActivity,
} from "../../controller/user/lead.controller";

const router = Router();

/* ============== USER LEADS ============== */

router.get("/leads/my", requireAuth, listMyLeads);
router.get("/leads/:id", requireAuth, getMyLeadById);
router.patch("/leads/:id/status", requireAuth, updateMyLeadStatus);
router.get("/leads/:id/activity", requireAuth, getMyLeadActivity);

export default router;
