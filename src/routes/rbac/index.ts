import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  requireRole,
  requirePermission,
} from "../../core/middleware/auth";
import {
  createRole,
  listRoles,
  deleteRole,
  createPermission,
  listPermissions,
  deletePermission,
  assignPermissionToRole,
  removePermissionFromRole,
} from "../../controller/rbac/rolePermission.controller";

const router = Router();

/* ================= PERMISSIONS ================= */

router.post(
  "/permissions",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  createPermission
);

router.get(
  "/permissions",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  listPermissions
);

router.delete(
  "/permissions/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  deletePermission
);

/* ================= ROLES ================= */

router.post(
  "/roles",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  createRole
);

router.get(
  "/roles",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  listRoles
);

router.delete(
  "/roles/:id",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  deleteRole
);

/* ========== ROLE ↔ PERMISSION ========== */

router.post(
  "/roles/assign-permission",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  assignPermissionToRole
);

router.post(
  "/roles/remove-permission",
  requireAuth,
  requireRole("ADMIN"),
  requirePermission("ALL"),
  removePermissionFromRole
);

export default router;
