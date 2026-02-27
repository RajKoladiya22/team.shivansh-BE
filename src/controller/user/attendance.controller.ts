// src/controller/user/attendance.controller.ts
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../../config/database.config";
import { getIo } from "../../core/utils/socket";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import {
  AttendanceStatus,
  CheckSource,
  CheckType,
  LeaveStatus,
  LeaveType,
} from "@prisma/client";

/* ═══════════════════════════════════════════════════════════════
   INTERNAL HELPERS
═══════════════════════════════════════════════════════════════ */

/** Strip time — midnight 00:00:00 in LOCAL server timezone */
function toDateOnly(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDayName(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

/** Derive AttendanceStatus from worked minutes */
function deriveStatus(minutes: number): AttendanceStatus {
  if (minutes >= 480) return AttendanceStatus.PRESENT;
  if (minutes >= 240) return AttendanceStatus.HALF_DAY;
  return AttendanceStatus.ABSENT;
}

/**
 * Build enriched session array from raw CheckLog rows.
 * Each session = { sessionId, checkIn, checkOut, durationMinutes, isOpen }
 */
function buildSessions(checkLogs: any[]) {
  const map: Record<
    string,
    { sessionId: string; checkIn?: Date; checkOut?: Date }
  > = {};

  for (const c of checkLogs) {
    if (!c.sessionId) continue;
    if (!map[c.sessionId]) map[c.sessionId] = { sessionId: c.sessionId };
    if (c.type === CheckType.CHECK_IN) map[c.sessionId].checkIn = c.checkedAt;
    if (c.type === CheckType.CHECK_OUT) map[c.sessionId].checkOut = c.checkedAt;
  }

  return Object.values(map).map((s) => ({
    sessionId: s.sessionId,
    checkIn: s.checkIn ?? null,
    checkOut: s.checkOut ?? null,
    durationMinutes:
      s.checkIn && s.checkOut
        ? Math.floor((s.checkOut.getTime() - s.checkIn.getTime()) / 60_000)
        : null,
    isOpen: !!s.checkIn && !s.checkOut,
  }));
}

/**
 * Enumerate every calendar date in [start, end] inclusive.
 */
function getDateRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/**
 * Find the open sessionId (CHECK_IN with no paired CHECK_OUT)
 * from an array of CheckLog rows.
 */
function findOpenSessionId(checks: any[]): string | null {
  const map: Record<string, { in?: string; out?: string }> = {};
  for (const c of checks) {
    if (!c.sessionId) continue;
    if (!map[c.sessionId]) map[c.sessionId] = {};
    if (c.type === CheckType.CHECK_IN) map[c.sessionId].in = c.id;
    if (c.type === CheckType.CHECK_OUT) map[c.sessionId].out = c.id;
  }
  return Object.entries(map).find(([, v]) => v.in && !v.out)?.[0] ?? null;
}

/** Emit socket events safely (won't crash if io not initialized) */
function emit(room: string, event: string, data: unknown) {
  try {
    getIo().to(room).emit(event, data);
  } catch {
    // socket not initialized in test / migration contexts
  }
}

function findOpenBreakSessionId(checks: any[]): string | null {
  const map: Record<string, { start?: boolean; end?: boolean }> = {};
  for (const c of checks) {
    if (!c.sessionId) continue;
    if (!map[c.sessionId]) map[c.sessionId] = {};
    if (c.type === "BREAK_START") map[c.sessionId].start = true;
    if (c.type === "BREAK_END") map[c.sessionId].end = true;
  }
  return Object.entries(map).find(([, v]) => v.start && !v.end)?.[0] ?? null;
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN GUARD
═══════════════════════════════════════════════════════════════ */

function assertAdmin(req: Request, res: Response): boolean {
  if (!req.user?.roles?.includes?.("ADMIN")) {
    sendErrorResponse(res, 403, "Admin access required");
    return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   ██╗   ██╗███████╗███████╗██████╗     ███████╗██╗██████╗ ███████╗
   ██║   ██║██╔════╝██╔════╝██╔══██╗    ██╔════╝██║██╔══██╗██╔════╝
   ██║   ██║███████╗█████╗  ██████╔╝    ███████╗██║██║  ██║█████╗
   ██║   ██║╚════██║██╔══╝  ██╔══██╗    ╚════██║██║██║  ██║██╔══╝
   ╚██████╔╝███████║███████╗██║  ██║    ███████║██║██████╔╝███████╗
    ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝    ╚══════╝╚═╝╚═════╝ ╚══════╝
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/attendance/checkin
   Employee starts a new work session for today.
   Guards against duplicate open sessions.
───────────────────────────────────────────────────────────── */
export async function userCheckIn(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();
    const today = toDateOnly(now);
    const dayName = getDayName(today);
    const isSunday = today.getDay() === 0;
    const sessionId = randomUUID();

    const { ipAddress, deviceMeta } = req.body ?? {};

    const result = await prisma.$transaction(async (tx) => {
      /* 1. Look up or create today's log.
            Using findUnique + create (not upsert) so we can read
            the current `hasOpenSession` BEFORE potentially creating.       */
      let log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId, date: today } },
      });

      if (!log) {
        log = await tx.attendanceLog.create({
          data: {
            accountId,
            date: today,
            day: dayName,
            isSunday,
            status: AttendanceStatus.PRESENT,
            firstCheckIn: now,
            hasOpenSession: false, // will be set to true below
            isWFH: req.body?.isWFH === true,
          },
        });
      }

      /* 2. Guard: already has an open session */
      if (log.hasOpenSession) {
        throw Object.assign(
          new Error("Already checked in. Please check out first."),
          { statusCode: 409 },
        );
      }

      /* 3. Create CheckLog (CHECK_IN) */
      const checkLog = await tx.checkLog.create({
        data: {
          accountId,
          date: today,
          checkedAt: now,
          type: CheckType.CHECK_IN,
          source: CheckSource.MANUAL,
          sessionId,
          ipAddress: ipAddress ?? null,
          deviceMeta: deviceMeta ?? null,
          attendanceLogId: log.id,
        },
      });

      /* 4. Update log — open session, preserve firstCheckIn */
      const updatedLog = await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenSession: true,
          firstCheckIn: log.firstCheckIn ?? now,
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { isAvailable: true },
      });

      return { log: updatedLog, checkLog };
    });

    /* 5. Real-time: broadcast to admin dashboard */
    emit("attendance:admin", "attendance:checkin", {
      accountId,
      sessionId,
      checkedInAt: result.checkLog.checkedAt,
      log: result.log,
    });

    return sendSuccessResponse(res, 200, "Checked in successfully", {
      sessionId,
      checkedInAt: result.checkLog.checkedAt,
      attendance: result.log,
    });
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    console.error("CheckIn error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Check-in failed");
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /user/attendance/checkout
   Closes the open CHECK_IN session, recomputes work minutes.
