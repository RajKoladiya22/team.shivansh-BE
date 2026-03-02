import { prisma } from "../../../config/database.config";
import { AttendanceStatus, CheckSource, CheckType } from "@prisma/client";

function toDateOnly(date: Date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

  console.log("Running auto attendance finalizer for:", today);

  // 1️⃣ Get all active employees
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

      // 🔹 CASE 1: No attendance log → ABSENT
      if (!log) {
        await tx.attendanceLog.create({
          data: {
            accountId: acc.id,
            date: today,
            day: today.toLocaleDateString("en-US", { weekday: "long" }),
            status: AttendanceStatus.ABSENT,
            totalWorkMinutes: 0,
          },
        });
        return;
      }

      // 🔹 Skip if approved leave exists
      const approvedLeave = await tx.leaveRequest.findFirst({
        where: {
          accountId: acc.id,
          status: "APPROVED",
          startDate: { lte: today },
          OR: [
            { endDate: null },
            { endDate: { gte: today } }
          ],
        },
      });

      if (approvedLeave) return;

      // 🔹 CASE 2: Open session → auto checkout at 6 PM
      if (log.hasOpenSession) {
        const openCheckIn = log.checkLogs.find(
          (c) =>
            c.type === CheckType.CHECK_IN &&
            !log.checkLogs.some(
              (o) =>
                o.sessionId === c.sessionId &&
                o.type === CheckType.CHECK_OUT
            )
        );

        if (openCheckIn) {
          const minutesWorked = Math.floor(
            (sixPM.getTime() - openCheckIn.checkedAt.getTime()) / 60000
          );

          await tx.checkLog.create({
            data: {
              accountId: acc.id,
              date: today,
              checkedAt: sixPM,
              type: CheckType.CHECK_OUT,
              source: CheckSource.AUTO,
              sessionId: openCheckIn.sessionId,
              attendanceLogId: log.id,
              note: "Auto checkout at 6:00 PM",
            },
          });

          const newTotal = log.totalWorkMinutes + minutesWorked;

          await tx.attendanceLog.update({
            where: { id: log.id },
            data: {
              hasOpenSession: false,
              lastCheckOut: sixPM,
              totalWorkMinutes: newTotal,
              status:
                newTotal >= 420
                  ? AttendanceStatus.PRESENT
                  : newTotal >= 240
                  ? AttendanceStatus.HALF_DAY
                  : AttendanceStatus.ABSENT,
            },
          });
        }

        return;
      }

      // 🔹 CASE 3: Log exists but no check-in → ABSENT
      const hasCheckIn = log.checkLogs.some(
        (c) => c.type === CheckType.CHECK_IN
      );

      if (!hasCheckIn) {
        await tx.attendanceLog.update({
          where: { id: log.id },
          data: {
            status: AttendanceStatus.ABSENT,
            totalWorkMinutes: 0,
          },
        });
      }
    });
  }

  console.log("Auto attendance finalization completed.");
}