// // src/controller/admin/holiday.controller.ts
// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import { getIo } from "../../core/utils/socket";
// import {
//   sendErrorResponse,
//   sendSuccessResponse,
// } from "../../core/utils/httpResponse";
// import { AttendanceStatus } from "@prisma/client";

// /* ═══════════════════════════════════════════════════════════════
//    INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════ */

// /** Strip time — midnight 00:00:00 in LOCAL server timezone */
// function toDateOnly(date: Date = new Date()): Date {
//   return new Date(date.getFullYear(), date.getMonth(), date.getDate());
// }

// function getDayName(date: Date): string {
//   return date.toLocaleDateString("en-US", { weekday: "long" });
// }

// /** Enumerate every calendar date in [start, end] inclusive */
// function getDateRange(start: Date, end: Date): Date[] {
//   const dates: Date[] = [];
//   const cur = new Date(start);
//   while (cur <= end) {
//     dates.push(new Date(cur));
//     cur.setDate(cur.getDate() + 1);
//   }
//   return dates;
// }

// /** Emit socket events safely */
// function emit(room: string, event: string, data: unknown) {
//   try {
//     getIo().to(room).emit(event, data);
//   } catch {
//     // socket not initialized in test/migration contexts
//   }
// }

// /* ═══════════════════════════════════════════════════════════════
//    ADMIN GUARD
// ═══════════════════════════════════════════════════════════════ */

// function assertAdmin(req: Request, res: Response): boolean {
//   if (!req.user?.roles?.includes?.("ADMIN")) {
//     sendErrorResponse(res, 403, "Admin access required");
//     return false;
//   }
//   return true;
// }

// /* ═══════════════════════════════════════════════════════════════
//    CORE — mark / unmark holiday on AttendanceLog rows
// ═══════════════════════════════════════════════════════════════ */

// /**
//  * For a given date, upsert an AttendanceLog row with status HOLIDAY
//  * for every active employee. Skips accounts that already have
//  * check events on that date (don't stomp real work).
//  *
//  * Returns counts { upserted, skipped }
//  */
// async function markHolidayForAllAccounts(
//   date: Date,
//   holidayName: string,
//   adminAccountId: string | undefined,
//   tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
// ): Promise<{ upserted: number; skipped: number }> {
//   const dayName = getDayName(date);

//   const activeAccounts = await tx.account.findMany({
//     where: { isActive: true },
//     select: { id: true },
//   });

//   let upserted = 0;
//   let skipped = 0;

//   for (const { id: accountId } of activeAccounts) {
//     /* If the employee has any check events on this date, leave them alone */
//     const hasChecks = await tx.checkLog.count({
//       where: { accountId, date },
//     });

//     if (hasChecks > 0) {
//       skipped++;
//       continue;
//     }

//     await tx.attendanceLog.upsert({
//       where: { accountId_date: { accountId, date } },
//       create: {
//         accountId,
//         date,
//         day: dayName,
//         isSunday: date.getDay() === 0,
//         status: AttendanceStatus.HOLIDAY,
//         overrideNote: `Public holiday: ${holidayName}`,
//         overrideBy: adminAccountId,
//       },
//       update: {
//         status: AttendanceStatus.HOLIDAY,
//         overrideNote: `Public holiday: ${holidayName}`,
//         overrideBy: adminAccountId,
//       },
//     });

//     upserted++;
//   }

//   return { upserted, skipped };
// }

// /**
//  * Revert HOLIDAY attendance logs for a given date.
//  * - Rows with no check events → deleted entirely (clean slate).
//  * - Rows that DO have check events → left untouched (shouldn't
//  *   have been marked HOLIDAY in the first place, but guard anyway).
//  *
//  * Returns { deleted, untouched }
//  */
// async function revertHolidayForDate(
//   date: Date,
//   tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
// ): Promise<{ deleted: number; untouched: number }> {
//   const logs = await tx.attendanceLog.findMany({
//     where: { date, status: AttendanceStatus.HOLIDAY },
//     select: { id: true, accountId: true },
//   });