───────────────────────────────────────────────────────────── */
export async function userCheckOut(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();
    const today = toDateOnly(now);
    const { ipAddress, deviceMeta } = req.body ?? {};

    const result = await prisma.$transaction(async (tx) => {
      /* 1. Today's log must exist */
      const log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId, date: today } },
      });

      if (!log)
        throw Object.assign(
          new Error("No attendance record for today. Please check in first."),
          { statusCode: 404 },
        );

      if (!log.hasOpenSession)
        throw Object.assign(new Error("No open check-in session found."), {
          statusCode: 409,
        });

      /* 2. Load all checks for today, find the open session */
      const allChecks = await tx.checkLog.findMany({
        where: { attendanceLogId: log.id },
        orderBy: { checkedAt: "asc" },
      });

      const openSessionId = findOpenSessionId(allChecks);
      if (!openSessionId)
        throw Object.assign(
          new Error("Could not find open check-in session."),
          { statusCode: 409 },
        );

      /* 3. Compute this session's duration */
      const openIn = allChecks.find(
        (c) => c.sessionId === openSessionId && c.type === CheckType.CHECK_IN,
      );
      const sessionMinutes = openIn
        ? Math.floor((now.getTime() - openIn.checkedAt.getTime()) / 60_000)
        : 0;

      /* 4. Create CHECK_OUT */
      const checkOut = await tx.checkLog.create({
        data: {
          accountId,
          date: today,
          checkedAt: now,
          type: CheckType.CHECK_OUT,
          source: CheckSource.MANUAL,
          sessionId: openSessionId,
          ipAddress: ipAddress ?? null,
          deviceMeta: deviceMeta ?? null,
          attendanceLogId: log.id,
        },
      });

      /* 5. Update log */
      const newTotal = log.totalWorkMinutes + sessionMinutes;
      const updatedLog = await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenSession: false,
          lastCheckOut: now,
          totalWorkMinutes: newTotal,
          status: deriveStatus(newTotal),
        },
      });

      await tx.account.update({
        where: { id: accountId },
        data: { isAvailable: false },
      });

      return { log: updatedLog, checkOut, sessionMinutes };
    });

    /* 6. Real-time */
    emit("attendance:admin", "attendance:checkout", {
      accountId,
      checkedOutAt: result.checkOut.checkedAt,
      sessionWorkMinutes: result.sessionMinutes,
      totalWorkMinutes: result.log.totalWorkMinutes,
      log: result.log,
    });

    return sendSuccessResponse(res, 200, "Checked out successfully", {
      checkedOutAt: result.checkOut.checkedAt,
      sessionWorkMinutes: result.sessionMinutes,
      totalWorkMinutes: result.log.totalWorkMinutes,
      attendance: result.log,
    });
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    console.error("CheckOut error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Check-out failed");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/attendance/status
   Minimal payload: is the employee checked in right now?
