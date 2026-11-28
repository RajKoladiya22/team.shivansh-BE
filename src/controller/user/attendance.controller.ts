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
import { triggerLeaveRequestNotification } from "../../services/notifications";
import {
  stopActiveWorkForAccount,
  emitWorkStoppedEvents,
} from "../../core/utils/workSession.util";
import {
  buildBreaks,
  buildSessions,
  closeOpenSessionsOnLogTx,
  computeAttendanceMetricsFromLogs,
  enrichAttendanceLogResponse,
  enumerateISTDateStrs,
  findApprovedLeaveForISTDate,
  findAttendanceLogForISTDate,
  findHolidayForISTDate,
  getISTClockTime,
  getISTDayBounds,
  getISTMonthBounds,
  getISTYearBounds,
  HR_RULES,
  isManualAdminOverride,
  recomputeAttendanceLogTx,
  resolveAttendanceDayStatus,
  toISTDateOnly,
  toISTDateStr,
} from "../../core/utils/attendance.util";

/* ═══════════════════════════════════════════════════════════════
   INTERNAL HELPERS
═══════════════════════════════════════════════════════════════ */

function emit(room: string, event: string, data: unknown) {
  try {
    getIo().to(room).emit(event, data);
  } catch {
    // socket not initialized in test / migration contexts
  }
}

/* ═══════════════════════════════════════════════════════════════
   USER — CHECK-IN / CHECK-OUT / BREAKS
═══════════════════════════════════════════════════════════════ */

/**
 * POST /user/attendance/checkin
 * Employee starts a new work session for today (IST).
 * Automatically closes any stale open sessions from earlier dates first.
 */
export async function userCheckIn(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();
    const {
      date: today,
      start: todayStart,
      dayName,
      isSunday,
    } = getISTDayBounds(now);
    const sessionId = randomUUID();

    const { ipAddress, deviceMeta } = req.body ?? {};
    const isWFH =
      req.body?.isWFH === true || req.body?.deviceMeta?.isWFH === true;

    const result = await prisma.$transaction(async (tx) => {
      // 0. Close any lingering stale open sessions from earlier days (< todayStart)
      const staleOpenLogs = await tx.attendanceLog.findMany({
        where: {
          accountId,
          date: { lt: todayStart },
          OR: [{ hasOpenSession: true }, { hasOpenBreak: true }],
        },
        include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
      });

      for (const stale of staleOpenLogs) {
        const staleSixPM = getISTClockTime(
          stale.date,
          HR_RULES.SHIFT_END_HOUR,
          HR_RULES.SHIFT_END_MINUTE,
          0,
        );
        const staleEndOfDay = getISTDayBounds(stale.date).end;
        await closeOpenSessionsOnLogTx(
          tx,
          stale,
          staleSixPM,
          staleEndOfDay,
          CheckSource.AUTO,
          "Auto checkout (previous day unclosed session)",
        );
      }

      // 1. Check holiday & approved leave for today
      const [holiday, approvedLeave] = await Promise.all([
        findHolidayForISTDate(tx, now),
        findApprovedLeaveForISTDate(tx, accountId, now),
      ]);

      let log = await findAttendanceLogForISTDate(tx, accountId, now);

      // Block check-in on approved FULL_DAY / MULTI_DAY leave unless admin manually overrode
      if (
        approvedLeave &&
        (approvedLeave.type === LeaveType.FULL_DAY ||
          approvedLeave.type === LeaveType.MULTI_DAY) &&
        !isManualAdminOverride(log)
      ) {
        throw Object.assign(
          new Error(
            "You have an approved full-day leave today. Please contact admin if you are working today.",
          ),
          { statusCode: 409 },
        );
      }

      if (!log) {
        const initialStatus = holiday
          ? AttendanceStatus.HOLIDAY
          : approvedLeave?.type === LeaveType.HALF_DAY
            ? AttendanceStatus.HALF_DAY
            : AttendanceStatus.PRESENT;

        log = await tx.attendanceLog.create({
          data: {
            accountId,
            date: today,
            day: dayName,
            isSunday,
            status: initialStatus,
            firstCheckIn: now,
            hasOpenSession: false,
            isWFH,
            overrideNote: holiday
              ? `Public holiday: ${holiday.name}`
              : approvedLeave?.type === LeaveType.HALF_DAY
                ? `Leave approved: ${approvedLeave.type}`
                : null,
            overrideBy:
              approvedLeave?.type === LeaveType.HALF_DAY
                ? approvedLeave.decidedBy ?? null
                : null,
          },
        });
      }

      // 2. Guard: already has an open session
      if (log.hasOpenSession) {
        throw Object.assign(
          new Error("Already checked in. Please check out first."),
          { statusCode: 409 },
        );
      }

      // 3. Create CheckLog (CHECK_IN)
      const checkLog = await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt: now,
          type: CheckType.CHECK_IN,
          source: CheckSource.MANUAL,
          sessionId,
          ipAddress: ipAddress ?? null,
          deviceMeta: {
            ...(deviceMeta && typeof deviceMeta === "object" ? deviceMeta : {}),
            isWFH,
          },
          attendanceLogId: log.id,
        },
      });

      // 4. Recompute AttendanceLog consistently
      const recomputed = await recomputeAttendanceLogTx(tx, log.id, {
        forceIsWFH: Boolean(log.isWFH || isWFH),
      });

      await tx.account.update({
        where: { id: accountId },
        data: { isAvailable: true },
      });

      return {
        log: enrichAttendanceLogResponse(recomputed.log, {
          holiday: recomputed.holiday,
          approvedLeave: recomputed.approvedLeave,
        }),
        checkLog,
      };
    });

    emit("attendance:admin", "attendance:checkin", {
      accountId,
      sessionId,
      checkedInAt: result.checkLog.checkedAt,
      log: result.log,
    });

    try {
      getIo().emit("busy:changed", {
        accountId,
        isBusy: false,
        isAvailable: true,
        source: "CHECK-IN",
      });
    } catch (e) {
      console.warn("[checkIn] busy:changed emit skipped:", e);
    }

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