//   let deleted = 0;
//   let untouched = 0;

//   for (const log of logs) {
//     const hasChecks = await tx.checkLog.count({
//       where: { attendanceLogId: log.id },
//     });

//     if (hasChecks > 0) {
//       untouched++;
//       continue;
//     }

//     await tx.attendanceLog.delete({ where: { id: log.id } });
//     deleted++;
//   }

//   return { deleted, untouched };
// }

// /* ═══════════════════════════════════════════════════════════════
//    ██╗  ██╗ ██████╗ ██╗     ██╗██████╗  █████╗ ██╗   ██╗
//    ██║  ██║██╔═══██╗██║     ██║██╔══██╗██╔══██╗╚██╗ ██╔╝
//    ███████║██║   ██║██║     ██║██║  ██║███████║ ╚████╔╝
//    ██╔══██║██║   ██║██║     ██║██║  ██║██╔══██║  ╚██╔╝
//    ██║  ██║╚██████╔╝███████╗██║██████╔╝██║  ██║   ██║
//    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝   ╚═╝
// ═══════════════════════════════════════════════════════════════ */

// /* ─────────────────────────────────────────────────────────────
//    GET /admin/holidays?year=&month=&upcoming=true
//    List public holidays. Defaults to current year if no filters.
// ───────────────────────────────────────────────────────────── */
// export async function adminGetHolidays(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const {
//       year: yearStr,
//       month: monthStr,
//       upcoming,
//     } = req.query as Record<string, string>;

//     const where: any = {};

//     if (upcoming === "true") {
//       /* Upcoming = today onwards, current year */
//       const today = toDateOnly();
//       const endOfYear = new Date(today.getFullYear(), 11, 31, 23, 59, 59);
//       where.date = { gte: today, lte: endOfYear };
//     } else if (yearStr) {
//       const y = parseInt(yearStr);
//       if (isNaN(y)) return sendErrorResponse(res, 400, "Invalid year");

//       if (monthStr) {
//         const m = parseInt(monthStr);
//         if (isNaN(m) || m < 1 || m > 12)
//           return sendErrorResponse(res, 400, "Invalid month (1–12)");
//         where.date = {
//           gte: new Date(y, m - 1, 1),
//           lte: new Date(y, m, 0, 23, 59, 59),
//         };
//       } else {
//         where.date = {
//           gte: new Date(y, 0, 1),
//           lte: new Date(y, 11, 31, 23, 59, 59),
//         };
//       }
//     } else {
//       /* Default: current year */
//       const y = new Date().getFullYear();
//       where.date = {
//         gte: new Date(y, 0, 1),
//         lte: new Date(y, 11, 31, 23, 59, 59),
//       };
//     }

//     const holidays = await prisma.publicHoliday.findMany({
//       where,
//       orderBy: { date: "asc" },
//     });

//     return sendSuccessResponse(res, 200, "Public holidays fetched", {
//       total: holidays.length,
//       data: holidays,
//     });
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to fetch holidays",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    GET /admin/holidays/:id
//    Single holiday detail.
// ───────────────────────────────────────────────────────────── */
// export async function adminGetHolidayById(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const { id } = req.params;

//     const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
//     if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

//     /* Count how many attendance logs were marked for this date */
//     const markedCount = await prisma.attendanceLog.count({
//       where: { date: holiday.date, status: AttendanceStatus.HOLIDAY },
//     });

//     return sendSuccessResponse(res, 200, "Holiday fetched", {
//       ...holiday,
//       markedEmployeeCount: markedCount,
//     });
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to fetch holiday",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    POST /admin/holidays
//    Create a single public holiday and mark attendance for all
//    active employees on that date.
//    Body: { date, name, description?, isRecurring? }
// ───────────────────────────────────────────────────────────── */
// export async function adminCreateHoliday(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const adminAccountId = req.user?.accountId;
//     const {
//       date: dateStr,
//       name,
//       description,
//       isRecurring = false,
//     } = req.body as Record<string, any>;