───────────────────────────────────────────────────────────── */
export async function userAttendanceStatus(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const today = toDateOnly();

    const log = await prisma.attendanceLog.findUnique({
      where: { accountId_date: { accountId, date: today } },
      include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
    });

    return sendSuccessResponse(res, 200, "Attendance status fetched", {
      isCheckedIn: log?.hasOpenSession ?? false,
      firstCheckIn: log?.firstCheckIn ?? null,
      lastCheckOut: log?.lastCheckOut ?? null,
      totalWorkMinutes: log?.totalWorkMinutes ?? 0,
      status: log?.status ?? null,
      sessions: buildSessions(log?.checkLogs ?? []),
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch status",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/attendance/today
   Full detail — all check events + sessions for today.
───────────────────────────────────────────────────────────── */
export async function userGetTodayAttendance(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const today = toDateOnly();

    const log = await prisma.attendanceLog.findUnique({
      where: { accountId_date: { accountId, date: today } },
      include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
    });

    return sendSuccessResponse(res, 200, "Today's attendance fetched", {
      date: today,
      attendance: log ?? null,
      sessions: buildSessions(log?.checkLogs ?? []),
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch today's attendance",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/attendance?month=&year=&page=&limit=
   Paginated attendance history for the logged-in employee.
───────────────────────────────────────────────────────────── */
export async function userGetAttendanceHistory(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const month = req.query.month
      ? parseInt(req.query.month as string)
      : undefined;
    const year = req.query.year
      ? parseInt(req.query.year as string)
      : undefined;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1"));
    const limit = Math.min(100, parseInt((req.query.limit as string) ?? "31"));
    const skip = (page - 1) * limit;

    const where: any = { accountId };

    if (month !== undefined && year !== undefined) {
      where.date = {
        gte: new Date(year, month - 1, 1),
        lte: new Date(year, month, 0, 23, 59, 59),
      };
    } else if (year !== undefined) {
      where.date = {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31, 23, 59, 59),
      };
    }

    const [logs, total] = await prisma.$transaction([
      prisma.attendanceLog.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limit,
        include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
      }),
      prisma.attendanceLog.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Attendance history fetched", {
      data: logs.map((l) => ({ ...l, sessions: buildSessions(l.checkLogs) })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch attendance history",
    );
  }
}

/* ═══════════════════════════════════════════════════════════════
   LEAVE — USER SIDE
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   POST /user/leave
   Submit a leave request with overlap guard.
───────────────────────────────────────────────────────────── */
export async function userApplyLeave(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { type, startDate, endDate, reason } = req.body as {
      type: LeaveType;
      startDate: string;
      endDate?: string;
      reason: string;
    };

    if (!type || !startDate || !reason)
      return sendErrorResponse(
        res,
        400,
        "type, startDate and reason are required",
      );

    const validTypes = Object.values(LeaveType);
    if (!validTypes.includes(type))
      return sendErrorResponse(
        res,
        400,
        `type must be one of: ${validTypes.join(", ")}`,
      );

    if (type === LeaveType.MULTI_DAY && !endDate)
      return sendErrorResponse(
        res,
        400,
        "endDate is required for MULTI_DAY leave",
      );

    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : undefined;

    if (end && end < start)
      return sendErrorResponse(res, 400, "endDate must be after startDate");

    /* Overlap check — no pending/approved leave touching these dates */
    const conflict = await prisma.leaveRequest.findFirst({
      where: {
        accountId,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        OR: [
          {
            startDate: { lte: end ?? start },
            endDate: { gte: start },
          },
          {
            startDate: { lte: start },
            endDate: null,
          },
        ],
      },
    });

    if (conflict)
      return sendErrorResponse(
        res,
        409,
        "Overlapping leave request already exists",
      );

    const leave = await prisma.leaveRequest.create({
      data: {
        accountId,
        type,
        startDate: start,
        endDate: end ?? null,
        reason,
        status: LeaveStatus.PENDING,
      },
    });

    /* Notify admin in real-time */
    emit("attendance:admin", "leave:new", {
      accountId,
      leaveId: leave.id,
      type: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
    });

    return sendSuccessResponse(res, 201, "Leave request submitted", leave);
  } catch (err: any) {
    return sendErrorResponse(res, 500, err?.message ?? "Failed to apply leave");
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /user/leave?status=&page=&limit=
───────────────────────────────────────────────────────────── */
export async function userGetLeaves(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const status = req.query.status as LeaveStatus | undefined;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1"));
    const limit = Math.min(50, parseInt((req.query.limit as string) ?? "10"));
    const skip = (page - 1) * limit;

    const where: any = { accountId };
    if (status) {
      const validStatuses = Object.values(LeaveStatus);
      if (!validStatuses.includes(status))
        return sendErrorResponse(
          res,
          400,
          `status must be one of: ${validStatuses.join(", ")}`,
        );
      where.status = status;
    }

    const [leaves, total] = await prisma.$transaction([
      prisma.leaveRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Leave requests fetched", {
      data: leaves,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch leaves",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /user/leave/:id
   Cancel own PENDING leave request.
───────────────────────────────────────────────────────────── */
export async function userCancelLeave(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;

    const leave = await prisma.leaveRequest.findFirst({
      where: { id, accountId },
    });

    if (!leave) return sendErrorResponse(res, 404, "Leave request not found");

    if (leave.status !== LeaveStatus.PENDING)
      return sendErrorResponse(
        res,
        409,
        "Only PENDING leave requests can be cancelled",
      );

    await prisma.leaveRequest.delete({ where: { id } });

    return sendSuccessResponse(res, 200, "Leave request cancelled");
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to cancel leave",
    );
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /user/attendance/break/start
   Start an optional break during an active work session.
   Guards:
     • Must be checked in (hasOpenSession = true)
     • Must NOT already be on break (hasOpenBreak = false)
     • breakType is optional: "LUNCH" | "TEA" | "PERSONAL" | "OTHER"
───────────────────────────────────────────────────────────────────────────── */
export async function userBreakStart(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const today = toDateOnly();
    const now = new Date();
    const breakSessionId = randomUUID();

    const { breakType = "OTHER", note }: { breakType?: string; note?: string } =
      req.body ?? {};

    const validBreakTypes = ["LUNCH", "TEA", "PERSONAL", "OTHER"];
    if (!validBreakTypes.includes(breakType)) {
      return sendErrorResponse(
        res,
        400,
        `breakType must be one of: ${validBreakTypes.join(", ")}`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId, date: today } },
      });

      if (!log)
        throw Object.assign(
          new Error("No attendance record today. Please check in first."),
          { statusCode: 404 },
        );

      if (!log.hasOpenSession)
        throw Object.assign(
          new Error("You must be checked in before starting a break."),
          { statusCode: 409 },
        );

      if ((log as any).hasOpenBreak)
        throw Object.assign(
          new Error("You already have an active break. Please end it first."),
          { statusCode: 409 },
        );

      const breakLog = await tx.checkLog.create({
        data: {
          accountId,
          date: today,
          checkedAt: now,
          type: "BREAK_START" as CheckType,
          source: CheckSource.MANUAL,
          sessionId: breakSessionId,
          note: note ?? null,
          breakType: breakType as any,
          attendanceLogId: log.id,
        },
      });

      const updatedLog = await tx.attendanceLog.update({
        where: { id: log.id },
        data: { hasOpenBreak: true } as any,
      });

      return { log: updatedLog, breakLog, breakSessionId };
    });

    emit("attendance:admin", "attendance:break_start", {
      accountId,
      breakSessionId,
      breakType,
      startedAt: result.breakLog.checkedAt,
    });

    return sendSuccessResponse(res, 200, "Break started", {
      breakSessionId: result.breakSessionId,
      breakType,
      startedAt: result.breakLog.checkedAt,
      attendance: result.log,
    });
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    console.error("BreakStart error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to start break");
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /user/attendance/break/end
   End the active break, compute break duration, add to totalBreakMinutes.
───────────────────────────────────────────────────────────────────────────── */
export async function userBreakEnd(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const today = toDateOnly();
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId, date: today } },
      });

      if (!log)
        throw Object.assign(new Error("No attendance record today."), {
          statusCode: 404,
        });

      if (!(log as any).hasOpenBreak)
        throw Object.assign(new Error("No active break to end."), {
          statusCode: 409,
        });

      // Find all checks today to locate the open break session
      const allChecks = await tx.checkLog.findMany({
        where: { attendanceLogId: log.id },
        orderBy: { checkedAt: "asc" },
      });

      const openBreakSessionId = findOpenBreakSessionId(allChecks);
      if (!openBreakSessionId)
        throw Object.assign(new Error("Could not find open break session."), {
          statusCode: 409,
        });

      const breakStart = allChecks.find(
        (c) => c.sessionId === openBreakSessionId && c.type === "BREAK_START",
      );
      const breakMinutes = breakStart
        ? Math.floor((now.getTime() - breakStart.checkedAt.getTime()) / 60_000)
        : 0;

      const breakEndLog = await tx.checkLog.create({
        data: {
          accountId,
          date: today,
          checkedAt: now,
          type: "BREAK_END" as CheckType,
          source: CheckSource.MANUAL,
          sessionId: openBreakSessionId,
          attendanceLogId: log.id,
        },
      });

      const newTotalBreak =
        ((log as any).totalBreakMinutes ?? 0) + breakMinutes;

      const updatedLog = await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenBreak: false,
          totalBreakMinutes: newTotalBreak,
        } as any,
      });

      return { log: updatedLog, breakEndLog, breakMinutes };
    });

    emit("attendance:admin", "attendance:break_end", {
      accountId,
      breakMinutes: result.breakMinutes,
      totalBreakMinutes: (result.log as any).totalBreakMinutes,
    });

    return sendSuccessResponse(res, 200, "Break ended", {
      breakMinutes: result.breakMinutes,
      totalBreakMinutes: (result.log as any).totalBreakMinutes,
      attendance: result.log,
    });
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    console.error("BreakEnd error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to end break");
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /user/attendance/checkin  (update userCheckIn to accept isWFH)
   Modified check-in payload: { isWFH?: boolean, ipAddress?, deviceMeta? }
   
   Add to the attendanceLog.create data:
     isWFH: (req.body?.isWFH === true)
   And to attendanceLog.update (if log already existed but not wfh):
     isWFH: (req.body?.isWFH === true)
