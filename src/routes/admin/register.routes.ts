import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { requireRole, requirePermission } from "../../core/middleware/auth";
import {
  approveRegistration,
  listRegistrations,
  // registerEmployee,
  rejectRegistration,
} from "../../controller/registration/registration.controller";

const router = Router();

// router.post("/register", registerEmployee);

router.post(
  "/registrations/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  approveRegistration
);

router.post(
  "/registrations/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  rejectRegistration
);

router.get(
  "/registrations",
  requireAuth,
  requireRole("ADMIN"),
  listRegistrations
);



export default router;