/**
 * POST /user/attendance/checkout
 * Closes any open break + open CHECK_IN session, recomputes net work minutes (breaks subtracted)
 * and HR status.
 */
export async function userCheckOut(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();
    const { ipAddress, deviceMeta } = req.body ?? {};

    const result = await prisma.$transaction(async (tx) => {
      const log = await findAttendanceLogForISTDate(tx, accountId, now, true);

      if (!log) {
        throw Object.assign(
          new Error("No attendance record for today. Please check in first."),
          { statusCode: 404 },
        );
      }

      if (!log.hasOpenSession) {
        throw Object.assign(new Error("No open check-in session found."), {
          statusCode: 409,
        });
      }

      const allChecks = log.checkLogs ?? [];
      const openSession = buildSessions(allChecks).find((s) => s.isOpen);
      if (!openSession) {
        throw Object.assign(
          new Error("Could not find open check-in session."),
          { statusCode: 409 },
        );
      }

      // Auto-close any open break at checkout time so break & work stay exact
      const openBreak = buildBreaks(allChecks).find((b) => b.isOpen);
      if (openBreak) {
        await tx.checkLog.create({
          data: {
            accountId,
            date: log.date,
            checkedAt: now,
            type: CheckType.BREAK_END,
            source: CheckSource.AUTO,
            sessionId: openBreak.sessionId,
            note: "Auto break end at checkout",
            attendanceLogId: log.id,
          },
        });
      }

      const checkOut = await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt: now,
          type: CheckType.CHECK_OUT,
          source: CheckSource.MANUAL,
          sessionId: openSession.sessionId,
          ipAddress: ipAddress ?? null,
          deviceMeta: deviceMeta ?? null,
          attendanceLogId: log.id,
        },
      });

      const recomputed = await recomputeAttendanceLogTx(tx, log.id);
      const closedSession = recomputed.metrics.sessions.find(
        (s) => s.sessionId === openSession.sessionId,
      );

      const stoppedWork = await stopActiveWorkForAccount(tx, accountId, {
        reason: "USER_CHECKOUT",
        endTime: now,
        clearAvailability: true,
      });

      const enriched = enrichAttendanceLogResponse(recomputed.log, {
        holiday: recomputed.holiday,
        approvedLeave: recomputed.approvedLeave,
      });

      return {
        log: enriched,
        checkOut,
        sessionMinutes: closedSession?.durationMinutes ?? 0,
        stoppedWork,
      };
    });

    emit("attendance:admin", "attendance:checkout", {
      accountId,
      checkedOutAt: result.checkOut.checkedAt,
      sessionWorkMinutes: result.sessionMinutes,
      totalWorkMinutes: result.log.totalWorkMinutes,
      totalBreakMinutes: result.log.totalBreakMinutes,
      log: result.log,
    });

    await emitWorkStoppedEvents({
      accountId,
      stoppedLeadIds: result.stoppedWork.stoppedLeadIds,
      stoppedSupportIds: result.stoppedWork.stoppedSupportIds,
      reason: "CHECK-OUT",
      isAvailable: false,
    });

    return sendSuccessResponse(res, 200, "Checked out successfully", {
      checkedOutAt: result.checkOut.checkedAt,
      sessionWorkMinutes: result.sessionMinutes,
      totalWorkMinutes: result.log.totalWorkMinutes,
      totalBreakMinutes: result.log.totalBreakMinutes,
      attendance: result.log,
    });
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    console.error("CheckOut error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Check-out failed");
  }
}

