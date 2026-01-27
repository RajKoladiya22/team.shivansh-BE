// src/routes/lead/lead.user.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";

import {
  listMyLeads,
  getMyLeadById,
  updateMyLeadStatus,
  getMyLeadActivity,
  getMyLeadStatusStats,
} from "../../controller/user/lead.controller";

const router = Router();

/* ============== USER LEADS ============== */

router.get("/leads/my", requireAuth, listMyLeads);
router.get("/leads/:id", requireAuth, getMyLeadById);
router.patch("/leads/:id/status", requireAuth, updateMyLeadStatus);
router.get("/leads/:id/activity", requireAuth, getMyLeadActivity);
router.get("/leads/my/stats/status", requireAuth, getMyLeadStatusStats);


export default router;
