// src/controller/admin/attendance.controller.ts
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
   ███████╗██████╗  ██████╗
   ██╔════╝╚════██╗██╔═████╗
   ███████╗ █████╔╝██║██╔██║
   ╚════██║ ╚═══██╗████╔╝██║
   ███████║██████╔╝╚██████╔╝
   ╚══════╝╚═════╝  ╚═════╝  ADMIN SIDE
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   GET /admin/attendance/today?teamId=&status=&search=
   Live overview of all employees for today.
───────────────────────────────────────────────────────────── */
export async function adminGetTodayAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const today = toDateOnly();
    const { teamId, status, search } = req.query as Record<string, string>;

    const accountWhere: any = { isActive: true };

    if (search?.trim()) {
      accountWhere.OR = [
        { firstName: { contains: search.trim(), mode: "insensitive" } },
        { lastName: { contains: search.trim(), mode: "insensitive" } },
        { contactEmail: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    if (teamId) {
      accountWhere.teams = { some: { teamId, isActive: true } };
    }

    const [accounts, logs] = await prisma.$transaction([
      prisma.account.findMany({
        where: accountWhere,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          avatar: true,
          jobType: true,
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      prisma.attendanceLog.findMany({
        where: { date: today },
        include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
      }),
    ]);

    const logByAccount = Object.fromEntries(logs.map((l) => [l.accountId, l]));

    let overview = accounts.map((acc) => {
      const log = logByAccount[acc.id];
      return {
        account: acc,
        attendance: log ?? null,
        status: log?.status ?? "NOT_MARKED",
        isCheckedIn: log?.hasOpenSession ?? false,
        totalWorkMinutes: log?.totalWorkMinutes ?? 0,
        sessions: buildSessions(log?.checkLogs ?? []),
      };
    });

    /* Filter by status after merge (NOT_MARKED is not a DB enum) */
    if (status) {
      overview = overview.filter((o) => o.status === status);
    }

    const summary = {
      total: accounts.length,
      present: overview.filter((o) => o.status === AttendanceStatus.PRESENT)
        .length,
      halfDay: overview.filter((o) => o.status === AttendanceStatus.HALF_DAY)
        .length,
      absent: overview.filter((o) => o.status === AttendanceStatus.ABSENT)
        .length,
      notMarked: accounts.length - logs.length,
      checkedIn: overview.filter((o) => o.isCheckedIn).length,
    };

    return sendSuccessResponse(res, 200, "Today's attendance overview", {
      date: today,
      summary,
      data: overview,
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
   GET /admin/attendance?accountId=&month=&year=&status=&page=&limit=
   Paginated attendance for any/all employees.
───────────────────────────────────────────────────────────── */
export async function adminGetAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const {
      accountId,
      month,
      year,
      status,
      page: pageStr = "1",
      limit: limitStr = "31",
    } = req.query as Record<string, string>;

    const page = Math.max(1, parseInt(pageStr));
    const limit = Math.min(200, parseInt(limitStr));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (status) where.status = status as AttendanceStatus;

    if (month && year) {
      const m = parseInt(month);
      const y = parseInt(year);
      where.date = {
        gte: new Date(y, m - 1, 1),
        lte: new Date(y, m, 0, 23, 59, 59),
      };
    } else if (year) {
      const y = parseInt(year);
      where.date = {
        gte: new Date(y, 0, 1),
        lte: new Date(y, 11, 31, 23, 59, 59),
      };
    }

    const [logs, total] = await prisma.$transaction([
      prisma.attendanceLog.findMany({
        where,
        orderBy: [{ date: "desc" }, { accountId: "asc" }],
        skip,
        take: limit,
        include: {
          checkLogs: { orderBy: { checkedAt: "asc" } },
          account: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              designation: true,
              avatar: true,
            },
          },
        },
      }),
      prisma.attendanceLog.count({ where }),
    ]);

    return sendSuccessResponse(res, 200, "Attendance fetched", {
      data: logs.map((l) => ({ ...l, sessions: buildSessions(l.checkLogs) })),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch attendance",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   GET /admin/attendance/summary?month=&year=&accountId=
   Monthly per-employee summary: counts + total hours.
───────────────────────────────────────────────────────────── */
export async function adminGetAttendanceSummary(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { month, year, accountId } = req.query as Record<string, string>;

    if (!month || !year)
      return sendErrorResponse(res, 400, "month and year are required");

    const m = parseInt(month);
    const y = parseInt(year);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0, 23, 59, 59);

    const where: any = { date: { gte: from, lte: to } };
    if (accountId) where.accountId = accountId;

    const logs = await prisma.attendanceLog.findMany({
      where,
      include: {
        account: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            avatar: true,
          },
        },
      },
    });

    /* Group by accountId */
    const byAccount: Record<string, typeof logs> = {};
    for (const l of logs) {
      if (!byAccount[l.accountId]) byAccount[l.accountId] = [];
      byAccount[l.accountId].push(l);
    }

    const summary = Object.entries(byAccount).map(([, accLogs]) => {
      const totalWorkMinutes = accLogs.reduce(
        (s, l) => s + l.totalWorkMinutes,
        0,
      );
      return {
        account: accLogs[0].account,
        totalDays: accLogs.length,
        present: accLogs.filter((l) => l.status === AttendanceStatus.PRESENT)
          .length,
        halfDay: accLogs.filter((l) => l.status === AttendanceStatus.HALF_DAY)
          .length,
        absent: accLogs.filter((l) => l.status === AttendanceStatus.ABSENT)
          .length,
        holiday: accLogs.filter((l) => l.status === AttendanceStatus.HOLIDAY)
          .length,
        totalWorkMinutes,
        totalWorkHours: +(totalWorkMinutes / 60).toFixed(2),
      };
    });

    return sendSuccessResponse(res, 200, "Attendance summary fetched", {
      month: m,
      year: y,
      data: summary,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to generate summary",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/attendance/checkin
   Admin adds a missed CHECK_IN for any employee.
   Body: { accountId, checkedAt, date?, note }
───────────────────────────────────────────────────────────── */
export async function adminManualCheckIn(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const {
      accountId,
      checkedAt: checkedAtStr,
      date: dateStr,
      note,
    } = req.body as Record<string, any>;

    if (!accountId) return sendErrorResponse(res, 400, "accountId is required");
    if (!checkedAtStr)
      return sendErrorResponse(res, 400, "checkedAt is required");

    /* Validate target account exists */
    const target = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!target) return sendErrorResponse(res, 404, "Account not found");

    const checkedAt = new Date(checkedAtStr);
    const date = dateStr
      ? toDateOnly(new Date(dateStr))
      : toDateOnly(checkedAt);
    const dayName = getDayName(date);
    const sessionId = randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      /* Find or create attendance log for that date */
      let log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId, date } },
      });

      if (!log) {
        log = await tx.attendanceLog.create({
          data: {
            accountId,
            date,
            day: dayName,
            isSunday: date.getDay() === 0,
            status: AttendanceStatus.PRESENT,
            firstCheckIn: checkedAt,
            hasOpenSession: false,
          },
        });
      }

      /* Don't allow admin check-in if session already open */
      if (log.hasOpenSession) {
        throw Object.assign(
          new Error("Employee already has an open session for this date."),
          { statusCode: 409 },
        );
      }

      const checkLog = await tx.checkLog.create({
        data: {
          accountId,
          date,
          checkedAt,
          type: CheckType.CHECK_IN,
          source: CheckSource.ADMIN,
          sessionId,
          note: note ?? "Admin manual check-in",
          editedBy: adminAccountId,
          attendanceLogId: log.id,
        },
      });

      const updatedLog = await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenSession: true,
          firstCheckIn: log.firstCheckIn ?? checkedAt,
        },
      });

      return { log: updatedLog, checkLog };
    });

    /* Real-time: notify the employee */
    emit(`notif:${accountId}`, "attendance:admin_checkin", {
      sessionId,
      checkedInAt: result.checkLog.checkedAt,
      note: note ?? "Admin manual check-in",
    });

    return sendSuccessResponse(res, 201, "Manual check-in recorded", result);
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to record check-in",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   POST /admin/attendance/checkout
   Admin adds a missed CHECK_OUT.
   Body: { accountId, checkedAt, date?, sessionId?, note }
   sessionId is optional — auto-pairs with open session if omitted.