───────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────────
   GET /user/attendance/status  (UPDATED response — add break fields)
   
   Return additionally:
   {
     isOnBreak: log?.hasOpenBreak ?? false,
     totalBreakMinutes: log?.totalBreakMinutes ?? 0,
     isWFH: log?.isWFH ?? false,
     currentBreak: { sessionId, breakType, startedAt } | null
   }
───────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────────
   ROUTES to add in attendance.routes.ts:
   
   router.post("/break/start", userBreakStart);
   router.post("/break/end", userBreakEnd);
───────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────────
   buildSessions HELPER UPDATE
   
   Update the existing buildSessions() in attendance.controller.ts to also
   compute break sessions from the same checkLogs array:
───────────────────────────────────────────────────────────────────────────── */
export function buildBreaks(checkLogs: any[]) {
  const map: Record<
    string,
    {
      sessionId: string;
      breakType?: string;
      breakStart?: Date;
      breakEnd?: Date;
    }
  > = {};

  for (const c of checkLogs) {
    if (!c.sessionId) continue;
    if (c.type !== "BREAK_START" && c.type !== "BREAK_END") continue;
    if (!map[c.sessionId]) map[c.sessionId] = { sessionId: c.sessionId };
    if (c.type === "BREAK_START") {
      map[c.sessionId].breakStart = c.checkedAt;
      map[c.sessionId].breakType = c.breakType ?? "OTHER";
    }
    if (c.type === "BREAK_END") map[c.sessionId].breakEnd = c.checkedAt;
  }

  return Object.values(map).map((b) => ({
    sessionId: b.sessionId,
    breakType: b.breakType ?? "OTHER",
    breakStart: b.breakStart ?? null,
    breakEnd: b.breakEnd ?? null,
    durationMinutes:
      b.breakStart && b.breakEnd
        ? Math.floor((b.breakEnd.getTime() - b.breakStart.getTime()) / 60_000)
        : null,
    isOpen: !!b.breakStart && !b.breakEnd,
  }));
}