//     if (!dateStr) return sendErrorResponse(res, 400, "date is required");
//     if (!name?.trim()) return sendErrorResponse(res, 400, "name is required");

//     const date = toDateOnly(new Date(dateStr));
//     if (isNaN(date.getTime()))
//       return sendErrorResponse(res, 400, "Invalid date format");

//     /* Check for duplicate */
//     const existing = await prisma.publicHoliday.findUnique({
//       where: { date },
//     });
//     if (existing)
//       return sendErrorResponse(
//         res,
//         409,
//         `A holiday already exists on ${date.toDateString()}: "${existing.name}"`,
//       );

//     const { holiday, markedCount, skippedCount } =
//       await prisma.$transaction(async (tx) => {
//         const holiday = await tx.publicHoliday.create({
//           data: {
//             date,
//             name: name.trim(),
//             description: description?.trim() ?? null,
//             isRecurring: Boolean(isRecurring),
//             createdBy: adminAccountId,
//           },
//         });

//         const { upserted, skipped } = await markHolidayForAllAccounts(
//           date,
//           holiday.name,
//           adminAccountId,
//           tx,
//         );

//         return { holiday, markedCount: upserted, skippedCount: skipped };
//       });

//     /* Broadcast to all connected admins/employees */
//     emit("broadcast", "holiday:created", {
//       date: holiday.date,
//       name: holiday.name,
//     });

//     return sendSuccessResponse(res, 201, "Holiday created", {
//       holiday,
//       attendanceMarked: markedCount,
//       attendanceSkipped: skippedCount,
//     });
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to create holiday",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    POST /admin/holidays/bulk
//    Create multiple holidays at once (e.g. seed a full year).
//    Body: { holidays: [{ date, name, description?, isRecurring? }] }
//    Skips duplicates — does NOT fail the whole batch.
// ───────────────────────────────────────────────────────────── */
// export async function adminBulkCreateHolidays(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const adminAccountId = req.user?.accountId;
//     const { holidays: items } = req.body as {
//       holidays: Array<{
//         date: string;
//         name: string;
//         description?: string;
//         isRecurring?: boolean;
//       }>;
//     };

//     if (!Array.isArray(items) || items.length === 0)
//       return sendErrorResponse(
//         res,
//         400,
//         "holidays array is required and must be non-empty",
//       );

//     if (items.length > 100)
//       return sendErrorResponse(res, 400, "Maximum 100 holidays per bulk call");

//     const results: {
//       date: string;
//       name: string;
//       status: "created" | "duplicate" | "invalid";
//       attendanceMarked?: number;
//       attendanceSkipped?: number;
//       reason?: string;
//     }[] = [];

//     for (const item of items) {
//       if (!item.date || !item.name?.trim()) {
//         results.push({
//           date: item.date ?? "unknown",
//           name: item.name ?? "unknown",
//           status: "invalid",
//           reason: "date and name are required",
//         });
//         continue;
//       }

//       const date = toDateOnly(new Date(item.date));
//       if (isNaN(date.getTime())) {
//         results.push({
//           date: item.date,
//           name: item.name,
//           status: "invalid",
//           reason: "Invalid date format",
//         });
//         continue;
//       }

//       /* Check duplicate outside transaction for clean error capture */
//       const existing = await prisma.publicHoliday.findUnique({
//         where: { date },
//       });

//       if (existing) {
//         results.push({
//           date: item.date,
//           name: item.name,
//           status: "duplicate",
//           reason: `Already exists as "${existing.name}"`,
//         });
//         continue;
//       }

