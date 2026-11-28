import assert from "node:assert/strict";
import { AttendanceStatus, CheckType, LeaveType } from "@prisma/client";
import {
  HR_RULES,
  parseDateInputToISTYMD,
  toISTDateStr,
  toISTDateOnly,
  getISTDayBounds,
  getISTClockTime,
  enumerateISTDateStrs,
  computeLateInfo,
  computeAttendanceMetricsFromLogs,
  deriveStatus,
  isManualAdminOverride,
  resolveAttendanceDayStatus,
} from "../attendance.util";

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

runTest("IST date parsing and bounds handle date-only and UTC instants", () => {
  assert.deepEqual(parseDateInputToISTYMD("2026-11-28"), {
    year: 2026,
    month: 11,
    day: 28,
  });

  // Canonical IST midnight 2026-11-28 00:00:00 IST == 2026-11-27T18:30:00.000Z
  const istMidnight = toISTDateOnly("2026-11-28");
  assert.equal(istMidnight.toISOString(), "2026-11-27T18:30:00.000Z");
  assert.equal(toISTDateStr(istMidnight), "2026-11-28");

  // Legacy UTC-midnight row (05:30 AM IST on 2026-11-28) sits inside IST day bounds
  const legacyUtcMidnight = new Date("2026-11-28T00:00:00.000Z");
  const bounds = getISTDayBounds("2026-11-28");
  assert.equal(
    legacyUtcMidnight >= bounds.start && legacyUtcMidnight <= bounds.end,
    true,
  );
  assert.equal(bounds.isSunday, false);
  assert.equal(bounds.dayName, "Saturday");

  // 19:00 UTC on Nov 28 is 00:30 AM IST on Sunday Nov 29
  const sunBounds = getISTDayBounds("2026-11-28T19:00:00.000Z");
  assert.equal(sunBounds.dateStr, "2026-11-29");
  assert.equal(sunBounds.isSunday, true);
  assert.equal(sunBounds.dayName, "Sunday");

  assert.deepEqual(enumerateISTDateStrs("2026-11-28", "2026-11-30"), [
    "2026-11-28",
    "2026-11-29",
    "2026-11-30",
  ]);
});

runTest("Late grace window treats <=10:15 IST on time and >=10:16 IST late", () => {
  const onTimeStart = getISTClockTime("2026-11-28", 10, 0, 0);
  assert.deepEqual(computeLateInfo(onTimeStart), {
    isLate: false,
    lateByMinutes: 0,
  });

  const onGraceBoundary = getISTClockTime("2026-11-28", 10, 15, 59);
  assert.deepEqual(computeLateInfo(onGraceBoundary), {
    isLate: false,
    lateByMinutes: 0,
  });

  const oneMinLate = getISTClockTime("2026-11-28", 10, 16, 0);
  assert.deepEqual(computeLateInfo(oneMinLate), {
    isLate: true,
    lateByMinutes: 16,
  });

  const sixtyFiveMinLate = getISTClockTime("2026-11-28", 11, 5, 0);
  assert.deepEqual(computeLateInfo(sixtyFiveMinLate), {
    isLate: true,
    lateByMinutes: 65,
  });
});