/**
 * GET /user/attendance/status
 * Complete live status payload for header button, reminders, and today card.
 */
export async function userAttendanceStatus(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();
    const { isSunday } = getISTDayBounds(now);

    const [log, holiday, approvedLeave] = await Promise.all([
      findAttendanceLogForISTDate(prisma, accountId, now, true),
      findHolidayForISTDate(prisma, now),
      findApprovedLeaveForISTDate(prisma, accountId, now),
    ]);

    const metrics = log
      ? computeAttendanceMetricsFromLogs(log.checkLogs ?? [], log.isWFH)
      : null;

    const resolved = resolveAttendanceDayStatus({
      netWorkMinutes: log?.totalWorkMinutes ?? metrics?.totalWorkMinutes ?? 0,
      hasCheckIn: Boolean(metrics?.hasCheckIn || log?.firstCheckIn),
      hasOpenSession: Boolean(log?.hasOpenSession),
      firstCheckIn: log?.firstCheckIn ?? metrics?.firstCheckIn ?? null,
      isSunday,
      holiday,
      approvedLeave,
      existingLog: log,
    });

    return sendSuccessResponse(res, 200, "Attendance status fetched", {
      isCheckedIn: log?.hasOpenSession ?? false,
      isOnBreak: log?.hasOpenBreak ?? false,
      isWFH: log?.isWFH ?? false,
      isSunday,
      firstCheckIn: log?.firstCheckIn ?? null,
      lastCheckOut: log?.lastCheckOut ?? null,
      totalWorkMinutes: log?.totalWorkMinutes ?? 0,
      totalBreakMinutes: log?.totalBreakMinutes ?? 0,
      status: log?.status ?? (holiday ? AttendanceStatus.HOLIDAY : approvedLeave ? resolved.status : null),
      sessions: metrics?.sessions ?? [],
      breaks: metrics?.breaks ?? [],
      currentBreak: metrics?.currentBreak ?? null,
      holiday: holiday ? { id: holiday.id, name: holiday.name, date: holiday.date } : null,
      approvedLeave: approvedLeave
        ? { id: approvedLeave.id, type: approvedLeave.type, status: approvedLeave.status }
        : null,
      isLate: resolved.dayBreakdown.isLate,
      lateByMinutes: resolved.dayBreakdown.lateByMinutes,
      dayBreakdown: resolved.dayBreakdown,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch status",
    );
  }
}

