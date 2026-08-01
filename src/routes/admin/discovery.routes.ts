// src/routes/admin/discovery.routes.ts

import { Router } from "express";
import { requireAuth, requireRole } from "../../core/middleware/auth";
import {
  createDiscovery,
  getAdminDiscoveries,
  getAdminDiscoveryById,
  updateDiscovery,
  deleteDiscovery,
  publishDiscovery,
  archiveDiscovery,
} from "../../controller/admin/discovery.controller";

const router = Router();

// Protect all admin discovery routes with auth
router.use(requireAuth);

router.post("/", createDiscovery);
router.get("/", getAdminDiscoveries);
router.get("/:id", getAdminDiscoveryById);
router.patch("/:id", updateDiscovery);
router.delete("/:id", deleteDiscovery);
router.post("/:id/publish", publishDiscovery);
router.post("/:id/archive", archiveDiscovery);

export default router;
