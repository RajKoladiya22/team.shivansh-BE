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

export async function autoFinalizeAttendance() {
  const today = toDateOnly();
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

    await prisma.$transaction(async (tx) => {
      const log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId: acc.id, date: today } },
        include: { checkLogs: true },
      });

      // 🟨 Holiday / Approved Leave check
      if (log && (log.status === AttendanceStatus.HOLIDAY || log.status === AttendanceStatus.LEAVE)) {
        stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
          reason: "LEAVE_OR_HOLIDAY",
          endTime: sixPM,
          clearAvailability: true,
        });
        return;
      }

      // 🟨 Approved Leave from LeaveRequest
      const approvedLeave = await tx.leaveRequest.findFirst({
        where: {
          accountId: acc.id,
          status: LeaveStatus.APPROVED,
          startDate: { lte: today },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
      });

      if (approvedLeave) {
        stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
          reason: "APPROVED_LEAVE",
          endTime: sixPM,
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

      // 🔍 Sort logs
      const checkLogs = [...log.checkLogs].sort(
        (a, b) => a.checkedAt.getTime() - b.checkedAt.getTime()
      );

      // 🧠 Build session map
      const sessions: Record<
        string,
        { checkIn?: Date; checkOut?: Date }
      > = {};

      for (const c of checkLogs) {
        if (!c.sessionId) continue;
        if (!sessions[c.sessionId]) sessions[c.sessionId] = {};

        if (c.type === CheckType.CHECK_IN)
          sessions[c.sessionId].checkIn = c.checkedAt;

        if (c.type === CheckType.CHECK_OUT)
          sessions[c.sessionId].checkOut = c.checkedAt;
      }

      // 🔎 Detect open sessions
      const openSessions = Object.entries(sessions)
        .filter(([, s]) => s.checkIn && !s.checkOut)
        .map(([id, s]) => ({
          sessionId: id,
          checkIn: s.checkIn!,
        }));

      // 🟦 Auto close latest open session (always ensure checkout time >= checkIn)
      if (openSessions.length > 0) {
        const lastOpen = openSessions.sort(
          (a, b) => b.checkIn.getTime() - a.checkIn.getTime()
        )[0];

        const effectiveCheckOut =
          sixPM > lastOpen.checkIn ? sixPM : new Date();

        await tx.checkLog.create({
          data: {
            accountId: acc.id,
            date: today,
            checkedAt: effectiveCheckOut,
            type: CheckType.CHECK_OUT,
            source: CheckSource.AUTO,
            sessionId: lastOpen.sessionId,
            attendanceLogId: log.id,
            note: "Auto checkout at 6:00 PM",
          },
        });
      }

      // 🔁 Recalculate total minutes from scratch
      const updatedLogs = await tx.checkLog.findMany({
        where: { attendanceLogId: log.id },
        orderBy: { checkedAt: "asc" },
      });

      const sessionMap: Record<string, { in?: Date; out?: Date }> = {};

      for (const c of updatedLogs) {
        if (!c.sessionId) continue;
        if (!sessionMap[c.sessionId]) sessionMap[c.sessionId] = {};

        if (c.type === CheckType.CHECK_IN)
          sessionMap[c.sessionId].in = c.checkedAt;

        if (c.type === CheckType.CHECK_OUT)
          sessionMap[c.sessionId].out = c.checkedAt;
      }

      let totalMinutes = 0;

      for (const s of Object.values(sessionMap)) {
        if (s.in && s.out) {
          totalMinutes += Math.floor(
            (s.out.getTime() - s.in.getTime()) / 60000
          );
        }
      }

      // 🟥 If no check-in at all → ABSENT
      const hasCheckIn = updatedLogs.some(
        (c) => c.type === CheckType.CHECK_IN
      );

      if (!hasCheckIn) {
        totalMinutes = 0;
      }

      const lastCheckoutLog = updatedLogs
        .filter((c) => c.type === CheckType.CHECK_OUT)
        .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];

      await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenSession: false,
          lastCheckOut: lastCheckoutLog?.checkedAt ?? null,
          totalWorkMinutes: totalMinutes,
          status: hasCheckIn
            ? deriveStatus(totalMinutes)
            : AttendanceStatus.ABSENT,
        },
      });

      // 🛑 Complete active work finalization for Lead & Support
      stoppedWorkResult = await stopActiveWorkForAccount(tx, acc.id, {
        reason: "AUTO_CHECKOUT",
        endTime: lastCheckoutLog?.checkedAt ?? sixPM,
        clearAvailability: true,
      });
    });

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