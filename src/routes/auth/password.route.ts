// src/routes/auth/password.route.ts
import { Router } from "express";
import {
  forgotPassword,
  verifyOtpAndResetPassword,
  changePasswordWithOld,
} from "../../controller/auth/password.controller";
import { requireAuth } from "../../core/middleware/auth";


const router = Router();

// public
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", verifyOtpAndResetPassword);

// authenticated
router.post("/change-password", requireAuth, changePasswordWithOld);

export default router;