//       const { markedCount, skippedCount } = await prisma.$transaction(
//         async (tx) => {
//           await tx.publicHoliday.create({
//             data: {
//               date,
//               name: item.name.trim(),
//               description: item.description?.trim() ?? null,
//               isRecurring: Boolean(item.isRecurring ?? false),
//               createdBy: adminAccountId,
//             },
//           });

//           const { upserted, skipped } = await markHolidayForAllAccounts(
//             date,
//             item.name.trim(),
//             adminAccountId,
//             tx,
//           );

//           return { markedCount: upserted, skippedCount: skipped };
//         },
//       );

//       results.push({
//         date: item.date,
//         name: item.name.trim(),
//         status: "created",
//         attendanceMarked: markedCount,
//         attendanceSkipped: skippedCount,
//       });
//     }

//     const created = results.filter((r) => r.status === "created").length;
//     const duplicates = results.filter((r) => r.status === "duplicate").length;
//     const invalid = results.filter((r) => r.status === "invalid").length;

//     return sendSuccessResponse(res, 207, "Bulk holiday creation complete", {
//       summary: { created, duplicates, invalid },
//       results,
//     });
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to bulk create holidays",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    PATCH /admin/holidays/:id
//    Update name / description / isRecurring.
//    Does NOT change the date (delete + recreate for that).
//    Body: { name?, description?, isRecurring? }
// ───────────────────────────────────────────────────────────── */
// export async function adminUpdateHoliday(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const adminAccountId = req.user?.accountId;
//     const { id } = req.params;
//     const { name, description, isRecurring } = req.body as Record<string, any>;

//     if (!name && description === undefined && isRecurring === undefined)
//       return sendErrorResponse(
//         res,
//         400,
//         "Provide at least one field to update: name, description, isRecurring",
//       );

//     const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
//     if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

//     const updated = await prisma.$transaction(async (tx) => {
//       const updatedHoliday = await tx.publicHoliday.update({
//         where: { id },
//         data: {
//           ...(name?.trim() ? { name: name.trim() } : {}),
//           ...(description !== undefined
//             ? { description: description?.trim() ?? null }
//             : {}),
//           ...(isRecurring !== undefined
//             ? { isRecurring: Boolean(isRecurring) }
//             : {}),
//         },
//       });

//       /* Sync the override note on all affected attendance logs if name changed */
//       if (name?.trim() && name.trim() !== holiday.name) {
//         await tx.attendanceLog.updateMany({
//           where: {
//             date: holiday.date,
//             status: AttendanceStatus.HOLIDAY,
//             overrideNote: `Public holiday: ${holiday.name}`,
//           },
//           data: {
//             overrideNote: `Public holiday: ${updatedHoliday.name}`,
//             overrideBy: adminAccountId,
//           },
//         });
//       }

//       return updatedHoliday;
//     });

//     return sendSuccessResponse(res, 200, "Holiday updated", updated);
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to update holiday",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    DELETE /admin/holidays/:id
//    Remove a holiday and revert attendance logs for that date.
//    - AttendanceLogs with no check events → deleted.
//    - AttendanceLogs with check events    → left untouched.
// ───────────────────────────────────────────────────────────── */
// export async function adminDeleteHoliday(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const { id } = req.params;

//     const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
//     if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

//     const { deleted, untouched } = await prisma.$transaction(async (tx) => {
//       await tx.publicHoliday.delete({ where: { id } });
//       return revertHolidayForDate(holiday.date, tx);
//     });

//     emit("broadcast", "holiday:deleted", {
//       date: holiday.date,
//       name: holiday.name,
//     });

//     return sendSuccessResponse(res, 200, "Holiday deleted", {
//       holiday,
//       attendanceReverted: deleted,
//       attendanceUntouched: untouched,
//     });
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to delete holiday",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    POST /admin/holidays/seed-next-year
//    Clone all isRecurring=true holidays from current year into
//    next year. Skips any date that already has a holiday.
//    Meant to be called manually by admin or by a yearly cron.
// ───────────────────────────────────────────────────────────── */
// export async function adminSeedNextYearHolidays(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const adminAccountId = req.user?.accountId;
//     const currentYear = new Date().getFullYear();
//     const nextYear = currentYear + 1;