───────────────────────────────────────────────────────────── */
export async function adminManualCheckOut(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const {
      accountId,
      checkedAt: checkedAtStr,
      sessionId: providedSessionId,
      date: dateStr,
      note,
    } = req.body as Record<string, any>;

    if (!accountId) return sendErrorResponse(res, 400, "accountId is required");
    if (!checkedAtStr)
      return sendErrorResponse(res, 400, "checkedAt is required");

    const target = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!target) return sendErrorResponse(res, 404, "Account not found");

    const checkedAt = new Date(checkedAtStr);
    const date = dateStr
      ? toDateOnly(new Date(dateStr))
      : toDateOnly(checkedAt);

    const result = await prisma.$transaction(async (tx) => {
      const log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId, date } },
      });

      if (!log)
        throw Object.assign(new Error("No attendance log for this date."), {
          statusCode: 404,
        });

      const allChecks = await tx.checkLog.findMany({
        where: { attendanceLogId: log.id },
        orderBy: { checkedAt: "asc" },
      });

      const targetSessionId = providedSessionId ?? findOpenSessionId(allChecks);

      if (!targetSessionId)
        throw Object.assign(
          new Error("No open session to pair checkout with."),
          { statusCode: 409 },
        );

      /* Verify session exists and is open */
      const sessionIn = allChecks.find(
        (c) => c.sessionId === targetSessionId && c.type === CheckType.CHECK_IN,
      );
      const sessionOutExists = allChecks.some(
        (c) =>
          c.sessionId === targetSessionId && c.type === CheckType.CHECK_OUT,
      );

      if (!sessionIn)
        throw Object.assign(
          new Error("CHECK_IN for provided sessionId not found."),
          { statusCode: 404 },
        );

      if (sessionOutExists)
        throw Object.assign(new Error("Session already has a CHECK_OUT."), {
          statusCode: 409,
        });

      if (checkedAt <= sessionIn.checkedAt)
        throw Object.assign(
          new Error("checkedAt must be after the check-in time."),
          { statusCode: 400 },
        );

      const sessionMinutes = Math.floor(
        (checkedAt.getTime() - sessionIn.checkedAt.getTime()) / 60_000,
      );

      const checkOut = await tx.checkLog.create({
        data: {
          accountId,
          date,
          checkedAt,
          type: CheckType.CHECK_OUT,
          source: CheckSource.ADMIN,
          sessionId: targetSessionId,
          note: note ?? "Admin manual check-out",
          editedBy: adminAccountId,
          attendanceLogId: log.id,
        },
      });

      /* Check if any OTHER open sessions remain after this checkout */
      const remainingOpen = allChecks.filter(
        (c) =>
          c.type === CheckType.CHECK_IN &&
          c.sessionId !== targetSessionId &&
          !allChecks.some(
            (co) =>
              co.sessionId === c.sessionId && co.type === CheckType.CHECK_OUT,
          ),
      );

      const newTotal = log.totalWorkMinutes + sessionMinutes;

      const updatedLog = await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenSession: remainingOpen.length > 0,
          lastCheckOut: checkedAt,
          totalWorkMinutes: newTotal,
          status: deriveStatus(newTotal),
        },
      });

      return { log: updatedLog, checkOut, sessionMinutes };
    });

    emit(`notif:${accountId}`, "attendance:admin_checkout", {
      checkedOutAt: result.checkOut.checkedAt,
      sessionWorkMinutes: result.sessionMinutes,
      totalWorkMinutes: result.log.totalWorkMinutes,
      note: note ?? "Admin manual check-out",
    });

    return sendSuccessResponse(res, 201, "Manual check-out recorded", result);
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to record check-out",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/attendance/:id/override
   Force a specific AttendanceStatus or add an override note.
   Body: { status?, overrideNote? }
