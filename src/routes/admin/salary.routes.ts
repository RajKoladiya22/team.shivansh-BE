import { Router } from "express";
import {
  requireAuth,
  requireRole,
  requirePermission,
} from "../../core/middleware/auth";
import { generateMonthlySalary, getSalaryStructure, upsertSalaryStructure } from "../../controller/admin/salary.admin.controller";

const router = Router();

/**
 * ADMIN
 * Create / Update salary structure (with revision)
 */
router.post(
  "/structure",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  upsertSalaryStructure
);

router.put(
  "/structure",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  upsertSalaryStructure
);

router.post(
  "/monthly",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  generateMonthlySalary
);
router.get(
  "/structure",
  requireAuth,
  getSalaryStructure
);
export default router;
