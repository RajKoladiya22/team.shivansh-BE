// src/routes/attendance.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  adminGetTodayAttendance,
  adminGetAttendance,
  adminGetAttendanceSummary,
  adminManualCheckIn,
  adminManualCheckOut,
  adminOverrideAttendance,
  adminDeleteCheckLog,
  adminGetLeaves,
  adminDecideLeave,
} from "../../controller/admin/attendance.controller";

const router = Router();
router.use(requireAuth);

// Admin — Attendance
router.get("/today", adminGetTodayAttendance);
router.get("/summary", adminGetAttendanceSummary);
router.get("/", adminGetAttendance);
router.post("/checkin", adminManualCheckIn);
router.post("/checkout", adminManualCheckOut);
router.patch("/:id/override", adminOverrideAttendance);
router.delete("/checklog/:checkLogId", adminDeleteCheckLog);

// Admin — Leave
router.get("/admin/leave", adminGetLeaves);
router.patch("/admin/leave/:id", adminDecideLeave);

export default router;