/**
 * GET /user/attendance/today
 * Full detail — all check events + work sessions + break sessions + HR breakdown for today.
 */
export async function userGetTodayAttendance(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();
    const { date: today, dateStr, isSunday } = getISTDayBounds(now);

    const [log, holiday, approvedLeave] = await Promise.all([
      findAttendanceLogForISTDate(prisma, accountId, now, true),
      findHolidayForISTDate(prisma, now),
      findApprovedLeaveForISTDate(prisma, accountId, now),
    ]);

    const enriched = log
      ? enrichAttendanceLogResponse(log, { holiday, approvedLeave })
      : null;

    const metrics = log
      ? computeAttendanceMetricsFromLogs(log.checkLogs ?? [], log.isWFH)
      : null;

    const resolved = resolveAttendanceDayStatus({
      netWorkMinutes: log?.totalWorkMinutes ?? 0,
      hasCheckIn: Boolean(metrics?.hasCheckIn),
      hasOpenSession: Boolean(log?.hasOpenSession),
      firstCheckIn: log?.firstCheckIn ?? null,
      isSunday,
      holiday,
      approvedLeave,
      existingLog: log,
    });

    return sendSuccessResponse(res, 200, "Today's attendance fetched", {
      date: today,
      dateStr,
      isSunday,
      attendance: enriched,
      sessions: metrics?.sessions ?? [],
      breaks: metrics?.breaks ?? [],
      isOnBreak: log?.hasOpenBreak ?? false,
      currentBreak: metrics?.currentBreak ?? null,
      holiday: holiday ? { id: holiday.id, name: holiday.name, date: holiday.date } : null,
      approvedLeave: approvedLeave
        ? { id: approvedLeave.id, type: approvedLeave.type, status: approvedLeave.status }
        : null,
      dayBreakdown: resolved.dayBreakdown,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch today's attendance",
    );
  }
}

/**
 * GET /user/attendance?month=&year=&page=&limit=
 * Paginated attendance history for the logged-in employee, enriched with
 * sessions, breaks, holidays, approved leaves, and HR dayBreakdown.
 */
