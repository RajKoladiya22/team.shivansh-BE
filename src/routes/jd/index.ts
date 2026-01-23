import { Router } from "express";
import {
  upsertJobDescription,
  deleteJobDescription,
  getMyJobDescription,
} from "../../controller/jd/jobDescription.controller";
import { requireAuth, requirePermission, requireRole } from "../../core/middleware/auth";


const router = Router();

/* ===== EMPLOYEE ===== */
router.get(
  "/my",
  requireAuth,
  getMyJobDescription
);

/* ===== ADMIN ===== */
router.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  upsertJobDescription
);

router.put(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  upsertJobDescription
);

router.delete(
  "/:accountId",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  deleteJobDescription
);

export default router;