───────────────────────────────────────────────────────────── */
export async function adminOverrideAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { id } = req.params;
    const { status, overrideNote } = req.body as {
      status?: AttendanceStatus;
      overrideNote?: string;
    };

    if (!status && !overrideNote)
      return sendErrorResponse(
        res,
        400,
        "Provide at least status or overrideNote",
      );

    if (status) {
      const validStatuses = Object.values(AttendanceStatus);
      if (!validStatuses.includes(status))
        return sendErrorResponse(
          res,
          400,
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
    }

    const log = await prisma.attendanceLog.findUnique({ where: { id } });
    if (!log) return sendErrorResponse(res, 404, "Attendance log not found");

    const updated = await prisma.attendanceLog.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(overrideNote ? { overrideNote } : {}),
        overrideBy: adminAccountId,
      },
    });

    emit(`notif:${log.accountId}`, "attendance:overridden", {
      date: log.date,
      status: updated.status,
      overrideNote: updated.overrideNote,
    });

    return sendSuccessResponse(res, 200, "Attendance overridden", updated);
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to override attendance",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   DELETE /admin/attendance/checklog/:checkLogId
   Hard-delete a single check event (admin correction).
   Recalculates totalWorkMinutes on the parent AttendanceLog.
───────────────────────────────────────────────────────────── */
export async function adminDeleteCheckLog(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { checkLogId } = req.params;

    const checkLog = await prisma.checkLog.findUnique({
      where: { id: checkLogId },
    });

    if (!checkLog) return sendErrorResponse(res, 404, "CheckLog not found");

    await prisma.$transaction(async (tx) => {
      await tx.checkLog.delete({ where: { id: checkLogId } });

      /* Re-compute work minutes for the parent log */
      if (checkLog.attendanceLogId) {
        const remaining = await tx.checkLog.findMany({
          where: { attendanceLogId: checkLog.attendanceLogId },
          orderBy: { checkedAt: "asc" },
        });

        const sessions: Record<string, { in?: Date; out?: Date }> = {};
        for (const c of remaining) {
          if (!c.sessionId) continue;
          if (!sessions[c.sessionId]) sessions[c.sessionId] = {};
          if (c.type === CheckType.CHECK_IN)
            sessions[c.sessionId].in = c.checkedAt;
          if (c.type === CheckType.CHECK_OUT)
            sessions[c.sessionId].out = c.checkedAt;
        }

        let totalWorkMinutes = 0;
        for (const s of Object.values(sessions)) {
          if (s.in && s.out) {
            totalWorkMinutes += Math.floor(
              (s.out.getTime() - s.in.getTime()) / 60_000,
            );
          }
        }

        const openSessionId = findOpenSessionId(remaining);

        await tx.attendanceLog.update({
          where: { id: checkLog.attendanceLogId },
          data: {
            totalWorkMinutes,
            status: deriveStatus(totalWorkMinutes),
            hasOpenSession: !!openSessionId,
            lastCheckOut:
              remaining.filter((c) => c.type === CheckType.CHECK_OUT).at(-1)
                ?.checkedAt ?? null,
          },
        });
      }
    });

    return sendSuccessResponse(res, 200, "CheckLog deleted and log recomputed");
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete check log",
    );
  }
}