export async function userGetAttendanceHistory(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const month = req.query.month
      ? parseInt(req.query.month as string, 10)
      : undefined;
    const year = req.query.year
      ? parseInt(req.query.year as string, 10)
      : undefined;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "31", 10)));
    const skip = (page - 1) * limit;

    if (month !== undefined && (isNaN(month) || month < 1 || month > 12)) {
      return sendErrorResponse(res, 400, "Invalid month (1-12)");
    }
    if (year !== undefined && (isNaN(year) || year < 2000 || year > 2100)) {
      return sendErrorResponse(res, 400, "Invalid year");
    }

    let rangeStart: Date | undefined;
    let rangeEnd: Date | undefined;

    if (month !== undefined && year !== undefined) {
      const b = getISTMonthBounds(year, month);
      rangeStart = b.start;
      rangeEnd = b.end;
    } else if (year !== undefined) {
      const b = getISTYearBounds(year);
      rangeStart = b.start;
      rangeEnd = b.end;
    }

    const where: any = { accountId };
    if (rangeStart && rangeEnd) {
      where.date = { gte: rangeStart, lte: rangeEnd };
    }

    const [logs, total, account, holidays, approvedLeaves] = await Promise.all([
      prisma.attendanceLog.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limit,
        include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
      }),
      prisma.attendanceLog.count({ where }),
      prisma.account.findUnique({
        where: { id: accountId },
        select: { joinedAt: true, createdAt: true },
      }),
      rangeStart && rangeEnd
        ? prisma.publicHoliday.findMany({
            where: { date: { gte: rangeStart, lte: rangeEnd } },
            orderBy: { date: "asc" },
          })
        : prisma.publicHoliday.findMany({ orderBy: { date: "asc" } }),
      prisma.leaveRequest.findMany({
        where: {
          accountId,
          status: LeaveStatus.APPROVED,
          ...(rangeEnd ? { startDate: { lte: rangeEnd } } : {}),
        },
        orderBy: { startDate: "asc" },
      }),
    ]);

    const holidayByDate = new Map<string, any>();
    for (const h of holidays) {
      holidayByDate.set(toISTDateStr(h.date), h);
    }

    const leaveByDate = new Map<string, any>();
    for (const l of approvedLeaves) {
      const s = toISTDateStr(l.startDate);
      const e = l.endDate ? toISTDateStr(l.endDate) : s;
      for (const dStr of enumerateISTDateStrs(s, e)) {
        leaveByDate.set(dStr, l);
      }
    }

    const enrichedLogs = logs.map((l) => {
      const dStr = toISTDateStr(l.date);
      return enrichAttendanceLogResponse(l, {
        holiday: holidayByDate.get(dStr) ?? null,
        approvedLeave: leaveByDate.get(dStr) ?? null,
      });
    });

    return sendSuccessResponse(res, 200, "Attendance history fetched", {
      data: enrichedLogs,
      holidays: holidays.map((h) => ({
        ...h,
        dateStr: toISTDateStr(h.date),
      })),
      approvedLeaves: approvedLeaves.map((l) => ({
        ...l,
        startDateStr: toISTDateStr(l.startDate),
        endDateStr: l.endDate ? toISTDateStr(l.endDate) : toISTDateStr(l.startDate),
      })),
      joinedAt: account?.joinedAt ?? account?.createdAt ?? null,
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

/**
 * POST /user/attendance/leave
 * Submit a leave request with IST normalization, non-sandwich validation, and overlap guard.
 */
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

    if (!type || !startDate || !reason?.trim()) {
      return sendErrorResponse(
        res,
        400,
        "type, startDate and reason are required",
      );
    }

    const validTypes = Object.values(LeaveType);
    if (!validTypes.includes(type)) {
      return sendErrorResponse(
        res,
        400,
        `type must be one of: ${validTypes.join(", ")}`,
      );
    }

    if (type === LeaveType.MULTI_DAY && !endDate) {
      return sendErrorResponse(
        res,
        400,
        "endDate is required for MULTI_DAY leave",
      );
    }

    let start: Date;
    let end: Date | null = null;
    try {
      start = toISTDateOnly(startDate);
      if (type === LeaveType.MULTI_DAY && endDate) {
        end = toISTDateOnly(endDate);
      } else if (endDate && endDate.trim()) {
        const parsedEnd = toISTDateOnly(endDate);
        if (parsedEnd.getTime() !== start.getTime()) {
          return sendErrorResponse(
            res,
            400,
            `${type} leave must be for a single date`,
          );
        }
      }
    } catch {
      return sendErrorResponse(res, 400, "Invalid date format");
    }

    if (end && end < start) {
      return sendErrorResponse(res, 400, "endDate must be on or after startDate");
    }

    const effectiveEnd = end ?? start;
    const startStr = toISTDateStr(start);
    const endStr = toISTDateStr(effectiveEnd);
    const dateStrs = enumerateISTDateStrs(startStr, endStr);

    // Non-sandwich validation: ensure at least 1 working day (non-Sunday, non-PublicHoliday)
    const holidays = await prisma.publicHoliday.findMany({
      where: {
        date: {
          gte: start,
          lte: getISTDayBounds(endStr).end,
        },
      },
    });
    const holidayDates = new Set(holidays.map((h) => toISTDateStr(h.date)));

    const workingDateStrs = dateStrs.filter((dStr) => {
      const { isSunday } = getISTDayBounds(dStr);
      return !isSunday && !holidayDates.has(dStr);
    });

    if (workingDateStrs.length === 0) {
      return sendErrorResponse(
        res,
        400,
        "Selected date(s) fall only on Sunday or a Public Holiday",
      );
    }

    // Overlap check against existing PENDING or APPROVED leaves using IST calendar strings
    const existingLeaves = await prisma.leaveRequest.findMany({
      where: {
        accountId,
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
      },
    });

    const conflict = existingLeaves.find((l) => {
      const lStart = toISTDateStr(l.startDate);
      const lEnd = l.endDate ? toISTDateStr(l.endDate) : lStart;
      return lStart <= endStr && lEnd >= startStr;
    });

    if (conflict) {
      return sendErrorResponse(
        res,
        409,
        "Overlapping leave request already exists",
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        accountId,
        type,
        startDate: start,
        endDate: end,
        reason: reason.trim(),
        status: LeaveStatus.PENDING,
      },
    });

    emit("attendance:admin", "leave:new", {
      accountId,
      leaveId: leave.id,
      type: leave.type,
      startDate: leave.startDate,
      endDate: leave.endDate,
    });

    triggerLeaveRequestNotification({
      leaveId: leave.id,
      accountId,
      type: leave.type,
    }).catch((err) =>
      console.error("Failed to send leave request notification:", err),
    );

    const effectiveLeaveDays =
      type === LeaveType.HALF_DAY ? 0.5 : workingDateStrs.length;

    return sendSuccessResponse(res, 201, "Leave request submitted", {
      ...leave,
      effectiveLeaveDays,
      workingDates: workingDateStrs,
    });
  } catch (err: any) {
    return sendErrorResponse(res, 500, err?.message ?? "Failed to apply leave");
  }
}

