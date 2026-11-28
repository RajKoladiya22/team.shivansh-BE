import {
  AttendanceStatus,
  CheckSource,
  CheckType,
  LeaveStatus,
  LeaveType,
} from "@prisma/client";

/* ═══════════════════════════════════════════════════════════════
   HR RULES & CONSTANTS (Asia/Kolkata, UTC+05:30)
═══════════════════════════════════════════════════════════════ */

export const IST_TIMEZONE = "Asia/Kolkata";
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 19_800_000 ms (no DST in India)
export const MS_PER_DAY = 86_400_000;

export const HR_RULES = {
  SHIFT_START_HOUR: 10,
  SHIFT_START_MINUTE: 0,
  LATE_GRACE_MINUTES: 15, // On time up to 10:15:59 IST; late from 10:16:00 IST
  SHIFT_END_HOUR: 18,
  SHIFT_END_MINUTE: 0,
  FULL_DAY_MINUTES: 420, // 7h net worked -> PRESENT
  HALF_DAY_BENCHMARK_MINUTES: 240, // 4h standard half-day
  MIN_HALF_DAY_MINUTES: 120, // 2h..419m net worked -> HALF_DAY; < 2h -> ABSENT
  HALF_DAY_LEAVE_WORK_TARGET_MINUTES: 210, // 3.5h+ net worked with HALF_DAY leave -> 1.0 paid day
} as const;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/* ═══════════════════════════════════════════════════════════════
   TIMEZONE-PROOF IST DATE UTILITIES
═══════════════════════════════════════════════════════════════ */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface ISTYMD {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

/**
 * Extract the IST calendar date (year, month, day) from either:
 * - a "YYYY-MM-DD" date-only string (parsed as that exact IST date, never UTC-shifted)
 * - any ISO timestamp string or Date object (converted to Asia/Kolkata)
 */
export function parseDateInputToISTYMD(input: Date | string = new Date()): ISTYMD {
  if (typeof input === "string") {
    const trimmed = input.trim();
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const month = Number(dateOnlyMatch[2]);
      const day = Number(dateOnlyMatch[3]);
      const probe = new Date(Date.UTC(year, month - 1, day));
      if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() + 1 !== month ||
        probe.getUTCDate() !== day
      ) {
        throw new Error(`Invalid calendar date: ${input}`);
      }
      return { year, month, day };
    }
  }

  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${String(input)}`);
  }

  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Return "YYYY-MM-DD" in IST. */
export function toISTDateStr(input: Date | string = new Date()): string {
  const { year, month, day } = parseDateInputToISTYMD(input);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Canonical IST midnight instant in UTC (e.g. 2026-11-28 00:00:00 IST -> 2026-11-27T18:30:00.000Z).
 * Matches how IST servers store `AttendanceLog.date` and `PublicHoliday.date`,
 * regardless of what timezone the Node process runs in.
 */
export function toISTDateOnly(input: Date | string = new Date()): Date {
  const { year, month, day } = parseDateInputToISTYMD(input);
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

/** Return IST day boundaries [00:00:00.000 IST, 23:59:59.999 IST] plus metadata. */
export function getISTDayBounds(input: Date | string = new Date()) {
  const date = toISTDateOnly(input);
  const end = new Date(date.getTime() + MS_PER_DAY - 1);
  const nextDay = new Date(date.getTime() + MS_PER_DAY);
  const istShifted = new Date(date.getTime() + IST_OFFSET_MS);
  const dayOfWeek = istShifted.getUTCDay(); // 0=Sun..6=Sat
  const dayName = WEEKDAY_NAMES[dayOfWeek];
  const isSunday = dayOfWeek === 0;
  const dateStr = `${istShifted.getUTCFullYear()}-${pad2(istShifted.getUTCMonth() + 1)}-${pad2(istShifted.getUTCDate())}`;

  return {
    date,
    start: date,
    end,
    nextDay,
    dayOfWeek,
    dayName,
    isSunday,
    dateStr,
  };
}

/** Construct a specific IST wall-clock instant on the calendar day of `input`. */
export function getISTClockTime(
  input: Date | string,
  hour: number,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const dayStart = toISTDateOnly(input);
  const offsetMs =
    ((hour * 60 + minute) * 60 + second) * 1000 + ms;
  return new Date(dayStart.getTime() + offsetMs);
}

/** Return IST month bounds and enumerated "YYYY-MM-DD" strings for (year, month 1..12). */
export function getISTMonthBounds(year: number, month: number) {
  const startStr = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endStr = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  const start = toISTDateOnly(startStr);
  const end = getISTDayBounds(endStr).end;
  const days: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${year}-${pad2(month)}-${pad2(d)}`);
  }
  return { start, end, startStr, endStr, days, lastDay };
}

/** Return IST year bounds. */
export function getISTYearBounds(year: number) {
  const start = toISTDateOnly(`${year}-01-01`);
  const end = getISTDayBounds(`${year}-12-31`).end;
  return { start, end };
}

