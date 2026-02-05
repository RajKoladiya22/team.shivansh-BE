// src/routes/lead/lead.user.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";

import {
  listMyLeads,
  getMyLeadById,
  updateMyLeadStatus,
  getMyLeadActivity,
  getMyLeadStatusStats,
  removeLeadHelper,
  addLeadHelper,
  // startLeadWork,
  // stopLeadWork,
  // getMyActiveWork,
} from "../../controller/user/lead.controller";

const router = Router();

/* ============== USER LEADS ============== */

router.get("/leads/my", requireAuth, listMyLeads);
router.get("/leads/my/dsu", requireAuth, listMyLeads);
router.get("/leads/:id", requireAuth, getMyLeadById);
router.patch("/leads/:id/status", requireAuth, updateMyLeadStatus);
router.get("/leads/:id/activity", requireAuth, getMyLeadActivity);
router.get("/leads/my/stats/status", requireAuth, getMyLeadStatusStats);
router.post("/leads/:id/helpers", requireAuth, addLeadHelper);
router.delete("/leads/:id/helpers/:accountId", requireAuth, removeLeadHelper);
// router.post("/leads/:id/work/start", requireAuth, startLeadWork);
// router.post("/leads/work/stop", requireAuth, stopLeadWork);
// router.get("/leads/work/current", requireAuth, getMyActiveWork);

export default router;