//     /* Fetch all recurring holidays for current year */
//     const recurring = await prisma.publicHoliday.findMany({
//       where: {
//         isRecurring: true,
//         date: {
//           gte: new Date(currentYear, 0, 1),
//           lte: new Date(currentYear, 11, 31, 23, 59, 59),
//         },
//       },
//       orderBy: { date: "asc" },
//     });

//     if (recurring.length === 0)
//       return sendSuccessResponse(
//         res,
//         200,
//         "No recurring holidays found for current year",
//         { seeded: 0, skipped: 0 },
//       );

//     /* Fetch already-existing holidays for next year to detect conflicts */
//     const existingNextYear = await prisma.publicHoliday.findMany({
//       where: {
//         date: {
//           gte: new Date(nextYear, 0, 1),
//           lte: new Date(nextYear, 11, 31, 23, 59, 59),
//         },
//       },
//       select: { date: true },
//     });

//     const existingDates = new Set(
//       existingNextYear.map((h) => h.date.toISOString()),
//     );

//     const results: {
//       name: string;
//       date: string;
//       status: "seeded" | "skipped";
//     }[] = [];

//     for (const h of recurring) {
//       /* Project into next year, preserving month + day */
//       const nextDate = toDateOnly(
//         new Date(nextYear, h.date.getMonth(), h.date.getDate()),
//       );

//       if (existingDates.has(nextDate.toISOString())) {
//         results.push({ name: h.name, date: nextDate.toISOString(), status: "skipped" });
//         continue;
//       }

//       await prisma.$transaction(async (tx) => {
//         await tx.publicHoliday.create({
//           data: {
//             date: nextDate,
//             name: h.name,
//             description: h.description,
//             isRecurring: true,
//             createdBy: adminAccountId,
//           },
//         });

//         await markHolidayForAllAccounts(
//           nextDate,
//           h.name,
//           adminAccountId,
//           tx,
//         );
//       });

//       results.push({ name: h.name, date: nextDate.toISOString(), status: "seeded" });
//     }

//     const seeded = results.filter((r) => r.status === "seeded").length;
//     const skipped = results.filter((r) => r.status === "skipped").length;

//     return sendSuccessResponse(
//       res,
//       200,
//       `Seeded ${seeded} recurring holidays into ${nextYear}`,
//       { year: nextYear, summary: { seeded, skipped }, results },
//     );
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to seed next year holidays",
//     );
//   }
// }

// /* ─────────────────────────────────────────────────────────────
//    POST /admin/holidays/:id/sync-attendance
//    Re-sync attendance for a holiday's date — useful if new
//    employees were added after the holiday was created, or if
//    an earlier manual override needs to be corrected.
// ───────────────────────────────────────────────────────────── */
// export async function adminSyncHolidayAttendance(req: Request, res: Response) {
//   try {
//     if (!assertAdmin(req, res)) return;

//     const adminAccountId = req.user?.accountId;
//     const { id } = req.params;

//     const holiday = await prisma.publicHoliday.findUnique({ where: { id } });
//     if (!holiday) return sendErrorResponse(res, 404, "Holiday not found");

//     const { upserted, skipped } = await prisma.$transaction(async (tx) => {
//       return markHolidayForAllAccounts(
//         holiday.date,
//         holiday.name,
//         adminAccountId,
//         tx,
//       );
//     });

//     return sendSuccessResponse(res, 200, "Holiday attendance synced", {
//       holiday,
//       attendanceMarked: upserted,
//       attendanceSkipped: skipped,
//     });
//   } catch (err: any) {
//     return sendErrorResponse(
//       res,
//       500,
//       err?.message ?? "Failed to sync holiday attendance",
//     );
//   }
// }