/** Enumerate every IST calendar date string "YYYY-MM-DD" in [start, end] inclusive. */
export function enumerateISTDateStrs(
  startInput: Date | string,
  endInput: Date | string,
): string[] {
  const startMs = toISTDateOnly(startInput).getTime();
  const endMs = toISTDateOnly(endInput).getTime();
  if (endMs < startMs) return [];

  const result: string[] = [];
  for (let cur = startMs; cur <= endMs; cur += MS_PER_DAY) {
    result.push(toISTDateStr(new Date(cur)));
  }
  return result;
}

/** Check if two timestamps fall on the same IST calendar date. */
export function isSameISTDay(a: Date | string, b: Date | string): boolean {
  return toISTDateStr(a) === toISTDateStr(b);
}

/** Check lateness against 10:00 AM IST + 15-min grace (late from 10:16:00 IST onwards). */
export function computeLateInfo(firstCheckIn: Date | null | undefined): {
  isLate: boolean;
  lateByMinutes: number;
} {
  if (!firstCheckIn) return { isLate: false, lateByMinutes: 0 };
  const shifted = new Date(firstCheckIn.getTime() + IST_OFFSET_MS);
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const shiftStartMin = HR_RULES.SHIFT_START_HOUR * 60 + HR_RULES.SHIFT_START_MINUTE; // 600
  const graceCutoffMin = shiftStartMin + HR_RULES.LATE_GRACE_MINUTES; // 615 (10:15)

  if (minuteOfDay <= graceCutoffMin) {
    return { isLate: false, lateByMinutes: 0 };
  }
  return {
    isLate: true,
    lateByMinutes: minuteOfDay - shiftStartMin,
  };
}

/* ═══════════════════════════════════════════════════════════════
   SESSION, BREAK & INTERVAL MATH
═══════════════════════════════════════════════════════════════ */

export interface EnrichedSession {
  sessionId: string;
  checkIn: Date | null;
  checkOut: Date | null;
  grossDurationMinutes: number | null;
  durationMinutes: number | null; // net of breaks inside this session
  isOpen: boolean;
  isWFH: boolean;
}

export interface EnrichedBreak {
  sessionId: string;
  breakType: string;
  breakStart: Date | null;
  breakEnd: Date | null;
  durationMinutes: number | null;
  isOpen: boolean;
}

interface TimeInterval {
  start: number;
  end: number;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return [];

