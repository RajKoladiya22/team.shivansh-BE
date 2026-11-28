// src/controller/admin/holiday.controller.ts
import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import { getIo } from "../../core/utils/socket";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { AttendanceStatus } from "@prisma/client";
import {
  findAttendanceLogForISTDate,
  findHolidayForISTDate,
  getISTDayBounds,
  getISTMonthBounds,
  getISTYearBounds,
  isManualAdminOverride,
  parseDateInputToISTYMD,
  recomputeAttendanceLogTx,
  toISTDateOnly,
  toISTDateStr,
} from "../../core/utils/attendance.util";

/* ===============================================================
   INTERNAL HELPERS
   =============================================================== */

function emit(room: string, event: string, data: unknown) {
  try {
    getIo().to(room).emit(event, data);
  } catch {
    // socket not initialized in test/migration contexts
  }
}

function assertAdmin(req: Request, res: Response): boolean {
  if (!req.user?.roles?.includes?.("ADMIN")) {
    sendErrorResponse(res, 403, "Admin access required");
    return false;
  }
  return true;
}

/* ===============================================================
   CORE — mark / unmark holiday on AttendanceLog rows
   =============================================================== */

async function markHolidayForAllAccounts(
  dateInput: Date | string,
  holidayName: string,
  adminAccountId: string | undefined,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<{ upserted: number; skipped: number }> {
  const { date, dayName, isSunday, start, end } = getISTDayBounds(dateInput);

  const activeAccounts = await tx.account.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  let upserted = 0;
  let skipped = 0;

  for (const { id: accountId } of activeAccounts) {
    const existingLog = await findAttendanceLogForISTDate(tx, accountId, date);

    if (existingLog) {
      // Do not overwrite manual admin overrides or employees with actual check events
      const hasChecks = await tx.checkLog.count({
        where: { attendanceLogId: existingLog.id },
      });
      if (hasChecks > 0 || isManualAdminOverride(existingLog)) {
        skipped++;
        continue;
      }

      await tx.attendanceLog.update({
        where: { id: existingLog.id },
        data: {
          status: AttendanceStatus.HOLIDAY,
          overrideNote: `Public holiday: ${holidayName}`,
          overrideBy: adminAccountId ?? existingLog.overrideBy,
        },
      });
      upserted++;
      continue;
    }

    const hasChecks = await tx.checkLog.count({
      where: { accountId, date: { gte: start, lte: end } },
    });
    if (hasChecks > 0) {
      skipped++;
      continue;
    }

    await tx.attendanceLog.create({
      data: {
        accountId,
        date,
        day: dayName,
        isSunday,
        status: AttendanceStatus.HOLIDAY,
        overrideNote: `Public holiday: ${holidayName}`,
        overrideBy: adminAccountId,
      },
    });

    upserted++;
  }

  return { upserted, skipped };
}

async function revertHolidayForDate(
  dateInput: Date | string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<{ deleted: number; untouched: number }> {
  const { start, end } = getISTDayBounds(dateInput);
  const logs = await tx.attendanceLog.findMany({
    where: {
      date: { gte: start, lte: end },
      status: AttendanceStatus.HOLIDAY,
    },
    select: { id: true, accountId: true, overrideNote: true, overrideBy: true },
  });

  let deleted = 0;
  let untouched = 0;

  for (const log of logs) {
    if (isManualAdminOverride(log)) {
      untouched++;
      continue;
    }

    const hasChecks = await tx.checkLog.count({
      where: { attendanceLogId: log.id },
    });

    if (hasChecks > 0) {
      await recomputeAttendanceLogTx(tx, log.id, { clearManualOverride: true });
      untouched++;
      continue;
    }

    await tx.attendanceLog.delete({ where: { id: log.id } });
    deleted++;
  }

  return { deleted, untouched };
}

/* ===============================================================
   GET /admin/holidays?year=&month=&upcoming=true
   =============================================================== */
export async function adminGetHolidays(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const {
      year: yearStr,
      month: monthStr,
      upcoming,
    } = req.query as Record<string, string>;

    const where: any = {};

    if (upcoming === "true") {
      const { start: today } = getISTDayBounds();
      const { year: curYear } = parseDateInputToISTYMD();
      const { end: endOfYear } = getISTYearBounds(curYear);
      where.date = { gte: today, lte: endOfYear };
    } else if (yearStr) {
      const y = parseInt(yearStr, 10);
      if (isNaN(y)) return sendErrorResponse(res, 400, "Invalid year");

      if (monthStr) {
        const m = parseInt(monthStr, 10);
        if (isNaN(m) || m < 1 || m > 12)
          return sendErrorResponse(res, 400, "Invalid month (1–12)");
        const b = getISTMonthBounds(y, m);
        where.date = { gte: b.start, lte: b.end };
      } else {
        const b = getISTYearBounds(y);
        where.date = { gte: b.start, lte: b.end };
      }
    } else {
      const { year: y } = parseDateInputToISTYMD();
      const b = getISTYearBounds(y);
      where.date = { gte: b.start, lte: b.end };
    }

    const holidays = await prisma.publicHoliday.findMany({
      where,
      orderBy: { date: "asc" },
    });

    return sendSuccessResponse(res, 200, "Public holidays fetched", {
      total: holidays.length,
      data: holidays.map((h) => ({ ...h, dateStr: toISTDateStr(h.date) })),
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch holidays",
    );
  }
}

/* ===============================================================
   GET /admin/holidays/:id
   =============================================================== */
export async function adminGetHolidayById(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { id } = req.params;

    const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
    if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

    const { start, end } = getISTDayBounds(holiday.date);
    const markedCount = await prisma.attendanceLog.count({
      where: {
        date: { gte: start, lte: end },
        status: AttendanceStatus.HOLIDAY,
      },
    });

    return sendSuccessResponse(res, 200, "Holiday fetched", {
      ...holiday,
      dateStr: toISTDateStr(holiday.date),
      markedEmployeeCount: markedCount,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to fetch holiday",
    );
  }
}

/* ===============================================================
   POST /admin/holidays
   =============================================================== */
export async function adminCreateHoliday(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const {
      date: dateStr,
      name,
      description,
      isRecurring = false,
    } = req.body as Record<string, any>;

    if (!dateStr) return sendErrorResponse(res, 400, "date is required");
    if (!name?.trim()) return sendErrorResponse(res, 400, "name is required");

    let date: Date;
    try {
      date = toISTDateOnly(dateStr);
    } catch {
      return sendErrorResponse(res, 400, "Invalid date format");
    }

    const existing = await findHolidayForISTDate(prisma, date);
    if (existing) {
      return sendErrorResponse(
        res,
        409,
        `A holiday already exists on ${toISTDateStr(date)}: "${existing.name}"`,
      );
    }

    const { holiday, markedCount, skippedCount } = await prisma.$transaction(
      async (tx) => {
        const created = await tx.publicHoliday.create({
          data: {
            date,
            name: name.trim(),
            description: description?.trim() ?? null,
            isRecurring: Boolean(isRecurring),
            createdBy: adminAccountId,
          },
        });

        const { upserted, skipped } = await markHolidayForAllAccounts(
          date,
          created.name,
          adminAccountId,
          tx,
        );

        return {
          holiday: created,
          markedCount: upserted,
          skippedCount: skipped,
        };
      },
    );

    emit("broadcast", "holiday:created", {
      date: holiday.date,
      dateStr: toISTDateStr(holiday.date),
      name: holiday.name,
    });

    return sendSuccessResponse(res, 201, "Holiday created", {
      holiday: { ...holiday, dateStr: toISTDateStr(holiday.date) },
      attendanceMarked: markedCount,
      attendanceSkipped: skippedCount,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to create holiday",
    );
  }
}

/* ===============================================================
   POST /admin/holidays/bulk
   =============================================================== */
export async function adminBulkCreateHolidays(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { holidays: items } = req.body as {
      holidays: Array<{
        date: string;
        name: string;
        description?: string;
        isRecurring?: boolean;
      }>;
    };

    if (!Array.isArray(items) || items.length === 0)
      return sendErrorResponse(
        res,
        400,
        "holidays array is required and must be non-empty",
      );

    if (items.length > 100)
      return sendErrorResponse(res, 400, "Maximum 100 holidays per bulk call");

    const results: {
      date: string;
      name: string;
      status: "created" | "duplicate" | "invalid";
      attendanceMarked?: number;
      attendanceSkipped?: number;
      reason?: string;
    }[] = [];

    for (const item of items) {
      if (!item.date || !item.name?.trim()) {
        results.push({
          date: item.date ?? "unknown",
          name: item.name ?? "unknown",
          status: "invalid",
          reason: "date and name are required",
        });
        continue;
      }

      let date: Date;
      try {
        date = toISTDateOnly(item.date);
      } catch {
        results.push({
          date: item.date,
          name: item.name,
          status: "invalid",
          reason: "Invalid date format",
        });
        continue;
      }

      const existing = await findHolidayForISTDate(prisma, date);
      if (existing) {
        results.push({
          date: item.date,
          name: item.name,
          status: "duplicate",
          reason: `Already exists as "${existing.name}"`,
        });
        continue;
      }

      const { markedCount, skippedCount } = await prisma.$transaction(
        async (tx) => {
          await tx.publicHoliday.create({
            data: {
              date,
              name: item.name.trim(),
              description: item.description?.trim() ?? null,
              isRecurring: Boolean(item.isRecurring ?? false),
              createdBy: adminAccountId,
            },
          });

          const { upserted, skipped } = await markHolidayForAllAccounts(
            date,
            item.name.trim(),
            adminAccountId,
            tx,
          );

          return { markedCount: upserted, skippedCount: skipped };
        },
      );

      results.push({
        date: item.date,
        name: item.name.trim(),
        status: "created",
        attendanceMarked: markedCount,
        attendanceSkipped: skippedCount,
      });
    }

    const created = results.filter((r) => r.status === "created").length;
    const duplicates = results.filter((r) => r.status === "duplicate").length;
    const invalid = results.filter((r) => r.status === "invalid").length;

    return sendSuccessResponse(res, 207, "Bulk holiday creation complete", {
      summary: { created, duplicates, invalid },
      results,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to bulk create holidays",
    );
  }
}

/* ===============================================================
   PATCH /admin/holidays/:id
   =============================================================== */
export async function adminUpdateHoliday(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { id } = req.params;
    const { name, description, isRecurring } = req.body as Record<string, any>;

    if (!name && description === undefined && isRecurring === undefined)
      return sendErrorResponse(
        res,
        400,
        "Provide at least one field to update: name, description, isRecurring",
      );

    const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
    if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

    const { start, end } = getISTDayBounds(holiday.date);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedHoliday = await tx.publicHoliday.update({
        where: { id },
        data: {
          ...(name?.trim() ? { name: name.trim() } : {}),
          ...(description !== undefined
            ? { description: description?.trim() ?? null }
            : {}),
          ...(isRecurring !== undefined
            ? { isRecurring: Boolean(isRecurring) }
            : {}),
        },
      });

      if (name?.trim() && name.trim() !== holiday.name) {
        await tx.attendanceLog.updateMany({
          where: {
            date: { gte: start, lte: end },
            status: AttendanceStatus.HOLIDAY,
            overrideNote: `Public holiday: ${holiday.name}`,
          },
          data: {
            overrideNote: `Public holiday: ${updatedHoliday.name}`,
            overrideBy: adminAccountId,
          },
        });
      }

      return updatedHoliday;
    });

    return sendSuccessResponse(res, 200, "Holiday updated", {
      ...updated,
      dateStr: toISTDateStr(updated.date),
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to update holiday",
    );
  }
}

