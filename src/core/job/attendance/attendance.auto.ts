
import { prisma } from "../../../config/database.config";
import {
  AttendanceStatus,
  CheckSource,
  CheckType,
  LeaveStatus,
} from "@prisma/client";

function toDateOnly(date: Date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDayName(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function deriveStatus(totalMinutes: number): AttendanceStatus {
  if (totalMinutes >= 420) return AttendanceStatus.PRESENT;
  if (totalMinutes >= 240) return AttendanceStatus.HALF_DAY;
  return AttendanceStatus.ABSENT;
}

export async function autoFinalizeAttendance() {
  const today = toDateOnly();
  const sixPM = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    17,
    30,
    0
  );

  console.log("Running auto attendance finalizer for:", today);

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  for (const acc of accounts) {
    await prisma.$transaction(async (tx) => {
      const log = await tx.attendanceLog.findUnique({
        where: { accountId_date: { accountId: acc.id, date: today } },
        include: { checkLogs: true },
      });

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

        await tx.account.update({
          where: { id: acc.id },
          data: { isAvailable: false, isBusy: false },
        });

        return;
      }

      // 🟨 Skip if approved leave
      const approvedLeave = await tx.leaveRequest.findFirst({
        where: {
          accountId: acc.id,
          status: LeaveStatus.APPROVED,
          startDate: { lte: today },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
      });

      if (approvedLeave) return;

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

      // 🟦 Auto close latest open session
      if (openSessions.length > 0) {
        const lastOpen = openSessions.sort(
          (a, b) => b.checkIn.getTime() - a.checkIn.getTime()
        )[0];

        if (sixPM > lastOpen.checkIn) {
          await tx.checkLog.create({
            data: {
              accountId: acc.id,
              date: today,
              checkedAt: sixPM,
              type: CheckType.CHECK_OUT,
              source: CheckSource.AUTO,
              sessionId: lastOpen.sessionId,
              attendanceLogId: log.id,
              note: "Auto checkout at 6:45 PM",
            },
          });
        }
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

      await tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          hasOpenSession: false,
          lastCheckOut:
            totalMinutes > 0 ? sixPM : log.lastCheckOut ?? null,
          totalWorkMinutes: totalMinutes,
          status: hasCheckIn
            ? deriveStatus(totalMinutes)
            : AttendanceStatus.ABSENT,
        },
      });

      await tx.account.update({
        where: { id: acc.id },
        data: {
          isAvailable: false,
          isBusy: false,
        },
      });
    });
  }

  console.log("Auto attendance finalization completed.");
}