  const merged: TimeInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

function sumIntervalMs(intervals: TimeInterval[]): number {
  return intervals.reduce((sum, i) => sum + Math.max(0, i.end - i.start), 0);
}

function intersectionMs(a: TimeInterval[], b: TimeInterval[]): number {
  let total = 0;
  for (const ia of a) {
    for (const ib of b) {
      const s = Math.max(ia.start, ib.start);
      const e = Math.min(ia.end, ib.end);
      if (e > s) total += e - s;
    }
  }
  return total;
}

export function buildSessions(checkLogs: any[]): EnrichedSession[] {
  const ordered = [...checkLogs].sort(
    (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime(),
  );

  const workMap: Record<
    string,
    { sessionId: string; checkIn?: Date; checkOut?: Date; isWFH: boolean }
  > = {};
  const workOrder: string[] = [];
  const breakIntervals: TimeInterval[] = [];
  const breakMap: Record<string, { start?: Date; end?: Date }> = {};

  for (const c of ordered) {
    if (!c.sessionId) continue;
    const t = new Date(c.checkedAt);
    if (c.type === CheckType.CHECK_IN) {
      if (!workMap[c.sessionId]) {
        workMap[c.sessionId] = {
          sessionId: c.sessionId,
          checkIn: t,
          isWFH: Boolean((c.deviceMeta as any)?.isWFH),
        };
        workOrder.push(c.sessionId);
      } else {
        workMap[c.sessionId].checkIn = t;
        if ((c.deviceMeta as any)?.isWFH) workMap[c.sessionId].isWFH = true;
      }
    } else if (c.type === CheckType.CHECK_OUT) {
      if (!workMap[c.sessionId]) {
        workMap[c.sessionId] = { sessionId: c.sessionId, isWFH: false };
        workOrder.push(c.sessionId);
      }
      workMap[c.sessionId].checkOut = t;
    } else if (c.type === CheckType.BREAK_START) {
      if (!breakMap[c.sessionId]) breakMap[c.sessionId] = {};
      breakMap[c.sessionId].start = t;
    } else if (c.type === CheckType.BREAK_END) {
      if (!breakMap[c.sessionId]) breakMap[c.sessionId] = {};
      breakMap[c.sessionId].end = t;
    }
  }

  for (const b of Object.values(breakMap)) {
    if (b.start && b.end && b.end > b.start) {
      breakIntervals.push({ start: b.start.getTime(), end: b.end.getTime() });
    }
  }
  const mergedBreaks = mergeIntervals(breakIntervals);

  return workOrder.map((id) => {
    const s = workMap[id];
    const isOpen = Boolean(s.checkIn && !s.checkOut);
    if (s.checkIn && s.checkOut && s.checkOut > s.checkIn) {
      const workInt: TimeInterval[] = [
        { start: s.checkIn.getTime(), end: s.checkOut.getTime() },
      ];
      const grossMs = s.checkOut.getTime() - s.checkIn.getTime();
      const breakInsideMs = intersectionMs(workInt, mergedBreaks);
      const netMs = Math.max(0, grossMs - breakInsideMs);
      return {
        sessionId: s.sessionId,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        grossDurationMinutes: Math.floor(grossMs / 60_000),
        durationMinutes: Math.floor(netMs / 60_000),
        isOpen: false,
        isWFH: s.isWFH,
      };
    }
    return {
      sessionId: s.sessionId,
      checkIn: s.checkIn ?? null,
      checkOut: s.checkOut ?? null,
      grossDurationMinutes: s.checkIn && s.checkOut ? 0 : null,
      durationMinutes: s.checkIn && s.checkOut ? 0 : null,
      isOpen,
      isWFH: s.isWFH,
    };
  });
}

export function buildBreaks(checkLogs: any[]): EnrichedBreak[] {
  const ordered = [...checkLogs].sort(
    (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime(),
  );
  const map: Record<
    string,
    {
      sessionId: string;
      breakType?: string;
      breakStart?: Date;
      breakEnd?: Date;
    }
  > = {};
  const order: string[] = [];

  for (const c of ordered) {
    if (!c.sessionId) continue;
    if (c.type !== CheckType.BREAK_START && c.type !== CheckType.BREAK_END) {
      continue;
    }
    if (!map[c.sessionId]) {
      map[c.sessionId] = { sessionId: c.sessionId };
      order.push(c.sessionId);
    }
    const t = new Date(c.checkedAt);
    if (c.type === CheckType.BREAK_START) {
      map[c.sessionId].breakStart = t;
      map[c.sessionId].breakType = c.breakType ?? "OTHER";
    }
    if (c.type === CheckType.BREAK_END) {
      map[c.sessionId].breakEnd = t;
    }
  }

  return order.map((id) => {
    const b = map[id];
    const dur =
      b.breakStart && b.breakEnd && b.breakEnd > b.breakStart
        ? Math.floor((b.breakEnd.getTime() - b.breakStart.getTime()) / 60_000)
        : null;
    return {
      sessionId: b.sessionId,
      breakType: b.breakType ?? "OTHER",
      breakStart: b.breakStart ?? null,
      breakEnd: b.breakEnd ?? null,
      durationMinutes: dur,
      isOpen: Boolean(b.breakStart && !b.breakEnd),
    };
  });
}

export function findOpenSessionId(checks: any[]): string | null {
  const map: Record<string, { in?: boolean; out?: boolean }> = {};
  for (const c of checks) {
    if (!c.sessionId) continue;
    if (c.type !== CheckType.CHECK_IN && c.type !== CheckType.CHECK_OUT) continue;
    if (!map[c.sessionId]) map[c.sessionId] = {};
    if (c.type === CheckType.CHECK_IN) map[c.sessionId].in = true;
    if (c.type === CheckType.CHECK_OUT) map[c.sessionId].out = true;
  }
  return Object.entries(map).find(([, v]) => v.in && !v.out)?.[0] ?? null;
}

export function findOpenBreakSessionId(checks: any[]): string | null {
  const map: Record<string, { start?: boolean; end?: boolean }> = {};
  for (const c of checks) {
    if (!c.sessionId) continue;
    if (c.type !== CheckType.BREAK_START && c.type !== CheckType.BREAK_END) continue;
    if (!map[c.sessionId]) map[c.sessionId] = {};
    if (c.type === CheckType.BREAK_START) map[c.sessionId].start = true;
    if (c.type === CheckType.BREAK_END) map[c.sessionId].end = true;
  }
  return Object.entries(map).find(([, v]) => v.start && !v.end)?.[0] ?? null;
}

export interface ComputedLogMetrics {
  firstCheckIn: Date | null;
  lastCheckOut: Date | null;
  grossWorkMinutes: number;
  totalBreakMinutes: number;
  deductedBreakMinutes: number;
  totalWorkMinutes: number;
  hasOpenSession: boolean;
  openSessionId: string | null;
  hasOpenBreak: boolean;
  openBreakSessionId: string | null;
  currentBreak: {
    sessionId: string;
    breakType: string;
    startedAt: Date;
  } | null;
  hasCheckIn: boolean;
  isWFH: boolean;
  sessions: EnrichedSession[];
  breaks: EnrichedBreak[];
}

/**
 * Pure, deterministic calculator of all timing metrics from CheckLog rows.
 * - Merges overlapping closed work intervals & overlapping closed break intervals.
 * - Subtracts intersected break duration from gross worked duration.
 * - Floors once at the end so multi-session rounding drift never loses minutes.
 */
export function computeAttendanceMetricsFromLogs(
  checkLogs: any[],
  existingIsWFH = false,
): ComputedLogMetrics {
  const ordered = [...checkLogs].sort(
    (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime(),
  );

  const sessions = buildSessions(ordered);
  const breaks = buildBreaks(ordered);

  const workIntervals = mergeIntervals(
    sessions
      .filter((s) => s.checkIn && s.checkOut && s.checkOut > s.checkIn)
      .map((s) => ({
        start: s.checkIn!.getTime(),
        end: s.checkOut!.getTime(),
      })),
  );

  const breakIntervals = mergeIntervals(
    breaks
      .filter((b) => b.breakStart && b.breakEnd && b.breakEnd > b.breakStart)
      .map((b) => ({
        start: b.breakStart!.getTime(),
        end: b.breakEnd!.getTime(),
      })),
  );

  const grossMs = sumIntervalMs(workIntervals);
  const totalBreakMs = sumIntervalMs(breakIntervals);
  const deductedBreakMs = intersectionMs(workIntervals, breakIntervals);
  const netWorkMs = Math.max(0, grossMs - deductedBreakMs);

  const checkInEvents = ordered.filter((c) => c.type === CheckType.CHECK_IN);
  const checkOutEvents = ordered.filter((c) => c.type === CheckType.CHECK_OUT);

  const firstCheckIn = checkInEvents[0]?.checkedAt
    ? new Date(checkInEvents[0].checkedAt)
    : null;
  const lastCheckOut = checkOutEvents.length > 0
    ? new Date(checkOutEvents[checkOutEvents.length - 1].checkedAt)
    : null;

  const openSession = sessions.find((s) => s.isOpen) ?? null;
  const openBreak = breaks.find((b) => b.isOpen) ?? null;

  const isWFH =
    existingIsWFH ||
    checkInEvents.some((c) => Boolean((c.deviceMeta as any)?.isWFH));

  return {
    firstCheckIn,
    lastCheckOut,
    grossWorkMinutes: Math.floor(grossMs / 60_000),
    totalBreakMinutes: Math.floor(totalBreakMs / 60_000),
    deductedBreakMinutes: Math.floor(deductedBreakMs / 60_000),
    totalWorkMinutes: Math.floor(netWorkMs / 60_000),
    hasOpenSession: Boolean(openSession),
    openSessionId: openSession?.sessionId ?? null,
    hasOpenBreak: Boolean(openBreak),
    openBreakSessionId: openBreak?.sessionId ?? null,
    currentBreak:
      openBreak && openBreak.breakStart
        ? {
            sessionId: openBreak.sessionId,
            breakType: openBreak.breakType,
            startedAt: openBreak.breakStart,
          }
        : null,
    hasCheckIn: checkInEvents.length > 0,
    isWFH,
    sessions,
    breaks,
  };
}

/* ═══════════════════════════════════════════════════════════════
   HR STATUS & DAY BREAKDOWN RESOLUTION
═══════════════════════════════════════════════════════════════ */

/** Derive raw attendance status purely from net worked minutes. */
export function deriveStatus(netWorkMinutes: number): AttendanceStatus {
  if (netWorkMinutes >= HR_RULES.FULL_DAY_MINUTES) return AttendanceStatus.PRESENT;
  if (netWorkMinutes >= HR_RULES.MIN_HALF_DAY_MINUTES) return AttendanceStatus.HALF_DAY;
  return AttendanceStatus.ABSENT;
}

export function isAutoLeaveNote(note?: string | null): boolean {
  if (!note) return false;
  return note.startsWith("Leave approved:");
}

export function isAutoHolidayNote(note?: string | null): boolean {
  if (!note) return false;
  return note.startsWith("Public holiday:");
}

export function isManualAdminOverride(log?: {
  overrideBy?: string | null;
  overrideNote?: string | null;
} | null): boolean {
  if (!log || !log.overrideBy) return false;
  if (isAutoLeaveNote(log.overrideNote) || isAutoHolidayNote(log.overrideNote)) {
    return false;
  }
  return true;
}

export type DayCategory =
  | "PRESENT"
  | "ACTIVE"
  | "HALF_DAY_PRESENT"
  | "HALF_DAY_LEAVE_AND_WORKED"
  | "HALF_DAY_LEAVE_ONLY"
  | "LEAVE"
  | "HOLIDAY"
  | "WEEKEND"
  | "SUNDAY_WORKED"
  | "ABSENT";

export interface DayBreakdown {
  dayCategory: DayCategory;
  workedCredit: number; // 0 | 0.5 | 1
  leaveCredit: number; // 0 | 0.5 | 1
  holidayCredit: number; // 0 | 1
  absentCredit: number; // 0 | 0.5 | 1
  paidDays: number; // 0 | 0.5 | 1
  isLate: boolean;
  lateByMinutes: number;
  isManualOverride: boolean;
  leaveType: LeaveType | null;
  holidayName: string | null;
}

export interface ResolveStatusParams {
  netWorkMinutes: number;
  hasCheckIn: boolean;
  hasOpenSession: boolean;
  firstCheckIn?: Date | null;
  isSunday: boolean;
  holiday?: { id?: string; name: string } | null;
  approvedLeave?: {
    id?: string;
    type: LeaveType;
    decidedBy?: string | null;
  } | null;
  existingLog?: {
    status: AttendanceStatus;
    overrideBy?: string | null;
    overrideNote?: string | null;
  } | null;
}

export function resolveAttendanceDayStatus(params: ResolveStatusParams): {
  status: AttendanceStatus;
  isManualOverride: boolean;
  overrideNote: string | null;
  overrideBy: string | null;
  dayBreakdown: DayBreakdown;
} {
  const {
    netWorkMinutes,
    hasCheckIn,
    hasOpenSession,
    firstCheckIn,
    isSunday,
    holiday,
    approvedLeave,
    existingLog,
  } = params;

  const manualOverride = isManualAdminOverride(existingLog);
  const { isLate, lateByMinutes } = computeLateInfo(firstCheckIn);
  const holidayName = holiday?.name ?? null;
  const leaveType = approvedLeave?.type ?? null;

  // 1. Explicit Manual Admin Override always wins
  if (manualOverride && existingLog) {
    const status = existingLog.status;
    let dayCategory: DayCategory = "PRESENT";
    let workedCredit = 0;
    let leaveCredit = 0;
    let holidayCredit = 0;
    let absentCredit = 0;
    let paidDays = 0;

    if (status === AttendanceStatus.PRESENT) {
      dayCategory = hasOpenSession ? "ACTIVE" : "PRESENT";
      workedCredit = 1;
      paidDays = 1;
    } else if (status === AttendanceStatus.HALF_DAY) {
      if (approvedLeave?.type === LeaveType.HALF_DAY) {
        leaveCredit = 0.5;
        if (netWorkMinutes >= HR_RULES.HALF_DAY_LEAVE_WORK_TARGET_MINUTES) {
          dayCategory = "HALF_DAY_LEAVE_AND_WORKED";
          workedCredit = 0.5;
          paidDays = 1;
        } else {
          dayCategory = "HALF_DAY_LEAVE_ONLY";
          absentCredit = 0.5;
          paidDays = 0.5;
        }
      } else {
        dayCategory = "HALF_DAY_PRESENT";
        workedCredit = 0.5;
        absentCredit = 0.5;
        paidDays = 0.5;
      }
    } else if (status === AttendanceStatus.LEAVE) {
      dayCategory = "LEAVE";
      leaveCredit = 1;
      paidDays = 1;
    } else if (status === AttendanceStatus.HOLIDAY) {
      dayCategory = "HOLIDAY";
      holidayCredit = 1;
      paidDays = 1;
    } else {
      dayCategory = "ABSENT";
      absentCredit = 1;
      paidDays = 0;
    }

    return {
      status,
      isManualOverride: true,
      overrideNote: existingLog.overrideNote ?? null,
      overrideBy: existingLog.overrideBy ?? null,
      dayBreakdown: {
        dayCategory,
        workedCredit,
        leaveCredit,
        holidayCredit,
        absentCredit,
        paidDays,
        isLate,
        lateByMinutes,
        isManualOverride: true,
        leaveType,
        holidayName,
      },
    };
  }

  // 2. Public Holiday (non-sandwich: holiday stays HOLIDAY even inside a leave range)
  if (holiday) {
    return {
      status: AttendanceStatus.HOLIDAY,
      isManualOverride: false,
      overrideNote: `Public holiday: ${holiday.name}`,
      overrideBy: existingLog?.overrideBy ?? null,
      dayBreakdown: {
        dayCategory: "HOLIDAY",
        workedCredit: 0,
        leaveCredit: 0,
        holidayCredit: 1,
        absentCredit: 0,
        paidDays: 1,
        isLate: false,
        lateByMinutes: 0,
        isManualOverride: false,
        leaveType: null,
        holidayName,
      },
    };
  }

  // 3. Sunday (weekly off; non-sandwich: never marked ABSENT or LEAVE)
  if (isSunday) {
    const workedOnSunday = hasCheckIn || netWorkMinutes > 0;
    const status = hasOpenSession
      ? AttendanceStatus.PRESENT
      : workedOnSunday
        ? deriveStatus(netWorkMinutes)
        : AttendanceStatus.HOLIDAY;
    return {
      status,
      isManualOverride: false,
      overrideNote: existingLog?.overrideNote ?? null,
      overrideBy: existingLog?.overrideBy ?? null,
      dayBreakdown: {
        dayCategory: workedOnSunday ? "SUNDAY_WORKED" : "WEEKEND",
        workedCredit:
          workedOnSunday && netWorkMinutes >= HR_RULES.FULL_DAY_MINUTES
            ? 1
            : workedOnSunday && netWorkMinutes >= HR_RULES.MIN_HALF_DAY_MINUTES
              ? 0.5
              : 0,
        leaveCredit: 0,
        holidayCredit: 0,
        absentCredit: 0,
        paidDays: 1,
        isLate: false,
        lateByMinutes: 0,
        isManualOverride: false,
        leaveType: null,
        holidayName: null,
      },
    };
  }

  // 4. Approved FULL_DAY / MULTI_DAY Leave on a working day
  if (
    approvedLeave &&
    (approvedLeave.type === LeaveType.FULL_DAY ||
      approvedLeave.type === LeaveType.MULTI_DAY)
  ) {
    return {
      status: AttendanceStatus.LEAVE,
      isManualOverride: false,
      overrideNote: `Leave approved: ${approvedLeave.type}`,
      overrideBy: approvedLeave.decidedBy ?? existingLog?.overrideBy ?? null,
      dayBreakdown: {
        dayCategory: "LEAVE",
        workedCredit: 0,
        leaveCredit: 1,
        holidayCredit: 0,
        absentCredit: 0,
        paidDays: 1,
        isLate: false,
        lateByMinutes: 0,
        isManualOverride: false,
        leaveType,
        holidayName: null,
      },
    };
  }

  // 5. Approved HALF_DAY Leave on a working day
  if (approvedLeave && approvedLeave.type === LeaveType.HALF_DAY) {
    if (!hasOpenSession && netWorkMinutes >= HR_RULES.FULL_DAY_MINUTES) {
      // Worked a full 7h+ shift despite half-day leave
      return {
        status: AttendanceStatus.PRESENT,
        isManualOverride: false,
        overrideNote: `Leave approved: ${approvedLeave.type}`,
        overrideBy: approvedLeave.decidedBy ?? existingLog?.overrideBy ?? null,
        dayBreakdown: {
          dayCategory: "PRESENT",
          workedCredit: 1,
          leaveCredit: 0,
          holidayCredit: 0,
          absentCredit: 0,
          paidDays: 1,
          isLate,
          lateByMinutes,
          isManualOverride: false,
          leaveType,
          holidayName: null,
        },
      };
    }

    const workedHalfEnough =
      netWorkMinutes >= HR_RULES.HALF_DAY_LEAVE_WORK_TARGET_MINUTES;

    return {
      status: AttendanceStatus.HALF_DAY,
      isManualOverride: false,
      overrideNote: `Leave approved: ${approvedLeave.type}`,
      overrideBy: approvedLeave.decidedBy ?? existingLog?.overrideBy ?? null,
      dayBreakdown: {
        dayCategory: hasOpenSession
          ? "ACTIVE"
          : workedHalfEnough
            ? "HALF_DAY_LEAVE_AND_WORKED"
            : "HALF_DAY_LEAVE_ONLY",
        workedCredit: workedHalfEnough ? 0.5 : 0,
        leaveCredit: 0.5,
        holidayCredit: 0,
        absentCredit: hasOpenSession || workedHalfEnough ? 0 : 0.5,
        paidDays: workedHalfEnough ? 1 : 0.5,
        isLate,
        lateByMinutes,
        isManualOverride: false,
        leaveType,
        holidayName: null,
      },
    };
  }

  // 6. Normal Working Day (no leave, no holiday, not Sunday)
  if (hasOpenSession) {
    return {
      status: AttendanceStatus.PRESENT,
      isManualOverride: false,
      overrideNote: null,
      overrideBy: null,
      dayBreakdown: {
        dayCategory: "ACTIVE",
        workedCredit: 0,
        leaveCredit: 0,
        holidayCredit: 0,
        absentCredit: 0,
        paidDays: 0,
        isLate,
        lateByMinutes,
        isManualOverride: false,
        leaveType: null,
        holidayName: null,
      },
    };
  }

  if (!hasCheckIn) {
    return {
      status: AttendanceStatus.ABSENT,
      isManualOverride: false,
      overrideNote: null,
      overrideBy: null,
      dayBreakdown: {
        dayCategory: "ABSENT",
        workedCredit: 0,
        leaveCredit: 0,
        holidayCredit: 0,
        absentCredit: 1,
        paidDays: 0,
        isLate: false,
        lateByMinutes: 0,
        isManualOverride: false,
        leaveType: null,
        holidayName: null,
      },
    };
  }

  const derived = deriveStatus(netWorkMinutes);
  if (derived === AttendanceStatus.PRESENT) {
    return {
      status: AttendanceStatus.PRESENT,
      isManualOverride: false,
      overrideNote: null,
      overrideBy: null,
      dayBreakdown: {
        dayCategory: "PRESENT",
        workedCredit: 1,
        leaveCredit: 0,
        holidayCredit: 0,
        absentCredit: 0,
        paidDays: 1,
        isLate,
        lateByMinutes,
        isManualOverride: false,
        leaveType: null,
        holidayName: null,
      },
    };
  }

  if (derived === AttendanceStatus.HALF_DAY) {
    return {
      status: AttendanceStatus.HALF_DAY,
      isManualOverride: false,
      overrideNote: null,
      overrideBy: null,
      dayBreakdown: {
        dayCategory: "HALF_DAY_PRESENT",
        workedCredit: 0.5,
        leaveCredit: 0,
        holidayCredit: 0,
        absentCredit: 0.5,
        paidDays: 0.5,
        isLate,
        lateByMinutes,
        isManualOverride: false,
        leaveType: null,
        holidayName: null,
      },
    };
  }

  return {
    status: AttendanceStatus.ABSENT,
    isManualOverride: false,
    overrideNote: null,
    overrideBy: null,
    dayBreakdown: {
      dayCategory: "ABSENT",
      workedCredit: 0,
      leaveCredit: 0,
      holidayCredit: 0,
      absentCredit: 1,
      paidDays: 0,
      isLate,
      lateByMinutes,
      isManualOverride: false,
      leaveType: null,
      holidayName: null,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   PRISMA DB LOOKUPS & RECOMPUTATION HELPERS
═══════════════════════════════════════════════════════════════ */

/** Find AttendanceLog for an account on a given IST calendar date (handles legacy UTC/IST timestamps). */
export async function findAttendanceLogForISTDate(
  tx: any,
  accountId: string,
  dateInput: Date | string,
  includeCheckLogs = false,
) {
  const { start, end, date } = getISTDayBounds(dateInput);
  const rows = await tx.attendanceLog.findMany({
    where: {
      accountId,
      date: { gte: start, lte: end },
    },
    ...(includeCheckLogs
      ? { include: { checkLogs: { orderBy: { checkedAt: "asc" } } } }
      : {}),
    orderBy: { date: "asc" },
  });

  if (rows.length === 0) return null;
  return (
    rows.find((r: any) => new Date(r.date).getTime() === date.getTime()) ??
    rows[0]
  );
}

/** Find PublicHoliday on a given IST calendar date. */
export async function findHolidayForISTDate(
  tx: any,
  dateInput: Date | string,
) {
  const { start, end } = getISTDayBounds(dateInput);
  return tx.publicHoliday.findFirst({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
}

/** Find APPROVED LeaveRequest for an account covering a given IST calendar date. */
export async function findApprovedLeaveForISTDate(
  tx: any,
  accountId: string,
  dateInput: Date | string,
) {
  const { end, dateStr } = getISTDayBounds(dateInput);
  const candidates = await tx.leaveRequest.findMany({
    where: {
      accountId,
      status: LeaveStatus.APPROVED,
      startDate: { lte: end },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    candidates.find((l: any) => {
      const startStr = toISTDateStr(l.startDate);
      const endStr = l.endDate ? toISTDateStr(l.endDate) : startStr;
      return dateStr >= startStr && dateStr <= endStr;
    }) ?? null
  );
}

/**
 * Close any open work sessions & open breaks on a given AttendanceLog,
 * creating AUTO CHECK_OUT / BREAK_END CheckLog entries, then recompute.
 */
export async function closeOpenSessionsOnLogTx(
  tx: any,
  log: { id: string; accountId: string; date: Date; checkLogs?: any[] },
  defaultCheckOut: Date,
  fallbackCheckOut: Date,
  source: CheckSource = CheckSource.AUTO,
  note = "Auto checkout at 6:00 PM",
  editedBy: string | null = null,
): Promise<Date | null> {
  const checkLogs =
    log.checkLogs ??
    (await tx.checkLog.findMany({
      where: { attendanceLogId: log.id },
      orderBy: { checkedAt: "asc" },
    }));

  const ordered = [...checkLogs].sort(
    (a, b) => new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime(),
  );

  const sessions: Record<string, { checkIn?: Date; checkOut?: Date }> = {};
  const breaks: Record<string, { start?: Date; end?: Date }> = {};

  for (const c of ordered) {
    if (!c.sessionId) continue;
    const t = new Date(c.checkedAt);
    if (c.type === CheckType.CHECK_IN) {
      if (!sessions[c.sessionId]) sessions[c.sessionId] = {};
      sessions[c.sessionId].checkIn = t;
    } else if (c.type === CheckType.CHECK_OUT) {
      if (!sessions[c.sessionId]) sessions[c.sessionId] = {};
      sessions[c.sessionId].checkOut = t;
    } else if (c.type === CheckType.BREAK_START) {
      if (!breaks[c.sessionId]) breaks[c.sessionId] = {};
      breaks[c.sessionId].start = t;
    } else if (c.type === CheckType.BREAK_END) {
      if (!breaks[c.sessionId]) breaks[c.sessionId] = {};
      breaks[c.sessionId].end = t;
    }
  }

  for (const [sessionId, b] of Object.entries(breaks)) {
    if (b.start && !b.end) {
      const effectiveBreakEnd =
        defaultCheckOut > b.start
          ? defaultCheckOut
          : fallbackCheckOut > b.start
            ? fallbackCheckOut
            : new Date(b.start.getTime() + 1000);

      await tx.checkLog.create({
        data: {
          accountId: log.accountId,
          date: log.date,
          checkedAt: effectiveBreakEnd,
          type: CheckType.BREAK_END,
          source,
          sessionId,
          attendanceLogId: log.id,
          editedBy,
          note: "Auto break end at checkout",
        },
      });
    }
  }

  for (const [sessionId, s] of Object.entries(sessions)) {
    if (s.checkIn && !s.checkOut) {
      const effectiveCheckOut =
        defaultCheckOut > s.checkIn
          ? defaultCheckOut
          : fallbackCheckOut > s.checkIn
            ? fallbackCheckOut
            : new Date(s.checkIn.getTime() + 1000);

      await tx.checkLog.create({
        data: {
          accountId: log.accountId,
          date: log.date,
          checkedAt: effectiveCheckOut,
          type: CheckType.CHECK_OUT,
          source,
          sessionId,
          attendanceLogId: log.id,
          editedBy,
          note,
        },
      });
    }
  }

  const recomputed = await recomputeAttendanceLogTx(tx, log.id);
  return recomputed.log.lastCheckOut ?? null;
}

/**
 * Recompute an AttendanceLog's worked/break minutes, check-in/out bounds,
 * open flags, WFH flag, and HR status from its CheckLog rows + holidays + leaves.
 */
export async function recomputeAttendanceLogTx(
  tx: any,
  attendanceLogId: string,
  options: { clearManualOverride?: boolean; forceIsWFH?: boolean } = {},
) {
  const existing = await tx.attendanceLog.findUnique({
    where: { id: attendanceLogId },
    include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
  });

  if (!existing) {
    throw new Error(`AttendanceLog not found: ${attendanceLogId}`);
  }

  const { dayName, isSunday } = getISTDayBounds(existing.date);
  const metrics = computeAttendanceMetricsFromLogs(
    existing.checkLogs,
    options.forceIsWFH !== undefined ? options.forceIsWFH : existing.isWFH,
  );

  const [holiday, approvedLeave] = await Promise.all([
    findHolidayForISTDate(tx, existing.date),
    findApprovedLeaveForISTDate(tx, existing.accountId, existing.date),
  ]);

  const effectiveExistingLog = options.clearManualOverride
    ? { status: existing.status, overrideBy: null, overrideNote: null }
    : existing;

  const resolved = resolveAttendanceDayStatus({
    netWorkMinutes: metrics.totalWorkMinutes,
    hasCheckIn: metrics.hasCheckIn,
    hasOpenSession: metrics.hasOpenSession,
    firstCheckIn: metrics.firstCheckIn,
    isSunday,
    holiday,
    approvedLeave,
    existingLog: effectiveExistingLog,
  });

  const updated = await tx.attendanceLog.update({
    where: { id: attendanceLogId },
    data: {
      day: dayName,
      isSunday,
      firstCheckIn: metrics.firstCheckIn,
      lastCheckOut: metrics.lastCheckOut,
      totalWorkMinutes: metrics.totalWorkMinutes,
      totalBreakMinutes: metrics.totalBreakMinutes,
      hasOpenSession: metrics.hasOpenSession,
      hasOpenBreak: metrics.hasOpenBreak,
      isWFH:
        options.forceIsWFH !== undefined
          ? options.forceIsWFH
          : metrics.isWFH,
      status: resolved.status,
      overrideNote: resolved.overrideNote,
      overrideBy: resolved.overrideBy,
    },
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
  });

  return {
    log: updated,
    metrics,
    holiday,
    approvedLeave,
    resolved,
  };
}

/**
 * Enrich a serialized AttendanceLog (already fetched with checkLogs)
 * with sessions, breaks, lateness, and dayBreakdown without extra DB round-trips.
 */
export function enrichAttendanceLogResponse(
  log: any,
  context: {
    holiday?: { id?: string; name: string } | null;
    approvedLeave?: { id?: string; type: LeaveType; decidedBy?: string | null } | null;
  } = {},
) {
  const checkLogs = log.checkLogs ?? [];
  const metrics = computeAttendanceMetricsFromLogs(checkLogs, Boolean(log.isWFH));
  const { isSunday } = getISTDayBounds(log.date);
  const resolved = resolveAttendanceDayStatus({
    netWorkMinutes: log.totalWorkMinutes ?? metrics.totalWorkMinutes,
    hasCheckIn: metrics.hasCheckIn || Boolean(log.firstCheckIn),
    hasOpenSession: Boolean(log.hasOpenSession),
    firstCheckIn: log.firstCheckIn ? new Date(log.firstCheckIn) : metrics.firstCheckIn,
    isSunday: Boolean(log.isSunday ?? isSunday),
    holiday: context.holiday ?? null,
    approvedLeave: context.approvedLeave ?? null,
    existingLog: {
      status: log.status,
      overrideBy: log.overrideBy,
      overrideNote: log.overrideNote,
    },
  });

  return {
    ...log,
    dateStr: toISTDateStr(log.date),
    sessions: metrics.sessions,
    breaks: metrics.breaks,
    isLate: resolved.dayBreakdown.isLate,
    lateByMinutes: resolved.dayBreakdown.lateByMinutes,
    isManualOverride: resolved.isManualOverride,
    approvedLeave: context.approvedLeave ?? null,
    holiday: context.holiday ?? null,
    dayBreakdown: resolved.dayBreakdown,
  };
}
