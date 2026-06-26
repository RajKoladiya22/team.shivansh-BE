import { Router } from "express";
import {
    getCloudServiceList,
    createCloudService,
    getCloudServiceDetails,
    getCloudServiceActivity,
    addCloudServiceNote,
    updateCloudService,
    deleteCloudService,
    renewCloudService,
    cancelLatestRenewal,
    toggleCloudServiceStatus,
    addCloudServiceUser,
    updateCloudServiceUser,
    removeCloudServiceUser,
} from "../../controller/cloud/cloud.controller";
import { requireAuth } from "../../core/middleware/auth";
import { getCloudServiceDashboardStats, getCloudServiceDetailedStats, getQuickCloudServiceStats } from "../../controller/cloud/dashboard.controller";
import { getUpcomingRenewals, sendRenewalReminders } from "../../controller/cloud/reminders.controller";

const router = Router();

// ── Collection ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, getCloudServiceList);
router.post("/", requireAuth, createCloudService);

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get("/stats/dashboard", requireAuth, getCloudServiceDashboardStats);
router.get("/stats/detailed", requireAuth, getCloudServiceDetailedStats);
router.get("/stats/quick", requireAuth, getQuickCloudServiceStats);

// ── Reminders ─────────────────────────────────────────────────────────────────
router.get("/reminders/upcoming", requireAuth, getUpcomingRenewals);
router.post("/reminders/send", requireAuth, sendRenewalReminders);

// ── Single resource ───────────────────────────────────────────────────────────
router.get("/:id", requireAuth, getCloudServiceDetails);
router.patch("/:id", requireAuth, updateCloudService);
router.delete("/:id", requireAuth, deleteCloudService);

// ── Service-level actions ─────────────────────────────────────────────────────
router.patch("/:id/renew", requireAuth, renewCloudService);
router.post("/:id/cancel-renewal", requireAuth, cancelLatestRenewal);
router.patch("/:id/toggle", requireAuth, toggleCloudServiceStatus);

// ── Users ─────────────────────────────────────────────────────────────────────
router.post("/:id/users", requireAuth, addCloudServiceUser);
router.patch("/:id/users/:userId", requireAuth, updateCloudServiceUser);
router.delete("/:id/users/:userId", requireAuth, removeCloudServiceUser);

// ── Activity & notes ──────────────────────────────────────────────────────────
router.get("/:id/activity", requireAuth, getCloudServiceActivity);
router.post("/:id/note", requireAuth, addCloudServiceNote);

export default router;