runTest("Session and break interval subtraction + overlapping session merge", () => {
  const day = "2026-11-28";
  const logs = [
    {
      type: CheckType.CHECK_IN,
      sessionId: "s1",
      checkedAt: getISTClockTime(day, 10, 0),
      deviceMeta: { isWFH: true },
    },
    {
      type: CheckType.BREAK_START,
      sessionId: "b1",
      breakType: "LUNCH",
      checkedAt: getISTClockTime(day, 13, 0),
    },
    {
      type: CheckType.BREAK_END,
      sessionId: "b1",
      checkedAt: getISTClockTime(day, 13, 45),
    },
    {
      type: CheckType.CHECK_OUT,
      sessionId: "s1",
      checkedAt: getISTClockTime(day, 18, 0),
    },
  ];

  const metrics = computeAttendanceMetricsFromLogs(logs);
  assert.equal(metrics.grossWorkMinutes, 480);
  assert.equal(metrics.totalBreakMinutes, 45);
  assert.equal(metrics.deductedBreakMinutes, 45);
  assert.equal(metrics.totalWorkMinutes, 435);
  assert.equal(metrics.isWFH, true);
  assert.equal(deriveStatus(metrics.totalWorkMinutes), AttendanceStatus.PRESENT);

  // Break taken BETWEEN two separate work sessions must NOT reduce worked hours twice
  const splitShiftLogs = [
    {
      type: CheckType.CHECK_IN,
      sessionId: "s1",
      checkedAt: getISTClockTime(day, 10, 0),
    },
    {
      type: CheckType.CHECK_OUT,
      sessionId: "s1",
      checkedAt: getISTClockTime(day, 13, 0),
    },
    {
      type: CheckType.BREAK_START,
      sessionId: "b1",
      breakType: "LUNCH",
      checkedAt: getISTClockTime(day, 13, 0),
    },
    {
      type: CheckType.BREAK_END,
      sessionId: "b1",
      checkedAt: getISTClockTime(day, 14, 0),
    },
    {
      type: CheckType.CHECK_IN,
      sessionId: "s2",
      checkedAt: getISTClockTime(day, 14, 0),
    },
    {
      type: CheckType.CHECK_OUT,
      sessionId: "s2",
      checkedAt: getISTClockTime(day, 18, 0),
    },
  ];
  const splitMetrics = computeAttendanceMetricsFromLogs(splitShiftLogs);
  assert.equal(splitMetrics.grossWorkMinutes, 420);
  assert.equal(splitMetrics.totalBreakMinutes, 60);
  assert.equal(splitMetrics.deductedBreakMinutes, 0);
  assert.equal(splitMetrics.totalWorkMinutes, 420);
  assert.equal(deriveStatus(splitMetrics.totalWorkMinutes), AttendanceStatus.PRESENT);

  // Partial overlap: break 13:30..14:30 when shift ended at 14:00 -> only 30m inside work
  const partialOverlapLogs = [
    {
      type: CheckType.CHECK_IN,
      sessionId: "s1",
      checkedAt: getISTClockTime(day, 10, 0),
    },
    {
      type: CheckType.BREAK_START,
      sessionId: "b1",
      breakType: "TEA",
      checkedAt: getISTClockTime(day, 13, 30),
    },
    {
      type: CheckType.CHECK_OUT,
      sessionId: "s1",
      checkedAt: getISTClockTime(day, 14, 0),
    },
    {
      type: CheckType.BREAK_END,
      sessionId: "b1",
      checkedAt: getISTClockTime(day, 14, 30),
    },
  ];
  const partialMetrics = computeAttendanceMetricsFromLogs(partialOverlapLogs);
  assert.equal(partialMetrics.grossWorkMinutes, 240);
  assert.equal(partialMetrics.totalBreakMinutes, 60);
  assert.equal(partialMetrics.deductedBreakMinutes, 30);
  assert.equal(partialMetrics.totalWorkMinutes, 210);
});

