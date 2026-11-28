// src/routes/admin/attendance.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  adminGetTodayAttendance,
  adminGetAttendance,
  adminGetAttendanceSummary,
  adminManualCheckIn,
  adminManualCheckOut,
  adminUpsertSession,
  adminUpdateCheckLog,
  adminOverrideAttendance,
  adminUpsertOverrideAttendance,
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
router.post("/session", adminUpsertSession);
router.post("/override", adminUpsertOverrideAttendance);
router.patch("/:id/override", adminOverrideAttendance);
router.patch("/checklog/:checkLogId", adminUpdateCheckLog);
router.delete("/checklog/:checkLogId", adminDeleteCheckLog);

// Admin — Leave
router.get("/leave", adminGetLeaves);
router.patch("/leave/:id", adminDecideLeave);

export default router;
