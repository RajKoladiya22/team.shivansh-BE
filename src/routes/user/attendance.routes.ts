// src/routes/attendance.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  userCheckIn,
  userCheckOut,
  userAttendanceStatus,
  userGetTodayAttendance,
  userGetAttendanceHistory,
  userApplyLeave,
  userGetLeaves,
  userCancelLeave,
  userBreakStart,
  userBreakEnd,
} from "../../controller/user/attendance.controller";

const router = Router();
router.use(requireAuth);

// User — Attendance
router.post("/checkin", userCheckIn);
router.post("/checkout", userCheckOut);
router.get("/status", userAttendanceStatus);
router.get("/today", userGetTodayAttendance);
router.get("/", userGetAttendanceHistory);
router.post("/break/start", userBreakStart);
router.post("/break/end", userBreakEnd);

// User — Leave
router.post("/leave", userApplyLeave);
router.get("/leave", userGetLeaves);
router.delete("/leave/:id", userCancelLeave);

export default router;
