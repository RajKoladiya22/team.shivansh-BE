import { prisma } from "../../../config/database.config";
import {
  AttendanceStatus,
  CheckSource,
  CheckType,
  LeaveStatus,
} from "@prisma/client";
import {
  stopActiveWorkForAccount,
  emitWorkStoppedEvents,
} from "../../utils/workSession.util";
import { getIo } from "../../utils/socket";

function toDateOnly(date: Date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDayName(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function deriveStatus(totalMinutes: number): AttendanceStatus {
  if (totalMinutes >= 300) return AttendanceStatus.PRESENT;
  if (totalMinutes >= 240) return AttendanceStatus.HALF_DAY;
  return AttendanceStatus.ABSENT;
}

async function finalizeLogOpenSessions(
  tx: any,
  log: { id: string; date: Date; status: AttendanceStatus; checkLogs: any[] },
  accountId: string,
  defaultCheckOut: Date,
  fallbackCheckOut: Date,
  preserveLeaveOrHolidayStatus = false
): Promise<Date | null> {
  const checkLogs = [...log.checkLogs].sort(
    (a, b) => a.checkedAt.getTime() - b.checkedAt.getTime()
  );

  // Build work session map
  const sessions: Record<string, { checkIn?: Date; checkOut?: Date }> = {};
  const breaks: Record<string, { start?: Date; end?: Date }> = {};

  for (const c of checkLogs) {
    if (!c.sessionId) continue;

    if (c.type === CheckType.CHECK_IN || c.type === CheckType.CHECK_OUT) {
      if (!sessions[c.sessionId]) sessions[c.sessionId] = {};
      if (c.type === CheckType.CHECK_IN) sessions[c.sessionId].checkIn = c.checkedAt;
      if (c.type === CheckType.CHECK_OUT) sessions[c.sessionId].checkOut = c.checkedAt;
    }

    if (c.type === ("BREAK_START" as CheckType) || c.type === ("BREAK_END" as CheckType)) {
      if (!breaks[c.sessionId]) breaks[c.sessionId] = {};
      if (c.type === ("BREAK_START" as CheckType)) breaks[c.sessionId].start = c.checkedAt;
      if (c.type === ("BREAK_END" as CheckType)) breaks[c.sessionId].end = c.checkedAt;
    }
  }

  // Close all open breaks
  const openBreaks = Object.entries(breaks)
    .filter(([, b]) => b.start && !b.end)
    .map(([id, b]) => ({ sessionId: id, start: b.start! }));

  for (const ob of openBreaks) {
    const effectiveBreakEnd =
      defaultCheckOut > ob.start
        ? defaultCheckOut
        : fallbackCheckOut > ob.start
          ? fallbackCheckOut
          : ob.start;

    await tx.checkLog.create({
      data: {
        accountId,
        date: log.date,
        checkedAt: effectiveBreakEnd,
        type: "BREAK_END" as CheckType,
        source: CheckSource.AUTO,
        sessionId: ob.sessionId,
        attendanceLogId: log.id,
        note: "Auto break end at checkout",
      },
    });
  }

  // Close all open check-in sessions (always ensure checkout >= checkIn)
  const openSessions = Object.entries(sessions)
    .filter(([, s]) => s.checkIn && !s.checkOut)
    .map(([id, s]) => ({
      sessionId: id,
      checkIn: s.checkIn!,
    }));

  for (const open of openSessions) {
    const effectiveCheckOut =
      defaultCheckOut > open.checkIn
        ? defaultCheckOut
        : fallbackCheckOut > open.checkIn
          ? fallbackCheckOut
          : open.checkIn;

    await tx.checkLog.create({
      data: {
        accountId,
        date: log.date,
        checkedAt: effectiveCheckOut,
        type: CheckType.CHECK_OUT,
        source: CheckSource.AUTO,
        sessionId: open.sessionId,
        attendanceLogId: log.id,
        note: "Auto checkout at 6:00 PM",
      },
    });
  }

  // Recalculate total work & break minutes from scratch
  const updatedLogs = await tx.checkLog.findMany({
    where: { attendanceLogId: log.id },
    orderBy: { checkedAt: "asc" },
  });

  const sessionMap: Record<string, { in?: Date; out?: Date }> = {};
  const breakMap: Record<string, { start?: Date; end?: Date }> = {};

  for (const c of updatedLogs) {
    if (!c.sessionId) continue;
    if (c.type === CheckType.CHECK_IN || c.type === CheckType.CHECK_OUT) {
      if (!sessionMap[c.sessionId]) sessionMap[c.sessionId] = {};
      if (c.type === CheckType.CHECK_IN) sessionMap[c.sessionId].in = c.checkedAt;
      if (c.type === CheckType.CHECK_OUT) sessionMap[c.sessionId].out = c.checkedAt;
    }
    if (c.type === ("BREAK_START" as CheckType) || c.type === ("BREAK_END" as CheckType)) {
      if (!breakMap[c.sessionId]) breakMap[c.sessionId] = {};
      if (c.type === ("BREAK_START" as CheckType)) breakMap[c.sessionId].start = c.checkedAt;
      if (c.type === ("BREAK_END" as CheckType)) breakMap[c.sessionId].end = c.checkedAt;
    }
  }

  let totalMinutes = 0;
  for (const s of Object.values(sessionMap)) {
    if (s.in && s.out) {
      totalMinutes += Math.max(
        0,
        Math.floor((s.out.getTime() - s.in.getTime()) / 60000)
      );
    }
  }

  let totalBreakMinutes = 0;
  for (const b of Object.values(breakMap)) {
    if (b.start && b.end) {
      totalBreakMinutes += Math.max(
        0,
        Math.floor((b.end.getTime() - b.start.getTime()) / 60000)
      );
    }
  }

  const hasCheckIn = updatedLogs.some(
    (c: any) => c.type === CheckType.CHECK_IN
  );

  if (!hasCheckIn) {
    totalMinutes = 0;
  }

  const lastCheckoutLog = updatedLogs
    .filter((c: any) => c.type === CheckType.CHECK_OUT)
    .sort((a: any, b: any) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];

  const nextStatus =
    preserveLeaveOrHolidayStatus &&
    (log.status === AttendanceStatus.HOLIDAY || log.status === AttendanceStatus.LEAVE)
      ? log.status
      : hasCheckIn
        ? deriveStatus(totalMinutes)
        : AttendanceStatus.ABSENT;

  await tx.attendanceLog.update({
    where: { id: log.id },
    data: {
      hasOpenSession: false,
      hasOpenBreak: false,
      lastCheckOut: lastCheckoutLog?.checkedAt ?? null,
      totalWorkMinutes: totalMinutes,
      totalBreakMinutes,
      status: nextStatus,
    },
  });

  return lastCheckoutLog?.checkedAt ?? null;
}

export async function autoFinalizeAttendance() {
  const today = toDateOnly();
  const tomorrow = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1
  );
  const sixPM = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    18,
    0,
    0
  );

  // console.log("Running auto attendance finalizer for:", today);

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  for (const acc of accounts) {
    let stoppedWorkResult: { stoppedLeadIds: string[]; stoppedSupportIds: string[] } = {
      stoppedLeadIds: [],
      stoppedSupportIds: [],
    };

    try {
      await prisma.$transaction(
        async (tx) => {
          const log = await tx.attendanceLog.findUnique({
            where: { accountId_date: { accountId: acc.id, date: today } },
            include: { checkLogs: true },
          });

          // 🟨 Holiday / Approved Leave check on AttendanceLog
          if (
            log &&
            (log.status === AttendanceStatus.HOLIDAY ||
              log.status === AttendanceStatus.LEAVE)
          ) {
            let endTime = sixPM;
            if (log.hasOpenSession || log.hasOpenBreak) {
              const lastCheckOut = await finalizeLogOpenSessions(
                tx,
                log,
                acc.id,
                sixPM,
                new Date(),
                true
              );
              if (lastCheckOut) endTime = lastCheckOut;
            }
            stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
              reason: "LEAVE_OR_HOLIDAY",
              endTime,
              clearAvailability: true,
            });
            return;
          }

          // 🟨 Approved Leave from LeaveRequest (properly scoped to today)
          const approvedLeave = await tx.leaveRequest.findFirst({
            where: {
              accountId: acc.id,
              status: LeaveStatus.APPROVED,
              OR: [
                { startDate: { lte: today }, endDate: { gte: today } },
                { startDate: { gte: today, lt: tomorrow }, endDate: null },
              ],
            },
          });

          if (approvedLeave) {
            let endTime = sixPM;
            if (log && (log.hasOpenSession || log.hasOpenBreak)) {
              const lastCheckOut = await finalizeLogOpenSessions(
                tx,
                log,
                acc.id,
                sixPM,
                new Date(),
                true
              );
              if (lastCheckOut) endTime = lastCheckOut;
            }
            stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
              reason: "APPROVED_LEAVE",
              endTime,
              clearAvailability: true,
            });
            return;
          }

          // 🟥 CASE 1 — No log → mark ABSENT
          if (!log) {
            await tx.attendanceLog.create({
              data: {
                accountId: acc.id,
                date: today,
                day: getDayName(today),
                status: AttendanceStatus.ABSENT,
                totalWorkMinutes: 0,
                hasOpenSession: false,
              },
            });

            stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
              reason: "AUTO_ABSENT",
              endTime: sixPM,
              clearAvailability: true,
            });

            return;
          }

          const lastCheckOut = await finalizeLogOpenSessions(
            tx,
            log,
            acc.id,
            sixPM,
            new Date(),
            false
          );

          // 🛑 Complete active work finalization for Lead & Support
          stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
            reason: "AUTO_CHECKOUT",
            endTime: lastCheckOut ?? sixPM,
            clearAvailability: true,
          });
        },
        { timeout: 15000 }
      );

      // Real-time notifications for stopped work and availability
      if (
        stoppedWorkResult.stoppedLeadIds.length > 0 ||
        stoppedWorkResult.stoppedSupportIds.length > 0
      ) {
        await emitWorkStoppedEvents({
          accountId: acc.id,
          stoppedLeadIds: stoppedWorkResult.stoppedLeadIds,
          stoppedSupportIds: stoppedWorkResult.stoppedSupportIds,
          reason: "AUTO_CHECKOUT",
          isAvailable: false,
        });
      }
    } catch (accErr) {
      console.error(
        `[autoFinalizeAttendance] Failed for account ${acc.id}:`,
        accErr
      );
    }
  }

  // 🧹 STALE OPEN SESSION SWEEP: Close any unclosed sessions from previous days (e.g. Sunday or post-6:55 PM check-ins)
  try {
    const staleLogs = await prisma.attendanceLog.findMany({
      where: {
        date: { lt: today },
        OR: [{ hasOpenSession: true }, { hasOpenBreak: true }],
      },
      include: { checkLogs: true },
    });

    for (const staleLog of staleLogs) {
      try {
        const logDate = toDateOnly(staleLog.date);
        const logSixPM = new Date(
          logDate.getFullYear(),
          logDate.getMonth(),
          logDate.getDate(),
          18,
          0,
          0
        );
        const logEndOfDay = new Date(
          logDate.getFullYear(),
          logDate.getMonth(),
          logDate.getDate(),
          23,
          59,
          59
        );

        await prisma.$transaction(
          async (tx) => {
            await finalizeLogOpenSessions(
              tx,
              staleLog,
              staleLog.accountId,
              logSixPM,
              logEndOfDay,
              true
            );
          },
          { timeout: 15000 }
        );
      } catch (staleErr) {
        console.error(
          `[autoFinalizeAttendance] Failed stale cleanup for log ${staleLog.id}:`,
          staleErr
        );
      }
    }
  } catch (staleSweepErr) {
    console.warn("Stale open session sweep encountered an error:", staleSweepErr);
  }

  // 🛡️ GLOBAL SAFETY SWEEP: Ensure NO lingering active work or availability exists across system
  try {
    // 1. Any remaining active leads
    const danglingLeads = await prisma.lead.findMany({
      where: { isWorking: true },
      select: { id: true },
    });
    for (const dl of danglingLeads) {
      await prisma.lead.update({
        where: { id: dl.id },
        data: { isWorking: false },
      });
      try {
        const io = getIo();
        io.to(`lead:${dl.id}`).emit("lead:patch", { id: dl.id, patch: { isWorking: false } });
        io.to("leads:admin").emit("lead:patch", { id: dl.id, patch: { isWorking: false } });
      } catch {
        // socket ignore
      }
    }

    // 2. Any remaining active supports
    const danglingSupports = await prisma.support.findMany({
      where: { isWorking: true },
    });
    for (const ds of danglingSupports) {
      let addedSeconds = 0;
      if (ds.currentWorkSessionStart) {
        addedSeconds = Math.max(
          0,
          Math.floor((new Date().getTime() - new Date(ds.currentWorkSessionStart).getTime()) / 1000)
        );
      }
      await prisma.support.update({
        where: { id: ds.id },
        data: {
          isWorking: false,
          currentWorkSessionStart: null,
          totalWorkSeconds: { increment: addedSeconds },
        },
      });
      try {
        const io = getIo();
        io.to(`support:${ds.id}`).emit("support:patch", { id: ds.id, patch: { isWorking: false } });
        io.to("supports:admin").emit("support:patch", { id: ds.id, patch: { isWorking: false } });
      } catch {
        // socket ignore
      }
    }

    // 3. Any accounts with isAvailable=true or isBusy=true or activeLeadId!=null
    await prisma.account.updateMany({
      where: {
        OR: [
          { isAvailable: true },
          { isBusy: true },
          { activeLeadId: { not: null } },
        ],
      },
      data: {
        isAvailable: false,
        isBusy: false,
        activeLeadId: null,
      },
    });
  } catch (sweepError) {
    console.warn("Global safety sweep encountered an error:", sweepError);
  }

  // console.log("Auto attendance finalization completed.");
}