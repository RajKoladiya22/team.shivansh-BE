// src/core/job/attendance/attendance.auto.ts
import { prisma } from "../../../config/database.config";
import { AttendanceStatus, CheckSource, LeaveType } from "@prisma/client";
import {
  getISTDayBounds,
  getISTClockTime,
  toISTDateStr,
  findAttendanceLogForISTDate,
  findHolidayForISTDate,
  findApprovedLeaveForISTDate,
  closeOpenSessionsOnLogTx,
  recomputeAttendanceLogTx,
  isManualAdminOverride,
} from "../../utils/attendance.util";
import { stopActiveWorkForAccount } from "../../utils/workSession.util";

export async function autoFinalizeAttendance(): Promise<void> {
  const now = new Date();
  const { date: today, start: todayStart, dayName, isSunday, dateStr } =
    getISTDayBounds(now);

  // Default auto-checkout ceiling is 6:00 PM IST on the target date;
  // fallback (for late-evening check-ins) is the cron execution timestamp.
  const defaultCheckOut = getISTClockTime(now, 18, 0, 0, 0);
  const fallbackCheckOut = now;

  console.log(
    `[autoFinalizeAttendance] Running for ${dateStr} (${dayName}, Sunday=${isSunday}) at ${now.toISOString()}`,
  );

  try {
    const todayHoliday = await findHolidayForISTDate(prisma, today);

    const activeAccounts = await prisma.account.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });

    for (const acc of activeAccounts) {
      try {
        await prisma.$transaction(async (tx) => {
          const existing = await findAttendanceLogForISTDate(
            tx,
            acc.id,
            today,
            true,
          );

          // ── Case 1: Public Holiday ──────────────────────────────
          if (todayHoliday) {
            if (existing) {
              if (existing.hasOpenSession || existing.hasOpenBreak) {
                await closeOpenSessionsOnLogTx(
                  tx,
                  existing,
                  defaultCheckOut,
                  fallbackCheckOut,
                  CheckSource.AUTO,
                  "Auto checkout at 6:00 PM (Public Holiday)",
                );
              } else if (!isManualAdminOverride(existing)) {
                await recomputeAttendanceLogTx(tx, existing.id);
              }
            } else {
              await tx.attendanceLog.create({
                data: {
                  accountId: acc.id,
                  date: today,
                  day: dayName,
                  isSunday,
                  status: AttendanceStatus.HOLIDAY,
                  totalWorkMinutes: 0,
                  totalBreakMinutes: 0,
                  hasOpenSession: false,
                  hasOpenBreak: false,
                  overrideNote: `Public holiday: ${todayHoliday.name}`,
                },
              });
            }

            await stopActiveWorkForAccount(tx, acc.id, {
              reason: "AUTO_FINALIZE_HOLIDAY",
              endTime: defaultCheckOut,
            });
            return;
          }

          // ── Case 2: Sunday (weekly off; never mark ABSENT) ──────
          if (isSunday) {
            if (existing) {
              if (existing.hasOpenSession || existing.hasOpenBreak) {
                await closeOpenSessionsOnLogTx(
                  tx,
                  existing,
                  defaultCheckOut,
                  fallbackCheckOut,
                  CheckSource.AUTO,
                  "Auto checkout at 6:00 PM (Sunday)",
                );
              } else if (!isManualAdminOverride(existing)) {
                await recomputeAttendanceLogTx(tx, existing.id);
              }
            }

            await stopActiveWorkForAccount(tx, acc.id, {
              reason: "AUTO_FINALIZE_SUNDAY",
              endTime: defaultCheckOut,
            });
            return;
          }

          // ── Case 3: Normal Mon-Sat Working Day ──────────────────
          const approvedLeave = await findApprovedLeaveForISTDate(
            tx,
            acc.id,
            today,
          );

          if (!existing) {
            if (approvedLeave) {
              const status =
                approvedLeave.type === LeaveType.HALF_DAY
                  ? AttendanceStatus.HALF_DAY
                  : AttendanceStatus.LEAVE;

              await tx.attendanceLog.create({
                data: {
                  accountId: acc.id,
                  date: today,
                  day: dayName,
                  isSunday: false,
                  status,
                  totalWorkMinutes: 0,
                  totalBreakMinutes: 0,
                  hasOpenSession: false,
                  hasOpenBreak: false,
                  overrideNote: `Leave approved: ${approvedLeave.type}`,
                  overrideBy: approvedLeave.decidedBy ?? null,
                },
              });
            } else {
              await tx.attendanceLog.create({
                data: {
                  accountId: acc.id,
                  date: today,
                  day: dayName,
                  isSunday: false,
                  status: AttendanceStatus.ABSENT,
                  totalWorkMinutes: 0,
                  totalBreakMinutes: 0,
                  hasOpenSession: false,
                  hasOpenBreak: false,
                },
              });
            }
          } else if (existing.hasOpenSession || existing.hasOpenBreak) {
            await closeOpenSessionsOnLogTx(
              tx,
              existing,
              defaultCheckOut,
              fallbackCheckOut,
              CheckSource.AUTO,
              "Auto checkout at 6:00 PM",
            );
          } else if (!isManualAdminOverride(existing)) {
            await recomputeAttendanceLogTx(tx, existing.id);
          }

          await stopActiveWorkForAccount(tx, acc.id, {
            reason: "AUTO_FINALIZE_EOD",
            endTime: defaultCheckOut,
          });
        });
      } catch (err) {
        console.error(
          `[autoFinalizeAttendance] Failed for account ${acc.id}:`,
          err,
        );
      }
    }

    // ── Stale Open Session / Break Cleanup (previous IST days) ────
    const staleOpenLogs = await prisma.attendanceLog.findMany({
      where: {
        date: { lt: todayStart },
        OR: [{ hasOpenSession: true }, { hasOpenBreak: true }],
      },
      include: { checkLogs: { orderBy: { checkedAt: "asc" } } },
    });

    for (const staleLog of staleOpenLogs) {
      try {
        const staleDefaultOut = getISTClockTime(staleLog.date, 18, 0, 0, 0);
        const staleFallbackOut = getISTDayBounds(staleLog.date).end;

        await prisma.$transaction(async (tx) => {
          await closeOpenSessionsOnLogTx(
            tx,
            staleLog,
            staleDefaultOut,
            staleFallbackOut,
            CheckSource.AUTO,
            "Auto checkout (missed checkout cleanup)",
          );

          await stopActiveWorkForAccount(tx, staleLog.accountId, {
            reason: `AUTO_FINALIZE_STALE_${toISTDateStr(staleLog.date)}`,
            endTime: staleDefaultOut,
          });
        });
      } catch (err) {
        console.error(
          `[autoFinalizeAttendance] Failed stale cleanup for log ${staleLog.id}:`,
          err,
        );
      }
    }

    // ── Safety Sweep: clear dangling busy flags with no open session ──
    const stillBusyAccounts = await prisma.account.findMany({
      where: {
        isActive: true,
        OR: [{ isBusy: true }, { activeLeadId: { not: null } }],
      },
      select: { id: true },
    });

    for (const busyAcc of stillBusyAccounts) {
      try {
        const openLog = await prisma.attendanceLog.findFirst({
          where: { accountId: busyAcc.id, hasOpenSession: true },
          select: { id: true },
        });
        if (!openLog) {
          await prisma.$transaction(async (tx) => {
            await stopActiveWorkForAccount(tx, busyAcc.id, {
              reason: "AUTO_FINALIZE_SAFETY_SWEEP",
              endTime: fallbackCheckOut,
            });
          });
        }
      } catch (err) {
        console.error(
          `[autoFinalizeAttendance] Failed safety sweep for ${busyAcc.id}:`,
          err,
        );
      }
    }

    console.log(
      `[autoFinalizeAttendance] Completed for ${dateStr}: ${activeAccounts.length} accounts processed, ${staleOpenLogs.length} stale logs cleaned.`,
    );
  } catch (err) {
    console.error("[autoFinalizeAttendance] Fatal error:", err);
  }
}