/**
 * GET /user/attendance/leave?status=&from=&to=&page=&limit=
 */
export async function userGetLeaves(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const status = req.query.status as LeaveStatus | undefined;
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? "10", 10)));
    const skip = (page - 1) * limit;

    const where: any = { accountId };
    if (status) {
      const validStatuses = Object.values(LeaveStatus);
      if (!validStatuses.includes(status)) {
        return sendErrorResponse(
          res,
          400,
          `status must be one of: ${validStatuses.join(", ")}`,
        );
      }
      where.status = status;
    }

    if (fromStr || toStr) {
      const andFilters: any[] = [];
      if (toStr) {
        try {
          const toEnd = getISTDayBounds(toStr).end;
          andFilters.push({ startDate: { lte: toEnd } });
        } catch {
          return sendErrorResponse(res, 400, "Invalid 'to' date");
        }
      }
      if (fromStr) {
        try {
          const fromStart = getISTDayBounds(fromStr).start;
          andFilters.push({
            OR: [
              { endDate: { gte: fromStart } },
              { endDate: null, startDate: { gte: fromStart } },
            ],
          });
        } catch {
          return sendErrorResponse(res, 400, "Invalid 'from' date");
        }
      }
      if (andFilters.length > 0) where.AND = andFilters;
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

/**
 * DELETE /user/attendance/leave/:id
 */
export async function userCancelLeave(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const { id } = req.params;

    const leave = await prisma.leaveRequest.findFirst({
      where: { id, accountId },
    });

    if (!leave) return sendErrorResponse(res, 404, "Leave request not found");

    if (leave.status !== LeaveStatus.PENDING) {
      return sendErrorResponse(
        res,
        409,
        "Only PENDING leave requests can be cancelled",
      );
    }

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

/* ═══════════════════════════════════════════════════════════════
   USER — BREAKS
═══════════════════════════════════════════════════════════════ */

/**
 * POST /user/attendance/break/start
 */
export async function userBreakStart(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

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
      const log = await findAttendanceLogForISTDate(tx, accountId, now);

      if (!log) {
        throw Object.assign(
          new Error("No attendance record today. Please check in first."),
          { statusCode: 404 },
        );
      }

      if (!log.hasOpenSession) {
        throw Object.assign(
          new Error("You must be checked in before starting a break."),
          { statusCode: 409 },
        );
      }

      if (log.hasOpenBreak) {
        throw Object.assign(
          new Error("You already have an active break. Please end it first."),
          { statusCode: 409 },
        );
      }

      const breakLog = await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt: now,
          type: CheckType.BREAK_START,
          source: CheckSource.MANUAL,
          sessionId: breakSessionId,
          note: note ?? null,
          breakType: breakType as any,
          attendanceLogId: log.id,
        },
      });

      const recomputed = await recomputeAttendanceLogTx(tx, log.id);

      const stoppedWork = await stopActiveWorkForAccount(tx, accountId, {
        reason: "BREAK_START",
        endTime: now,
        clearAvailability: true,
      });

      return {
        log: recomputed.log,
        breakLog,
        breakSessionId,
        stoppedWork,
      };
    });

    emit("attendance:admin", "attendance:break_start", {
      accountId,
      breakSessionId,
      breakType,
      startedAt: result.breakLog.checkedAt,
    });

    await emitWorkStoppedEvents({
      accountId,
      stoppedLeadIds: result.stoppedWork.stoppedLeadIds,
      stoppedSupportIds: result.stoppedWork.stoppedSupportIds,
      reason: "BREAK-START",
      isAvailable: false,
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

/**
 * POST /user/attendance/break/end
 */
export async function userBreakEnd(req: Request, res: Response) {
  try {
    const accountId = req.user?.accountId;
    if (!accountId) return sendErrorResponse(res, 401, "Invalid session");

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const log = await findAttendanceLogForISTDate(tx, accountId, now, true);

      if (!log) {
        throw Object.assign(new Error("No attendance record today."), {
          statusCode: 404,
        });
      }

      if (!log.hasOpenBreak) {
        throw Object.assign(new Error("No active break to end."), {
          statusCode: 409,
        });
      }

      const openBreak = buildBreaks(log.checkLogs ?? []).find((b) => b.isOpen);
      if (!openBreak) {
        throw Object.assign(new Error("Could not find open break session."), {
          statusCode: 409,
        });
      }

      const breakEndLog = await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt: now,
          type: CheckType.BREAK_END,
          source: CheckSource.MANUAL,
          sessionId: openBreak.sessionId,
          attendanceLogId: log.id,
        },
      });

      const recomputed = await recomputeAttendanceLogTx(tx, log.id);
      const closedBreak = recomputed.metrics.breaks.find(
        (b) => b.sessionId === openBreak.sessionId,
      );

      await tx.account.update({
        where: { id: accountId },
        data: { isAvailable: true },
      });

      return {
        log: recomputed.log,
        breakEndLog,
        breakMinutes: closedBreak?.durationMinutes ?? 0,
      };
    });

    emit("attendance:admin", "attendance:break_end", {
      accountId,
      breakMinutes: result.breakMinutes,
      totalBreakMinutes: result.log.totalBreakMinutes,
    });

    try {
      getIo().emit("busy:changed", {
        accountId,
        isBusy: false,
        isAvailable: true,
        source: "BREAK-END",
      });
    } catch (e) {
      console.warn("[break] busy:changed emit skipped:", e);
    }

    return sendSuccessResponse(res, 200, "Break ended", {
      breakMinutes: result.breakMinutes,
      totalBreakMinutes: result.log.totalBreakMinutes,
      attendance: result.log,
    });
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    console.error("BreakEnd error:", err);
    return sendErrorResponse(res, 500, err?.message ?? "Failed to end break");
  }
}

/* ═══════════════════════════════════════════════════════════════
   USER — HOLIDAYS
═══════════════════════════════════════════════════════════════ */

/**
 * GET /user/attendance/holidays?year=
 */
export async function userGetHolidays(req: Request, res: Response) {
  try {
    const yearStr = req.query.year as string | undefined;
    const where: any = {};
    if (yearStr) {
      const y = parseInt(yearStr, 10);
      if (isNaN(y) || y < 2000 || y > 2100) {
        return sendErrorResponse(res, 400, "Invalid year");
      }
      const { start, end } = getISTYearBounds(y);
      where.date = { gte: start, lte: end };
    }

    const holidays = await prisma.publicHoliday.findMany({
      where,
      orderBy: { date: "asc" },
    });
    return sendSuccessResponse(
      res,
      200,
      "Public holidays fetched successfully",
      holidays.map((h) => ({ ...h, dateStr: toISTDateStr(h.date) })),
    );
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch holidays",
    );
  }
}