runTest("HR thresholds, half-day leave combo, non-sandwich, and overrides", () => {
  assert.equal(deriveStatus(HR_RULES.FULL_DAY_MINUTES), AttendanceStatus.PRESENT);
  assert.equal(deriveStatus(419), AttendanceStatus.HALF_DAY);
  assert.equal(deriveStatus(HR_RULES.MIN_HALF_DAY_MINUTES), AttendanceStatus.HALF_DAY);
  assert.equal(deriveStatus(119), AttendanceStatus.ABSENT);

  // Half-day leave + 3.5h+ work -> 1.0 paid day (0.5 worked + 0.5 leave)
  const halfWorked = resolveAttendanceDayStatus({
    netWorkMinutes: 210,
    hasCheckIn: true,
    hasOpenSession: false,
    firstCheckIn: getISTClockTime("2026-11-28", 10, 5),
    isSunday: false,
    approvedLeave: { id: "l1", type: LeaveType.HALF_DAY, decidedBy: "admin1" },
  });
  assert.equal(halfWorked.status, AttendanceStatus.HALF_DAY);
  assert.equal(halfWorked.dayBreakdown.dayCategory, "HALF_DAY_LEAVE_AND_WORKED");
  assert.equal(halfWorked.dayBreakdown.workedCredit, 0.5);
  assert.equal(halfWorked.dayBreakdown.leaveCredit, 0.5);
  assert.equal(halfWorked.dayBreakdown.absentCredit, 0);
  assert.equal(halfWorked.dayBreakdown.paidDays, 1);

  // Half-day leave + absent for the remaining half -> 0.5 leave + 0.5 absent
  const halfOnly = resolveAttendanceDayStatus({
    netWorkMinutes: 0,
    hasCheckIn: false,
    hasOpenSession: false,
    isSunday: false,
    approvedLeave: { id: "l1", type: LeaveType.HALF_DAY, decidedBy: "admin1" },
  });
  assert.equal(halfOnly.status, AttendanceStatus.HALF_DAY);
  assert.equal(halfOnly.dayBreakdown.dayCategory, "HALF_DAY_LEAVE_ONLY");
  assert.equal(halfOnly.dayBreakdown.leaveCredit, 0.5);
  assert.equal(halfOnly.dayBreakdown.absentCredit, 0.5);
  assert.equal(halfOnly.dayBreakdown.paidDays, 0.5);

  // Half-day leave + full 7h+ shift -> PRESENT (1.0 worked)
  const halfFullWork = resolveAttendanceDayStatus({
    netWorkMinutes: 420,
    hasCheckIn: true,
    hasOpenSession: false,
    firstCheckIn: getISTClockTime("2026-11-28", 10, 0),
    isSunday: false,
    approvedLeave: { id: "l1", type: LeaveType.HALF_DAY, decidedBy: "admin1" },
  });
  assert.equal(halfFullWork.status, AttendanceStatus.PRESENT);
  assert.equal(halfFullWork.dayBreakdown.paidDays, 1);

  // Non-sandwich: holiday beats approved MULTI_DAY leave on that day
  const holidayWinsLeave = resolveAttendanceDayStatus({
    netWorkMinutes: 0,
    hasCheckIn: false,
    hasOpenSession: false,
    isSunday: false,
    holiday: { id: "h1", name: "Founder Day" },
    approvedLeave: { id: "l2", type: LeaveType.MULTI_DAY, decidedBy: "admin1" },
  });
  assert.equal(holidayWinsLeave.status, AttendanceStatus.HOLIDAY);
  assert.equal(holidayWinsLeave.dayBreakdown.holidayCredit, 1);
  assert.equal(holidayWinsLeave.dayBreakdown.leaveCredit, 0);

  // Sunday worked -> SUNDAY_WORKED with PRESENT credit, not late
  const sundayWorked = resolveAttendanceDayStatus({
    netWorkMinutes: 430,
    hasCheckIn: true,
    hasOpenSession: false,
    firstCheckIn: getISTClockTime("2026-11-29", 11, 0),
    isSunday: true,
  });
  assert.equal(sundayWorked.status, AttendanceStatus.PRESENT);
  assert.equal(sundayWorked.dayBreakdown.dayCategory, "SUNDAY_WORKED");
  assert.equal(sundayWorked.dayBreakdown.isLate, false);

  // Auto notes are NOT treated as manual admin overrides; real admin notes ARE
  assert.equal(
    isManualAdminOverride({
      overrideBy: "admin1",
      overrideNote: "Leave approved: FULL_DAY",
    }),
    false,
  );
  assert.equal(
    isManualAdminOverride({
      overrideBy: "admin1",
      overrideNote: "Public holiday: Diwali",
    }),
    false,
  );
  assert.equal(
    isManualAdminOverride({
      overrideBy: "admin1",
      overrideNote: "Approved client travel",
    }),
    true,
  );

  // Manual override beats holiday / leave / 0 minutes
  const manualWins = resolveAttendanceDayStatus({
    netWorkMinutes: 0,
    hasCheckIn: false,
    hasOpenSession: false,
    isSunday: false,
    holiday: { id: "h1", name: "Founder Day" },
    existingLog: {
      status: AttendanceStatus.PRESENT,
      overrideBy: "admin1",
      overrideNote: "Special Duty",
    },
  });
  assert.equal(manualWins.status, AttendanceStatus.PRESENT);
  assert.equal(manualWins.isManualOverride, true);
  assert.equal(manualWins.dayBreakdown.paidDays, 1);
});

console.log("All backend attendance HR utility tests completed.");
