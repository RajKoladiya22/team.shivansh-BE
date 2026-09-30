// src/routes/admin/target.routes.ts
import { Router } from "express";
import { requireAuth, requireRole } from "../../core/middleware/auth";
import {
  getTargetOverview,
  setPeriodTarget,
  createTarget,
  listTargets,
  getTargetDetails,
  updateTarget,
  deleteTarget,
} from "../../controller/admin/target.controller";

const router = Router();

// Protect all target management routes: ONLY Admin and Primary Admin
router.use(requireAuth, requireRole("ADMIN", "PRIMARY_ADMIN"));

// Overview & calculation endpoint (Yearly, Quarterly, Monthly, Weekly)
router.get("/overview", getTargetOverview);

// Fast period target upsert
router.post("/period-target", setPeriodTarget);

// Standard CRUD
router.post("/", createTarget);
router.get("/", listTargets);
router.get("/:id", getTargetDetails);
router.put("/:id", updateTarget);
router.delete("/:id", deleteTarget);

export default router;
