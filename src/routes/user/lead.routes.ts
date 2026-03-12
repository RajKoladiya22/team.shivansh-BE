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
  startLeadWork,
  stopLeadWork,
  getMyActiveWork,
  createMyLead,
  getLeadValueStatsUser,
  createFollowUp,
  updateFollowUp,
  getLeadFollowUps,
  listFollowUps,
  deleteFollowUp,
} from "../../controller/user/lead.controller";

const router = Router();

/* ============== USER LEADS ============== */

router.post("/leads/my", requireAuth, createMyLead);
router.get("/leads/my", requireAuth, listMyLeads);
router.get("/leads/my/dsu", requireAuth, listMyLeads);
router.get("/leads/:id", requireAuth, getMyLeadById);
router.patch("/leads/:id/status", requireAuth, updateMyLeadStatus);
router.get("/leads/:id/activity", requireAuth, getMyLeadActivity);
router.post("/leads/:id/helpers", requireAuth, addLeadHelper);
router.delete("/leads/:id/helpers/:accountId", requireAuth, removeLeadHelper);
router.post("/leads/:id/work/start", requireAuth, startLeadWork);
router.post("/leads/work/stop", requireAuth, stopLeadWork);
router.get("/leads/work/current", requireAuth, getMyActiveWork);
router.get("/leads/my/stats/status", requireAuth, getMyLeadStatusStats);
router.get("/leads/stats/value", requireAuth, getLeadValueStatsUser);

router.post("/leads/:leadId/follow-ups", requireAuth, createFollowUp);
router.patch("/leads/:leadId/follow-ups/:id", requireAuth, updateFollowUp);
router.get("/leads/:leadId/follow-ups", requireAuth, getLeadFollowUps);
router.get("/leads/follow-ups", requireAuth, listFollowUps);
router.delete("/leads/:leadId/follow-ups/:id", requireAuth, deleteFollowUp);

export default router;