/* ===============================================================
   DELETE /admin/holidays/:id
   =============================================================== */
export async function adminDeleteHoliday(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const { id } = req.params;

    const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
    if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

    const { deleted, untouched } = await prisma.$transaction(async (tx) => {
      await tx.publicHoliday.delete({ where: { id } });
      return revertHolidayForDate(holiday.date, tx);
    });

    emit("broadcast", "holiday:deleted", {
      date: holiday.date,
      dateStr: toISTDateStr(holiday.date),
      name: holiday.name,
    });

    return sendSuccessResponse(res, 200, "Holiday deleted", {
      holiday,
      attendanceReverted: deleted,
      attendanceUntouched: untouched,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to delete holiday",
    );
  }
}

/* ===============================================================
   POST /admin/holidays/seed-next-year
   =============================================================== */
export async function adminSeedNextYearHolidays(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { year: currentYear } = parseDateInputToISTYMD();
    const nextYear = currentYear + 1;

    const { start: curStart, end: curEnd } = getISTYearBounds(currentYear);
    const { start: nextStart, end: nextEnd } = getISTYearBounds(nextYear);

    const recurring = await prisma.publicHoliday.findMany({
      where: {
        isRecurring: true,
        date: { gte: curStart, lte: curEnd },
      },
      orderBy: { date: "asc" },
    });

    if (recurring.length === 0)
      return sendSuccessResponse(
        res,
        200,
        "No recurring holidays found for current year",
        { seeded: 0, skipped: 0 },
      );

    const existingNextYear = await prisma.publicHoliday.findMany({
      where: {
        date: { gte: nextStart, lte: nextEnd },
      },
      select: { date: true },
    });

    const existingDateStrs = new Set(
      existingNextYear.map((h) => toISTDateStr(h.date)),
    );

    const results: {
      name: string;
      date: string;
      status: "seeded" | "skipped";
    }[] = [];

    for (const h of recurring) {
      const { month, day } = parseDateInputToISTYMD(h.date);
      const nextDateStr = `${nextYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const nextDate = toISTDateOnly(nextDateStr);

      if (existingDateStrs.has(nextDateStr)) {
        results.push({ name: h.name, date: nextDateStr, status: "skipped" });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.publicHoliday.create({
          data: {
            date: nextDate,
            name: h.name,
            description: h.description,
            isRecurring: true,
            createdBy: adminAccountId,
          },
        });

        await markHolidayForAllAccounts(
          nextDate,
          h.name,
          adminAccountId,
          tx,
        );
      });

      results.push({ name: h.name, date: nextDateStr, status: "seeded" });
    }

    const seeded = results.filter((r) => r.status === "seeded").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return sendSuccessResponse(
      res,
      200,
      `Seeded ${seeded} recurring holidays into ${nextYear}`,
      { year: nextYear, summary: { seeded, skipped }, results },
    );
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to seed next year holidays",
    );
  }
}

/* ===============================================================
   POST /admin/holidays/:id/sync-attendance
   =============================================================== */
export async function adminSyncHolidayAttendance(req: Request, res: Response) {
  try {
    if (!assertAdmin(req, res)) return;

    const adminAccountId = req.user?.accountId;
    const { id } = req.params;

    const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
    if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

    const { upserted, skipped } = await prisma.$transaction(async (tx) => {
      return markHolidayForAllAccounts(
        holiday.date,
        holiday.name,
        adminAccountId,
        tx,
      );
    });

    return sendSuccessResponse(res, 200, "Holiday attendance synced", {
      holiday: { ...holiday, dateStr: toISTDateStr(holiday.date) },
      attendanceMarked: upserted,
      attendanceSkipped: skipped,
    });
  } catch (err: any) {
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Failed to sync holiday attendance",
    );
  }
}