/* ═══════════════════════════════════════════════════════════════
   LEAVE — ADMIN SIDE
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   GET /admin/leave?status=&accountId=&page=&limit=
───────────────────────────────────────────────────────────── */
export async function adminGetLeaves(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const {
      status,
      accountId,
      page: pageStr = "1",
      limit: limitStr = "20",
    } = req.query as Record<string, string>;

    const page = Math.max(1, parseInt(pageStr));
    const limit = Math.min(100, parseInt(limitStr));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (status) {
      const validStatuses = Object.values(LeaveStatus);
      if (!validStatuses.includes(status as LeaveStatus))
        return sendErrorResponse(
          res,
          400,
          `status must be one of: ${validStatuses.join(", ")}`,
        );
      where.status = status as LeaveStatus;
    }

    const [leaves, total] = await prisma.$transaction([
      prisma.leaveRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          account: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              designation: true,
              avatar: true,
            },
          },
        },
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
      err?.message ?? "Failed to fetch leave requests",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   PATCH /admin/leave/:id
   Approve or Reject a PENDING leave.
   On APPROVED → upsert AttendanceLog rows for each date.
   Body: { status: "APPROVED" | "REJECTED", decisionReason? }
───────────────────────────────────────────────────────────── */
export async function adminDecideLeave(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { id } = req.params;
    const { status, decisionReason } = req.body as {
      status: LeaveStatus;
      decisionReason?: string;
    };

    if (
      !status ||
      (status !== LeaveStatus.APPROVED && status !== LeaveStatus.REJECTED)
    )
      return sendErrorResponse(res, 400, "status must be APPROVED or REJECTED");

    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) return sendErrorResponse(res, 404, "Leave request not found");

    if (leave.status !== LeaveStatus.PENDING)
      return sendErrorResponse(res, 409, "Leave request is no longer PENDING");

    const updated = await prisma.$transaction(async (tx) => {
      const updatedLeave = await tx.leaveRequest.update({
        where: { id },
        data: {
          status,
          decidedBy: adminAccountId,
          decisionReason: decisionReason ?? null,
          decidedAt: new Date(),
        },
        include: {
          account: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      /* On approval → mark attendance logs for affected dates */
      if (status === LeaveStatus.APPROVED) {
        const dates = getDateRange(
          leave.startDate,
          leave.endDate ?? leave.startDate,
        );

        const leaveAttendanceStatus =
          leave.type === LeaveType.HALF_DAY
            ? AttendanceStatus.HALF_DAY
            : AttendanceStatus.ABSENT;

        for (const rawDate of dates) {
          const date = toDateOnly(rawDate);
          const dayName = getDayName(date);

          await tx.attendanceLog.upsert({
            where: {
              accountId_date: { accountId: leave.accountId, date },
            },
            create: {
              accountId: leave.accountId,
              date,
              day: dayName,
              isSunday: date.getDay() === 0,
              status: leaveAttendanceStatus,
              overrideNote: `Leave approved: ${leave.type}`,
              overrideBy: adminAccountId,
            },
            update: {
              status: leaveAttendanceStatus,
              overrideNote: `Leave approved: ${leave.type}`,
              overrideBy: adminAccountId,
            },
          });
        }
      }

      return updatedLeave;
    });

    /* Notify employee in real-time */
    emit(`notif:${leave.accountId}`, "leave:decided", {
      leaveId: id,
      status,
      decisionReason: decisionReason ?? null,
    });

    return sendSuccessResponse(
      res,
      200,
      `Leave ${status.toLowerCase()}`,
      updated,
    );
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to decide leave",
    );
  }
}
