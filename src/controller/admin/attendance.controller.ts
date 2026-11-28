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
  BreakType,
  CheckSource,
  CheckType,
  LeaveStatus,
  LeaveType,
} from "@prisma/client";
import { triggerLeaveDecidedNotification } from "../../services/notifications";
import {
  stopActiveWorkForAccount,
  emitWorkStoppedEvents,
} from "../../core/utils/workSession.util";
import {
  computeAttendanceMetricsFromLogs,
  enrichAttendanceLogResponse,
  enumerateISTDateStrs,
  findApprovedLeaveForISTDate,
  findAttendanceLogForISTDate,
  findHolidayForISTDate,
  getISTDayBounds,
  getISTMonthBounds,
  getISTYearBounds,
  isAutoLeaveNote,
  isManualAdminOverride,
  isSameISTDay,
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

function assertAdmin(req: Request, res: Response): boolean {
  if (!req.user?.roles?.includes?.("ADMIN")) {
    sendErrorResponse(res, 403, "Admin access required");
    return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN — TODAY OVERVIEW
═══════════════════════════════════════════════════════════════ */

/**
 * GET /admin/attendance/today?teamId=&status=&search=
 * Live overview of all active employees for today (IST).
 */
export async function adminGetTodayAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const now = new Date();
    const {
      date: today,
      start: todayStart,
      end: todayEnd,
      dateStr: todayStr,
      isSunday,
    } = getISTDayBounds(now);
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

    const [accounts, logs, holiday, approvedLeaves] = await prisma.$transaction([
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
        where: { date: { gte: todayStart, lte: todayEnd } },
        include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
        orderBy: { date: "asc" },
      }),
      prisma.publicHoliday.findFirst({
        where: { date: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.leaveRequest.findMany({
        where: {
          status: LeaveStatus.APPROVED,
          startDate: { lte: todayEnd },
        },
      }),
    ]);

    const logByAccount: Record<string, any> = {};
    for (const l of logs) {
      // Prefer exact canonical IST midnight match if duplicates ever exist
      if (
        !logByAccount[l.accountId] ||
        new Date(l.date).getTime() === today.getTime()
      ) {
        logByAccount[l.accountId] = l;
      }
    }

    const leaveByAccount: Record<string, any> = {};
    for (const lv of approvedLeaves) {
      const sStr = toISTDateStr(lv.startDate);
      const eStr = lv.endDate ? toISTDateStr(lv.endDate) : sStr;
      if (todayStr >= sStr && todayStr <= eStr) {
        leaveByAccount[lv.accountId] = lv;
      }
    }

    const fullOverview = accounts.map((acc) => {
      const rawLog = logByAccount[acc.id] ?? null;
      const approvedLeave = leaveByAccount[acc.id] ?? null;

      if (rawLog) {
        const enriched = enrichAttendanceLogResponse(rawLog, {
          holiday,
          approvedLeave,
        });
        return {
          account: acc,
          attendance: enriched,
          status: enriched.status ?? "NOT_MARKED",
          isCheckedIn: enriched.hasOpenSession ?? false,
          isOnBreak: enriched.hasOpenBreak ?? false,
          isWFH: enriched.isWFH ?? false,
          isLate: enriched.isLate ?? false,
          lateByMinutes: enriched.lateByMinutes ?? 0,
          totalWorkMinutes: enriched.totalWorkMinutes ?? 0,
          totalBreakMinutes: enriched.totalBreakMinutes ?? 0,
          sessions: enriched.sessions ?? [],
          breaks: enriched.breaks ?? [],
          holiday: enriched.holiday,
          approvedLeave: enriched.approvedLeave,
          dayBreakdown: enriched.dayBreakdown,
        };
      }

      // No AttendanceLog row yet for today — still reflect Holiday / Approved Leave accurately
      const effectiveStatus = holiday
        ? AttendanceStatus.HOLIDAY
        : approvedLeave && !isSunday
          ? approvedLeave.type === LeaveType.HALF_DAY
            ? AttendanceStatus.HALF_DAY
            : AttendanceStatus.LEAVE
          : "NOT_MARKED";

      const resolved = resolveAttendanceDayStatus({
        netWorkMinutes: 0,
        hasCheckIn: false,
        hasOpenSession: false,
        firstCheckIn: null,
        isSunday,
        holiday,
        approvedLeave: isSunday ? null : approvedLeave,
        existingLog: null,
      });

      return {
        account: acc,
        attendance: null,
        status: effectiveStatus,
        isCheckedIn: false,
        isOnBreak: false,
        isWFH: false,
        isLate: false,
        lateByMinutes: 0,
        totalWorkMinutes: 0,
        totalBreakMinutes: 0,
        sessions: [],
        breaks: [],
        holiday: holiday
          ? { id: holiday.id, name: holiday.name, date: holiday.date }
          : null,
        approvedLeave: approvedLeave
          ? { id: approvedLeave.id, type: approvedLeave.type, status: approvedLeave.status }
          : null,
        dayBreakdown: resolved.dayBreakdown,
      };
    });

    // Summary is ALWAYS computed on the full matching employee set (not post-status-filter)
    const summary = {
      total: fullOverview.length,
      present: fullOverview.filter((o) => o.status === AttendanceStatus.PRESENT)
        .length,
      halfDay: fullOverview.filter((o) => o.status === AttendanceStatus.HALF_DAY)
        .length,
      absent: fullOverview.filter((o) => o.status === AttendanceStatus.ABSENT)
        .length,
      leave: fullOverview.filter((o) => o.status === AttendanceStatus.LEAVE)
        .length,
      holiday: fullOverview.filter((o) => o.status === AttendanceStatus.HOLIDAY)
        .length,
      notMarked: fullOverview.filter((o) => o.status === "NOT_MARKED").length,
      checkedIn: fullOverview.filter((o) => o.isCheckedIn).length,
      onBreak: fullOverview.filter((o) => o.isOnBreak).length,
      late: fullOverview.filter((o) => o.isLate).length,
      wfh: fullOverview.filter((o) => o.isWFH).length,
    };

    const overview = status
      ? fullOverview.filter((o) => o.status === status)
      : fullOverview;

    return sendSuccessResponse(res, 200, "Today's attendance overview", {
      date: today,
      dateStr: todayStr,
      isSunday,
      holiday: holiday
        ? { id: holiday.id, name: holiday.name, date: holiday.date }
        : null,
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

/* ═══════════════════════════════════════════════════════════════
   ADMIN — ATTENDANCE HISTORY / MONITOR LIST
═══════════════════════════════════════════════════════════════ */

/**
 * GET /admin/attendance?accountId=&month=&year=&status=&page=&limit=
 */
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

    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const limit = Math.min(5000, Math.max(1, parseInt(limitStr, 10) || 31));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (status) {
      const validStatuses = Object.values(AttendanceStatus);
      if (!validStatuses.includes(status as AttendanceStatus)) {
        return sendErrorResponse(
          res,
          400,
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }
      where.status = status as AttendanceStatus;
    }

    let rangeStart: Date | undefined;
    let rangeEnd: Date | undefined;

    if (month && year) {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      if (isNaN(m) || m < 1 || m > 12 || isNaN(y)) {
        return sendErrorResponse(res, 400, "Invalid month or year");
      }
      const b = getISTMonthBounds(y, m);
      rangeStart = b.start;
      rangeEnd = b.end;
      where.date = { gte: rangeStart, lte: rangeEnd };
    } else if (year) {
      const y = parseInt(year, 10);
      if (isNaN(y)) return sendErrorResponse(res, 400, "Invalid year");
      const b = getISTYearBounds(y);
      rangeStart = b.start;
      rangeEnd = b.end;
      where.date = { gte: rangeStart, lte: rangeEnd };
    }

    const [logs, total, holidays, approvedLeaves, activeAccounts] =
      await Promise.all([
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
                joinedAt: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.attendanceLog.count({ where }),
        rangeStart && rangeEnd
          ? prisma.publicHoliday.findMany({
              where: { date: { gte: rangeStart, lte: rangeEnd } },
              orderBy: { date: "asc" },
            })
          : prisma.publicHoliday.findMany({ orderBy: { date: "asc" } }),
        prisma.leaveRequest.findMany({
          where: {
            status: LeaveStatus.APPROVED,
            ...(accountId ? { accountId } : {}),
            ...(rangeEnd ? { startDate: { lte: rangeEnd } } : {}),
          },
        }),
        prisma.account.findMany({
          where: {
            isActive: true,
            ...(accountId ? { id: accountId } : {}),
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            avatar: true,
            joinedAt: true,
            createdAt: true,
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        }),
      ]);

    const holidayByDate = new Map<string, any>();
    for (const h of holidays) {
      holidayByDate.set(toISTDateStr(h.date), h);
    }

    const leaveByAccountDate = new Map<string, any>();
    for (const lv of approvedLeaves) {
      const s = toISTDateStr(lv.startDate);
      const e = lv.endDate ? toISTDateStr(lv.endDate) : s;
      for (const dStr of enumerateISTDateStrs(s, e)) {
        leaveByAccountDate.set(`${lv.accountId}:${dStr}`, lv);
      }
    }

    const enriched = logs.map((l) => {
      const dStr = toISTDateStr(l.date);
      return enrichAttendanceLogResponse(l, {
        holiday: holidayByDate.get(dStr) ?? null,
        approvedLeave: leaveByAccountDate.get(`${l.accountId}:${dStr}`) ?? null,
      });
    });

    return sendSuccessResponse(res, 200, "Attendance fetched", {
      data: enriched,
      holidays: holidays.map((h) => ({ ...h, dateStr: toISTDateStr(h.date) })),
      approvedLeaves: approvedLeaves.map((lv) => ({
        ...lv,
        startDateStr: toISTDateStr(lv.startDate),
        endDateStr: lv.endDate ? toISTDateStr(lv.endDate) : toISTDateStr(lv.startDate),
      })),
      employees: activeAccounts,
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

/* ═══════════════════════════════════════════════════════════════
   ADMIN — MONTHLY SUMMARY (PRODUCTION HR RULES)
═══════════════════════════════════════════════════════════════ */

/**
 * GET /admin/attendance/summary?month=&year=&accountId=
 * Accurate monthly HR summary per active employee, accounting for:
 * - Sundays & Public Holidays (excluded from working days & leave deductions)
 * - Full-day Present, Half-day Present (0.5), Half-day Leave + Worked (>=3.5h = 1.0 paid),
 *   Half-day Leave Only (0.5 leave + 0.5 absent), Full Leave, Absent (incl. missing past working days)
 * - Late count (after 10:15 AM IST grace), WFH count, Net Work & Break hours, Payable Days.
 */
export async function adminGetAttendanceSummary(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { month, year, accountId } = req.query as Record<string, string>;

    if (!month || !year) {
      return sendErrorResponse(res, 400, "month and year are required");
    }

    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (isNaN(m) || m < 1 || m > 12 || isNaN(y)) {
      return sendErrorResponse(res, 400, "Invalid month or year");
    }

    const { start: from, end: to, days } = getISTMonthBounds(y, m);
    const todayStr = toISTDateStr(new Date());

    const [accounts, logs, holidays, approvedLeaves] = await Promise.all([
      prisma.account.findMany({
        where: {
          isActive: true,
          ...(accountId ? { id: accountId } : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          designation: true,
          avatar: true,
          joinedAt: true,
          createdAt: true,
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      prisma.attendanceLog.findMany({
        where: {
          date: { gte: from, lte: to },
          ...(accountId ? { accountId } : {}),
        },
        include: {
          checkLogs: { orderBy: { checkedAt: "asc" } },
        },
      }),
      prisma.publicHoliday.findMany({
        where: { date: { gte: from, lte: to } },
      }),
      prisma.leaveRequest.findMany({
        where: {
          status: LeaveStatus.APPROVED,
          ...(accountId ? { accountId } : {}),
          startDate: { lte: to },
        },
      }),
    ]);

    const holidayByDate = new Map<string, any>();
    for (const h of holidays) {
      holidayByDate.set(toISTDateStr(h.date), h);
    }

    const logByAccountDate = new Map<string, any>();
    for (const l of logs) {
      const dStr = toISTDateStr(l.date);
      const key = `${l.accountId}:${dStr}`;
      const existing = logByAccountDate.get(key);
      if (
        !existing ||
        new Date(l.date).getTime() === toISTDateOnly(dStr).getTime()
      ) {
        logByAccountDate.set(key, l);
      }
    }

    const leaveByAccountDate = new Map<string, any>();
    for (const lv of approvedLeaves) {
      const s = toISTDateStr(lv.startDate);
      const e = lv.endDate ? toISTDateStr(lv.endDate) : s;
      for (const dStr of enumerateISTDateStrs(s, e)) {
        leaveByAccountDate.set(`${lv.accountId}:${dStr}`, lv);
      }
    }

    const summary = accounts.map((acc) => {
      const joinDateStr = toISTDateStr(acc.joinedAt ?? acc.createdAt);

      let workingDays = 0;
      let present = 0;
      let halfDay = 0;
      let halfDayPresent = 0;
      let halfDayLeaveWorked = 0;
      let halfDayLeaveOnly = 0;
      let absent = 0;
      let leave = 0;
      let holiday = 0;
      let sundayWorked = 0;
      let lateDays = 0;
      let wfhDays = 0;
      let totalWorkMinutes = 0;
      let totalBreakMinutes = 0;
      let payableDays = 0;
      let earnedWorkingCredit = 0;

      for (const dStr of days) {
        if (dStr > todayStr) continue; // Do not count future days
        if (dStr < joinDateStr) continue; // Before employee joined

        const { isSunday } = getISTDayBounds(dStr);
        const pubHoliday = holidayByDate.get(dStr) ?? null;
        const approvedLeave = leaveByAccountDate.get(`${acc.id}:${dStr}`) ?? null;
        const log = logByAccountDate.get(`${acc.id}:${dStr}`) ?? null;

        if (log) {
          totalWorkMinutes += log.totalWorkMinutes ?? 0;
          totalBreakMinutes += log.totalBreakMinutes ?? 0;
          if (log.isWFH) wfhDays++;
        }

        // Resolve day status & breakdown
        const metrics = log
          ? computeAttendanceMetricsFromLogs(log.checkLogs ?? [], Boolean(log.isWFH))
          : null;

        const resolved = resolveAttendanceDayStatus({
          netWorkMinutes: log?.totalWorkMinutes ?? metrics?.totalWorkMinutes ?? 0,
          hasCheckIn: Boolean(metrics?.hasCheckIn || log?.firstCheckIn),
          hasOpenSession: Boolean(log?.hasOpenSession),
          firstCheckIn: log?.firstCheckIn
            ? new Date(log.firstCheckIn)
            : metrics?.firstCheckIn ?? null,
          isSunday,
          holiday: pubHoliday,
          approvedLeave,
          existingLog: log,
        });

        const bd = resolved.dayBreakdown;

        if (isSunday && !bd.isManualOverride) {
          if (bd.dayCategory === "SUNDAY_WORKED") {
            sundayWorked++;
            earnedWorkingCredit += bd.workedCredit;
          }
          continue;
        }

        if (bd.dayCategory === "HOLIDAY") {
          holiday++;
          payableDays += 1;
          continue;
        }

        // It's a working day (Mon–Sat, non-holiday)
        // Skip counting today as ABSENT if the day isn't over yet and no log exists
        const isTodayUnmarked = dStr === todayStr && !log && !approvedLeave;
        if (isTodayUnmarked) {
          continue;
        }

        workingDays++;
        if (bd.isLate) lateDays++;

        switch (bd.dayCategory) {
          case "PRESENT":
            present++;
            payableDays += 1;
            earnedWorkingCredit += 1;
            break;
          case "ACTIVE":
            // Currently checked in today
            present++;
            payableDays += 1;
            earnedWorkingCredit += 1;
            break;
          case "HALF_DAY_PRESENT":
            halfDay++;
            halfDayPresent++;
            payableDays += 0.5;
            earnedWorkingCredit += 0.5;
            absent += 0.5;
            break;
          case "HALF_DAY_LEAVE_AND_WORKED":
            halfDay++;
            halfDayLeaveWorked++;
            payableDays += 1;
            earnedWorkingCredit += 1;
            leave += 0.5;
            break;
          case "HALF_DAY_LEAVE_ONLY":
            halfDay++;
            halfDayLeaveOnly++;
            payableDays += 0.5;
            earnedWorkingCredit += 0.5;
            leave += 0.5;
            absent += 0.5;
            break;
          case "LEAVE":
            leave++;
            payableDays += 1;
            earnedWorkingCredit += 1;
            break;
          case "ABSENT":
          default:
            absent++;
            break;
        }
      }

      const attendanceRate =
        workingDays > 0
          ? Math.min(100, +((earnedWorkingCredit / workingDays) * 100).toFixed(1))
          : 0;

      return {
        account: acc,
        totalDays: workingDays + holiday,
        workingDays,
        present,
        halfDay,
        halfDayPresent,
        halfDayLeaveWorked,
        halfDayLeaveOnly,
        absent: +absent.toFixed(1),
        leave: +leave.toFixed(1),
        holiday,
        sundayWorked,
        lateDays,
        wfhDays,
        payableDays: +payableDays.toFixed(1),
        attendanceRate,
        totalWorkMinutes,
        totalWorkHours: +(totalWorkMinutes / 60).toFixed(2),
        totalBreakMinutes,
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

/* ═══════════════════════════════════════════════════════════════
   ADMIN — MANUAL CHECK-IN / CHECK-OUT / FULL SESSION / CHECKLOG EDIT
═══════════════════════════════════════════════════════════════ */

/**
 * POST /admin/attendance/checkin
 * Admin adds a missed CHECK_IN for any employee on any date.
 */
export async function adminManualCheckIn(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const {
      accountId,
      checkedAt: checkedAtStr,
      date: dateStr,
      isWFH,
      note,
    } = req.body as Record<string, any>;

    if (!accountId) return sendErrorResponse(res, 400, "accountId is required");
    if (!checkedAtStr)
      return sendErrorResponse(res, 400, "checkedAt is required");

    const checkedAt = new Date(checkedAtStr);
    if (isNaN(checkedAt.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkedAt timestamp");

    let targetBounds;
    try {
      targetBounds = getISTDayBounds(dateStr || checkedAt);
    } catch {
      return sendErrorResponse(res, 400, "Invalid date");
    }

    const target = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!target) return sendErrorResponse(res, 404, "Account not found");

    const sessionId = randomUUID();
    const isToday = isSameISTDay(targetBounds.date, new Date());
    const wfhFlag = isWFH === true;

    const result = await prisma.$transaction(async (tx) => {
      let log = await findAttendanceLogForISTDate(
        tx,
        accountId,
        targetBounds.date,
      );

      if (!log) {
        log = await tx.attendanceLog.create({
          data: {
            accountId,
            date: targetBounds.date,
            day: targetBounds.dayName,
            isSunday: targetBounds.isSunday,
            status: AttendanceStatus.PRESENT,
            firstCheckIn: checkedAt,
            hasOpenSession: false,
            isWFH: wfhFlag,
          },
        });
      }

      if (log.hasOpenSession) {
        throw Object.assign(
          new Error("Employee already has an open session for this date."),
          { statusCode: 409 },
        );
      }

      const checkLog = await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt,
          type: CheckType.CHECK_IN,
          source: CheckSource.ADMIN,
          sessionId,
          deviceMeta: { isWFH: wfhFlag },
          note: note?.trim() || "Admin manual check-in",
          editedBy: adminAccountId,
          attendanceLogId: log.id,
        },
      });

      const recomputed = await recomputeAttendanceLogTx(tx, log.id, {
        forceIsWFH: isWFH !== undefined ? Boolean(log.isWFH || wfhFlag) : undefined,
      });

      if (isToday) {
        await tx.account.update({
          where: { id: accountId },
          data: { isAvailable: true },
        });
      }

      return {
        log: enrichAttendanceLogResponse(recomputed.log, {
          holiday: recomputed.holiday,
          approvedLeave: recomputed.approvedLeave,
        }),
        checkLog,
      };
    });

    emit(`notif:${accountId}`, "attendance:admin_checkin", {
      sessionId,
      checkedInAt: result.checkLog.checkedAt,
      note: note ?? "Admin manual check-in",
    });

    if (isToday) {
      try {
        getIo().emit("busy:changed", {
          accountId,
          isBusy: false,
          isAvailable: true,
          source: "ADMIN_CHECKIN",
        });
      } catch (e) {
        console.warn("[adminManualCheckIn] busy:changed emit skipped:", e);
      }
    }

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

/**
 * POST /admin/attendance/checkout
 * Admin adds a missed CHECK_OUT (recomputes net work excluding breaks).
 */
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

    const checkedAt = new Date(checkedAtStr);
    if (isNaN(checkedAt.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkedAt timestamp");

    let targetBounds;
    try {
      targetBounds = getISTDayBounds(dateStr || checkedAt);
    } catch {
      return sendErrorResponse(res, 400, "Invalid date");
    }

    const target = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!target) return sendErrorResponse(res, 404, "Account not found");

    const isToday = isSameISTDay(targetBounds.date, new Date());

    const result = await prisma.$transaction(async (tx) => {
      const log = await findAttendanceLogForISTDate(
        tx,
        accountId,
        targetBounds.date,
        true,
      );

      if (!log) {
        throw Object.assign(new Error("No attendance log for this date."), {
          statusCode: 404,
        });
      }

      const allChecks = log.checkLogs ?? [];
      const metricsBefore = computeAttendanceMetricsFromLogs(
        allChecks,
        log.isWFH,
      );

      const targetSessionId = providedSessionId ?? metricsBefore.openSessionId;

      if (!targetSessionId) {
        throw Object.assign(
          new Error("No open session to pair checkout with."),
          { statusCode: 409 },
        );
      }

      const sessionIn = allChecks.find(
        (c: any) =>
          c.sessionId === targetSessionId && c.type === CheckType.CHECK_IN,
      );
      const sessionOutExists = allChecks.some(
        (c: any) =>
          c.sessionId === targetSessionId && c.type === CheckType.CHECK_OUT,
      );

      if (!sessionIn) {
        throw Object.assign(
          new Error("CHECK_IN for provided sessionId not found."),
          { statusCode: 404 },
        );
      }

      if (sessionOutExists) {
        throw Object.assign(new Error("Session already has a CHECK_OUT."), {
          statusCode: 409,
        });
      }

      if (checkedAt <= new Date(sessionIn.checkedAt)) {
        throw Object.assign(
          new Error("checkedAt must be after the check-in time."),
          { statusCode: 400 },
        );
      }

      // Close any open break on this log cleanly
      if (metricsBefore.openBreakSessionId && metricsBefore.currentBreak) {
        const breakEndAt =
          checkedAt > metricsBefore.currentBreak.startedAt
            ? checkedAt
            : new Date(metricsBefore.currentBreak.startedAt.getTime() + 1000);
        await tx.checkLog.create({
          data: {
            accountId,
            date: log.date,
            checkedAt: breakEndAt,
            type: CheckType.BREAK_END,
            source: CheckSource.AUTO,
            sessionId: metricsBefore.openBreakSessionId,
            editedBy: adminAccountId,
            note: "Auto break end at admin checkout",
            attendanceLogId: log.id,
          },
        });
      }

      const checkOut = await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt,
          type: CheckType.CHECK_OUT,
          source: CheckSource.ADMIN,
          sessionId: targetSessionId,
          note: note?.trim() || "Admin manual check-out",
          editedBy: adminAccountId,
          attendanceLogId: log.id,
        },
      });

      const recomputed = await recomputeAttendanceLogTx(tx, log.id);
      const closedSession = recomputed.metrics.sessions.find(
        (s) => s.sessionId === targetSessionId,
      );

      let stoppedWork = {
        stoppedLeadIds: [] as string[],
        stoppedSupportIds: [] as string[],
      };

      // Only stop active lead/support work if checking out TODAY (don't disrupt live work for past corrections)
      if (isToday) {
        stoppedWork = await stopActiveWorkForAccount(tx, accountId, {
          reason: "ADMIN_CHECKOUT",
          endTime: checkedAt,
          clearAvailability: true,
        });
      }

      return {
        log: enrichAttendanceLogResponse(recomputed.log, {
          holiday: recomputed.holiday,
          approvedLeave: recomputed.approvedLeave,
        }),
        checkOut,
        sessionMinutes: closedSession?.durationMinutes ?? 0,
        stoppedWork,
      };
    });

    emit(`notif:${accountId}`, "attendance:admin_checkout", {
      checkedOutAt: result.checkOut.checkedAt,
      sessionWorkMinutes: result.sessionMinutes,
      totalWorkMinutes: result.log.totalWorkMinutes,
      note: note ?? "Admin manual check-out",
    });

    if (isToday) {
      await emitWorkStoppedEvents({
        accountId,
        stoppedLeadIds: result.stoppedWork.stoppedLeadIds,
        stoppedSupportIds: result.stoppedWork.stoppedSupportIds,
        reason: "ADMIN_CHECKOUT",
        isAvailable: false,
      });
    }

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

/**
 * POST /admin/attendance/session
 * Admin creates a full Check-In + optional Check-Out session on any date.
 * Body: { accountId, date?, checkInAt, checkOutAt?, isWFH?, note? }
 */
export async function adminUpsertSession(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { accountId, date: dateStr, checkInAt, checkOutAt, isWFH, note } =
      req.body as Record<string, any>;

    if (!accountId) return sendErrorResponse(res, 400, "accountId is required");
    if (!checkInAt) return sendErrorResponse(res, 400, "checkInAt is required");

    const checkIn = new Date(checkInAt);
    if (isNaN(checkIn.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkInAt timestamp");

    let checkOut: Date | null = null;
    if (checkOutAt) {
      checkOut = new Date(checkOutAt);
      if (isNaN(checkOut.getTime()))
        return sendErrorResponse(res, 400, "Invalid checkOutAt timestamp");
      if (checkOut <= checkIn)
        return sendErrorResponse(
          res,
          400,
          "checkOutAt must be after checkInAt",
        );
    }

    let targetBounds;
    try {
      targetBounds = getISTDayBounds(dateStr || checkIn);
    } catch {
      return sendErrorResponse(res, 400, "Invalid date");
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) return sendErrorResponse(res, 404, "Account not found");

    const sessionId = randomUUID();
    const isToday = isSameISTDay(targetBounds.date, new Date());
    const wfhFlag = isWFH === true;

    const result = await prisma.$transaction(async (tx) => {
      let log = await findAttendanceLogForISTDate(
        tx,
        accountId,
        targetBounds.date,
      );

      if (!log) {
        log = await tx.attendanceLog.create({
          data: {
            accountId,
            date: targetBounds.date,
            day: targetBounds.dayName,
            isSunday: targetBounds.isSunday,
            status: AttendanceStatus.PRESENT,
            firstCheckIn: checkIn,
            hasOpenSession: false,
            isWFH: wfhFlag,
          },
        });
      }

      if (!checkOut && log.hasOpenSession) {
        throw Object.assign(
          new Error(
            "Employee already has an open session for this date. Provide checkOutAt or close the existing session first.",
          ),
          { statusCode: 409 },
        );
      }

      await tx.checkLog.create({
        data: {
          accountId,
          date: log.date,
          checkedAt: checkIn,
          type: CheckType.CHECK_IN,
          source: CheckSource.ADMIN,
          sessionId,
          deviceMeta: { isWFH: wfhFlag },
          note: note?.trim() || "Admin manual check-in",
          editedBy: adminAccountId,
          attendanceLogId: log.id,
        },
      });

      if (checkOut) {
        await tx.checkLog.create({
          data: {
            accountId,
            date: log.date,
            checkedAt: checkOut,
            type: CheckType.CHECK_OUT,
            source: CheckSource.ADMIN,
            sessionId,
            note: note?.trim() || "Admin manual check-out",
            editedBy: adminAccountId,
            attendanceLogId: log.id,
          },
        });
      }

      const recomputed = await recomputeAttendanceLogTx(tx, log.id, {
        forceIsWFH: isWFH !== undefined ? Boolean(log.isWFH || wfhFlag) : undefined,
      });

      if (isToday && !checkOut) {
        await tx.account.update({
          where: { id: accountId },
          data: { isAvailable: true },
        });
      }

      return enrichAttendanceLogResponse(recomputed.log, {
        holiday: recomputed.holiday,
        approvedLeave: recomputed.approvedLeave,
      });
    });

    emit(`notif:${accountId}`, "attendance:overridden", {
      date: result.date,
      status: result.status,
      overrideNote: result.overrideNote,
    });

    return sendSuccessResponse(res, 201, "Attendance session saved", result);
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to save attendance session",
    );
  }
}

/**
 * PATCH /admin/attendance/checklog/:checkLogId
 * Admin edits an existing CheckLog timestamp/type/breakType/isWFH/note and recomputes parent log.
 */
export async function adminUpdateCheckLog(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { checkLogId } = req.params;
    const { checkedAt: checkedAtStr, type, breakType, note, isWFH } =
      req.body as Record<string, any>;

    const existing = await prisma.checkLog.findUnique({
      where: { id: checkLogId },
    });
    if (!existing) return sendErrorResponse(res, 404, "CheckLog not found");

    let nextCheckedAt = existing.checkedAt;
    if (checkedAtStr !== undefined) {
      const parsed = new Date(checkedAtStr);
      if (isNaN(parsed.getTime()))
        return sendErrorResponse(res, 400, "Invalid checkedAt timestamp");
      nextCheckedAt = parsed;
    }

    const nextType: CheckType = type ?? existing.type;
    if (!Object.values(CheckType).includes(nextType)) {
      return sendErrorResponse(res, 400, "Invalid CheckType");
    }

    let nextBreakType = existing.breakType;
    if (breakType !== undefined) {
      if (breakType === null) nextBreakType = null;
      else if (Object.values(BreakType).includes(breakType))
        nextBreakType = breakType;
      else return sendErrorResponse(res, 400, "Invalid BreakType");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Validate paired session ordering
      if (existing.sessionId && existing.attendanceLogId) {
        const siblings = await tx.checkLog.findMany({
          where: {
            attendanceLogId: existing.attendanceLogId,
            sessionId: existing.sessionId,
            id: { not: existing.id },
          },
        });
        for (const sib of siblings) {
          if (
            nextType === CheckType.CHECK_OUT &&
            sib.type === CheckType.CHECK_IN &&
            nextCheckedAt <= sib.checkedAt
          ) {
            throw Object.assign(
              new Error("Check-out time must be after check-in time."),
              { statusCode: 400 },
            );
          }
          if (
            nextType === CheckType.CHECK_IN &&
            sib.type === CheckType.CHECK_OUT &&
            nextCheckedAt >= sib.checkedAt
          ) {
            throw Object.assign(
              new Error("Check-in time must be before check-out time."),
              { statusCode: 400 },
            );
          }
          if (
            nextType === CheckType.BREAK_END &&
            sib.type === CheckType.BREAK_START &&
            nextCheckedAt <= sib.checkedAt
          ) {
            throw Object.assign(
              new Error("Break end time must be after break start time."),
              { statusCode: 400 },
            );
          }
          if (
            nextType === CheckType.BREAK_START &&
            sib.type === CheckType.BREAK_END &&
            nextCheckedAt >= sib.checkedAt
          ) {
            throw Object.assign(
              new Error("Break start time must be before break end time."),
              { statusCode: 400 },
            );
          }
        }
      }

      const prevMeta =
        existing.deviceMeta && typeof existing.deviceMeta === "object"
          ? (existing.deviceMeta as Record<string, any>)
          : {};

      const updatedCheckLog = await tx.checkLog.update({
        where: { id: checkLogId },
        data: {
          checkedAt: nextCheckedAt,
          type: nextType,
          breakType: nextBreakType,
          source: CheckSource.ADMIN,
          editedBy: adminAccountId,
          ...(note !== undefined ? { note: note?.trim() || null } : {}),
          ...(isWFH !== undefined
            ? { deviceMeta: { ...prevMeta, isWFH: Boolean(isWFH) } }
            : {}),
        },
      });

      let enrichedLog = null;
      if (existing.attendanceLogId) {
        const recomputed = await recomputeAttendanceLogTx(
          tx,
          existing.attendanceLogId,
          { forceIsWFH: isWFH !== undefined ? Boolean(isWFH) : undefined },
        );
        enrichedLog = enrichAttendanceLogResponse(recomputed.log, {
          holiday: recomputed.holiday,
          approvedLeave: recomputed.approvedLeave,
        });
      }

      return { checkLog: updatedCheckLog, log: enrichedLog };
    });

    return sendSuccessResponse(res, 200, "CheckLog updated and log recomputed", result);
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update check log",
    );
  }
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN — OVERRIDE ATTENDANCE STATUS (EXISTING OR NEW DAY)
═══════════════════════════════════════════════════════════════ */

async function applyOverrideTx(
  tx: any,
  params: {
    attendanceLogId: string;
    adminAccountId?: string;
    status?: AttendanceStatus;
    overrideNote?: string;
    clearOverride?: boolean;
    isWFH?: boolean;
    checkInAt?: Date | null;
    checkOutAt?: Date | null;
  },
) {
  const {
    attendanceLogId,
    adminAccountId,
    status,
    overrideNote,
    clearOverride,
    isWFH,
    checkInAt,
    checkOutAt,
  } = params;

  const existing = await tx.attendanceLog.findUnique({
    where: { id: attendanceLogId },
    include: { checkLogs: true },
  });
  if (!existing) {
    throw Object.assign(new Error("Attendance log not found"), {
      statusCode: 404,
    });
  }

  // Optional session creation if admin provided checkInAt/checkOutAt alongside override
  if (checkInAt) {
    const sid = randomUUID();
    await tx.checkLog.create({
      data: {
        accountId: existing.accountId,
        date: existing.date,
        checkedAt: checkInAt,
        type: CheckType.CHECK_IN,
        source: CheckSource.ADMIN,
        sessionId: sid,
        deviceMeta: { isWFH: Boolean(isWFH ?? existing.isWFH) },
        note: overrideNote?.trim() || "Admin override check-in",
        editedBy: adminAccountId,
        attendanceLogId: existing.id,
      },
    });
    if (checkOutAt) {
      await tx.checkLog.create({
        data: {
          accountId: existing.accountId,
          date: existing.date,
          checkedAt: checkOutAt,
          type: CheckType.CHECK_OUT,
          source: CheckSource.ADMIN,
          sessionId: sid,
          note: overrideNote?.trim() || "Admin override check-out",
          editedBy: adminAccountId,
          attendanceLogId: existing.id,
        },
      });
    }
  }

  if (clearOverride) {
    const recomputed = await recomputeAttendanceLogTx(tx, existing.id, {
      clearManualOverride: true,
      forceIsWFH: isWFH,
    });
    return enrichAttendanceLogResponse(recomputed.log, {
      holiday: recomputed.holiday,
      approvedLeave: recomputed.approvedLeave,
    });
  }

  // First recompute metrics if checkLogs were added
  if (checkInAt) {
    await recomputeAttendanceLogTx(tx, existing.id, { forceIsWFH: isWFH });
  }

  const nextStatus = status ?? existing.status;
  const noteToSave =
    overrideNote?.trim() ||
    (isManualAdminOverride(existing) && existing.overrideNote
      ? existing.overrideNote
      : `Overridden by admin: ${nextStatus}`);

  await tx.attendanceLog.update({
    where: { id: existing.id },
    data: {
      ...(status ? { status: nextStatus } : {}),
      overrideNote: noteToSave,
      overrideBy: adminAccountId ?? existing.overrideBy ?? "ADMIN",
      ...(isWFH !== undefined ? { isWFH: Boolean(isWFH) } : {}),
    },
  });

  const recomputed = await recomputeAttendanceLogTx(tx, existing.id, {
    forceIsWFH: isWFH,
  });

  return enrichAttendanceLogResponse(recomputed.log, {
    holiday: recomputed.holiday,
    approvedLeave: recomputed.approvedLeave,
  });
}

/**
 * PATCH /admin/attendance/:id/override
 */
export async function adminOverrideAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { id } = req.params;
    const {
      status,
      overrideNote,
      clearOverride,
      isWFH,
      checkInAt: checkInStr,
      checkOutAt: checkOutStr,
    } = req.body as {
      status?: AttendanceStatus;
      overrideNote?: string;
      clearOverride?: boolean;
      isWFH?: boolean;
      checkInAt?: string;
      checkOutAt?: string;
    };

    if (
      !clearOverride &&
      !status &&
      !overrideNote &&
      isWFH === undefined &&
      !checkInStr
    ) {
      return sendErrorResponse(
        res,
        400,
        "Provide status, overrideNote, clearOverride, or session times",
      );
    }

    if (status) {
      const validStatuses = Object.values(AttendanceStatus);
      if (!validStatuses.includes(status)) {
        return sendErrorResponse(
          res,
          400,
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }
    }

    const checkInAt = checkInStr ? new Date(checkInStr) : null;
    const checkOutAt = checkOutStr ? new Date(checkOutStr) : null;
    if (checkInAt && isNaN(checkInAt.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkInAt");
    if (checkOutAt && isNaN(checkOutAt.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkOutAt");
    if (checkInAt && checkOutAt && checkOutAt <= checkInAt)
      return sendErrorResponse(res, 400, "checkOutAt must be after checkInAt");

    const updated = await prisma.$transaction((tx) =>
      applyOverrideTx(tx, {
        attendanceLogId: id,
        adminAccountId,
        status,
        overrideNote,
        clearOverride,
        isWFH,
        checkInAt,
        checkOutAt,
      }),
    );

    emit(`notif:${updated.accountId}`, "attendance:overridden", {
      date: updated.date,
      status: updated.status,
      overrideNote: updated.overrideNote,
    });

    return sendSuccessResponse(res, 200, "Attendance overridden", updated);
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to override attendance",
    );
  }
}

/**
 * POST /admin/attendance/override
 * Upsert override by { accountId, date } — works even when NO AttendanceLog exists yet!
 */
export async function adminUpsertOverrideAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const {
      accountId,
      date: dateStr,
      status,
      overrideNote,
      clearOverride,
      isWFH,
      checkInAt: checkInStr,
      checkOutAt: checkOutStr,
    } = req.body as {
      accountId: string;
      date: string;
      status?: AttendanceStatus;
      overrideNote?: string;
      clearOverride?: boolean;
      isWFH?: boolean;
      checkInAt?: string;
      checkOutAt?: string;
    };

    if (!accountId || !dateStr) {
      return sendErrorResponse(res, 400, "accountId and date are required");
    }

    if (status) {
      const validStatuses = Object.values(AttendanceStatus);
      if (!validStatuses.includes(status)) {
        return sendErrorResponse(
          res,
          400,
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }
    } else if (!clearOverride && isWFH === undefined && !checkInStr) {
      return sendErrorResponse(res, 400, "status is required");
    }

    let bounds;
    try {
      bounds = getISTDayBounds(dateStr);
    } catch {
      return sendErrorResponse(res, 400, "Invalid date");
    }

    const checkInAt = checkInStr ? new Date(checkInStr) : null;
    const checkOutAt = checkOutStr ? new Date(checkOutStr) : null;
    if (checkInAt && isNaN(checkInAt.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkInAt");
    if (checkOutAt && isNaN(checkOutAt.getTime()))
      return sendErrorResponse(res, 400, "Invalid checkOutAt");
    if (checkInAt && checkOutAt && checkOutAt <= checkInAt)
      return sendErrorResponse(res, 400, "checkOutAt must be after checkInAt");

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });
    if (!account) return sendErrorResponse(res, 404, "Account not found");

    const updated = await prisma.$transaction(async (tx) => {
      let log = await findAttendanceLogForISTDate(tx, accountId, bounds.date);
      if (!log) {
        log = await tx.attendanceLog.create({
          data: {
            accountId,
            date: bounds.date,
            day: bounds.dayName,
            isSunday: bounds.isSunday,
            status: status ?? AttendanceStatus.ABSENT,
            isWFH: Boolean(isWFH),
          },
        });
      }

      return applyOverrideTx(tx, {
        attendanceLogId: log.id,
        adminAccountId,
        status,
        overrideNote,
        clearOverride,
        isWFH,
        checkInAt,
        checkOutAt,
      });
    });

    emit(`notif:${updated.accountId}`, "attendance:overridden", {
      date: updated.date,
      status: updated.status,
      overrideNote: updated.overrideNote,
    });

    return sendSuccessResponse(res, 200, "Attendance overridden", updated);
  } catch (err: any) {
    if (err?.statusCode)
      return sendErrorResponse(res, err.statusCode, err.message);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to override attendance",
    );
  }
}

/**
 * DELETE /admin/attendance/checklog/:checkLogId
 * Deletes a single CheckLog and recomputes all metrics + status from scratch.
 */
export async function adminDeleteCheckLog(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { checkLogId } = req.params;

    const checkLog = await prisma.checkLog.findUnique({
      where: { id: checkLogId },
    });

    if (!checkLog) return sendErrorResponse(res, 404, "CheckLog not found");

    const updatedLog = await prisma.$transaction(async (tx) => {
      await tx.checkLog.delete({ where: { id: checkLogId } });

      if (checkLog.attendanceLogId) {
        const recomputed = await recomputeAttendanceLogTx(
          tx,
          checkLog.attendanceLogId,
        );
        return enrichAttendanceLogResponse(recomputed.log, {
          holiday: recomputed.holiday,
          approvedLeave: recomputed.approvedLeave,
        });
      }
      return null;
    });

    return sendSuccessResponse(res, 200, "CheckLog deleted and log recomputed", {
      deletedId: checkLogId,
      log: updatedLog,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete check log",
    );
  }
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN — LEAVE MANAGEMENT & DECISION OVERRIDE
═══════════════════════════════════════════════════════════════ */

/**
 * GET /admin/attendance/leave?status=&accountId=&from=&to=&page=&limit=
 */
export async function adminGetLeaves(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const {
      status,
      accountId,
      from: fromStr,
      to: toStr,
      page: pageStr = "1",
      limit: limitStr = "20",
    } = req.query as Record<string, string>;

    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (status) {
      const validStatuses = Object.values(LeaveStatus);
      if (!validStatuses.includes(status as LeaveStatus)) {
        return sendErrorResponse(
          res,
          400,
          `status must be one of: ${validStatuses.join(", ")}`,
        );
      }
      where.status = status as LeaveStatus;
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

/**
 * PATCH /admin/attendance/leave/:id
 * Approve or Reject a leave request (supports overriding prior decision when `override: true`).
 * Non-sandwich rule: skips Sundays & Public Holidays when syncing AttendanceLog rows.
 */
export async function adminDecideLeave(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { id } = req.params;
    const { status, decisionReason, override } = req.body as {
      status: LeaveStatus;
      decisionReason?: string;
      override?: boolean;
    };

    if (
      !status ||
      (status !== LeaveStatus.APPROVED && status !== LeaveStatus.REJECTED)
    ) {
      return sendErrorResponse(res, 400, "status must be APPROVED or REJECTED");
    }

    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) return sendErrorResponse(res, 404, "Leave request not found");

    if (leave.status !== LeaveStatus.PENDING && !override) {
      return sendErrorResponse(res, 409, "Leave request is no longer PENDING");
    }

    const todayStr = toISTDateStr(new Date());

    const updated = await prisma.$transaction(async (tx) => {
      const updatedLeave = await tx.leaveRequest.update({
        where: { id },
        data: {
          status,
          decidedBy: adminAccountId,
          decisionReason: decisionReason?.trim() || null,
          decidedAt: new Date(),
        },
        include: {
          account: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      const dateStrs = enumerateISTDateStrs(
        leave.startDate,
        leave.endDate ?? leave.startDate,
      );

      if (status === LeaveStatus.APPROVED) {
        for (const dStr of dateStrs) {
          const bounds = getISTDayBounds(dStr);
          // Non-sandwich rule: never mark Sunday or Public Holiday as LEAVE
          if (bounds.isSunday) continue;
          const pubHoliday = await findHolidayForISTDate(tx, dStr);
          if (pubHoliday) continue;

          const existingLog = await findAttendanceLogForISTDate(
            tx,
            leave.accountId,
            dStr,
          );

          if (!existingLog) {
            const leaveStatus =
              leave.type === LeaveType.HALF_DAY
                ? AttendanceStatus.HALF_DAY
                : AttendanceStatus.LEAVE;
            await tx.attendanceLog.create({
              data: {
                accountId: leave.accountId,
                date: bounds.date,
                day: bounds.dayName,
                isSunday: false,
                status: leaveStatus,
                overrideNote: `Leave approved: ${leave.type}`,
                overrideBy: adminAccountId,
              },
            });
          } else if (!isManualAdminOverride(existingLog)) {
            if (leave.type === LeaveType.HALF_DAY) {
              // Recompute preserves worked minutes and blends with HALF_DAY leave
              await recomputeAttendanceLogTx(tx, existingLog.id);
            } else {
              await tx.attendanceLog.update({
                where: { id: existingLog.id },
                data: {
                  status: AttendanceStatus.LEAVE,
                  overrideNote: `Leave approved: ${leave.type}`,
                  overrideBy: adminAccountId,
                },
              });
            }
          }
        }
      } else if (status === LeaveStatus.REJECTED && leave.status === LeaveStatus.APPROVED) {
        // Reverting a previously approved leave
        for (const dStr of dateStrs) {
          const existingLog = await findAttendanceLogForISTDate(
            tx,
            leave.accountId,
            dStr,
            true,
          );
          if (!existingLog) continue;
          if (!isAutoLeaveNote(existingLog.overrideNote)) continue;

          const hasChecks = (existingLog.checkLogs?.length ?? 0) > 0;
          if (hasChecks) {
            await recomputeAttendanceLogTx(tx, existingLog.id, {
              clearManualOverride: true,
            });
          } else if (dStr >= todayStr) {
            await tx.attendanceLog.delete({ where: { id: existingLog.id } });
          } else {
            await recomputeAttendanceLogTx(tx, existingLog.id, {
              clearManualOverride: true,
            });
          }
        }
      }

      return updatedLeave;
    });

    emit(`notif:${leave.accountId}`, "leave:decided", {
      leaveId: id,
      status,
      decisionReason: decisionReason ?? null,
    });

    triggerLeaveDecidedNotification({
      leaveId: id,
      accountId: leave.accountId,
      status,
    }).catch((err) =>
      console.error("Failed to send leave decided notification:", err),
    );

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
