// // src/controllers/dailyStatus.controller.ts
// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
// import { isValid, parseISO, startOfDay } from "date-fns";
// import { getIo } from "../../core/utils/socket";

// /**
//  * Helpers (reuse your existing helper or copy)
//  */
// const getAccountIdFromReqUser = async (userId?: string | null) => {
//   if (!userId) return null;
//   const u = await prisma.user.findUnique({
//     where: { id: userId },
//     select: { accountId: true },
//   });
//   return u?.accountId ?? null;
// };

// function normalizeDateToStart(date?: string) {
//   if (!date) return startOfDay(new Date());
//   try {
//     const d = parseISO(date);
//     if (!isValid(d)) return startOfDay(new Date());
//     return startOfDay(d);
//   } catch {
//     return startOfDay(new Date());
//   }
// }

// /* ============================
//    CRUD: Create / Upsert Report
//    POST /api/v1/ds/reports
//    Body:
//      {
//        reportDate?: "YYYY-MM-DD", // optional, defaults today
//        summary?: string,
//        items?: [{ section, entityType?, entityId?, title?, note, timeSpentMinutes? , raisedToAccountId? }]
//      }
// ============================ */
// export async function createOrUpdateReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { reportDate, summary, items, state } = req.body as any;
//     const day = normalizeDateToStart(reportDate);

//     // Ensure single report per account/day
//     const existing = await prisma.dailyStatusReport.findUnique({
//       where: { accountId_reportDate: { accountId, reportDate: day } as any },
//     });

//     if (existing && existing.state !== "DRAFT") {
//       return sendErrorResponse(res, 400, "Cannot modify non-draft report");
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       const report = existing
//         ? await tx.dailyStatusReport.update({
//             where: { id: existing.id },
//             data: { summary: summary ?? existing.summary },
//           })
//         : await tx.dailyStatusReport.create({
//             data: {
//               accountId,
//               reportDate: day,
//               summary: summary ?? null,
//               state: state ?? "SUBMITTED",
//             },
//           });

//       if (Array.isArray(items) && items.length > 0) {
//         // Remove existing items if any (for update)
//         if (existing) {
//           await tx.dailyStatusItem.deleteMany({ where: { reportId: report.id } });
//         }
//         // Insert new items
//         const toCreate = items.map((it: any) => ({
//           reportId: report.id,
//           section: it.section,
//           entityType: it.entityType ?? null,
//           entityId: it.entityId ?? null,
//           title: it.title ?? null,
//           note: it.note ?? "",
//           raisedToAccountId: it.raisedToAccountId ?? null,
//           resolved: Boolean(it.resolved ?? false),
//           timeSpentMinutes: typeof it.timeSpentMinutes === "number" ? it.timeSpentMinutes : null,
//         }));
//         if (toCreate.length > 0) await tx.dailyStatusItem.createMany({ data: toCreate });
//       }

//       // fetch with items
//       const full = await tx.dailyStatusReport.findUnique({
//         where: { id: report.id },
//         include: { items: { orderBy: { createdAt: "asc" } } },
//       });
//       return full;
//     });

//     return sendSuccessResponse(res, 201, "Report saved", result);
//   } catch (err: any) {
//     console.error("createOrUpdateReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to save report");
//   }
// }

// /* ============================
//    GET my report for a date
//    GET /api/v1/ds/reports/my?date=YYYY-MM-DD
// ============================ */
// export async function getMyReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { date } = req.query as Record<string, string>;
//     const day = normalizeDateToStart(date);

//     const report = await prisma.dailyStatusReport.findUnique({
//       where: { accountId_reportDate: { accountId, reportDate: day } as any },
//       include: { items: { orderBy: { createdAt: "asc" } } },
//     });

//     if (!report) return sendSuccessResponse(res, 200, "No report found", null);

//     return sendSuccessResponse(res, 200, "Report fetched", report);
//   } catch (err: any) {
//     console.error("getMyReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch report");
//   }
// }

// /* ============================
//    PATCH /api/v1/ds/reports/:id
//    Update summary or items (only DRAFT)
//    Body: summary?, items? (replace)
// ============================ */
// export async function patchReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { id } = req.params;
//     const { summary, items } = req.body as any;

//     const existing = await prisma.dailyStatusReport.findUnique({ where: { id } });
//     if (!existing) return sendErrorResponse(res, 404, "Report not found");
//     if (existing.accountId !== accountId) return sendErrorResponse(res, 403, "Not authorized");
//     if (existing.state !== "DRAFT") return sendErrorResponse(res, 400, "Cannot edit non-draft report");

//     const result = await prisma.$transaction(async (tx) => {
//       const updated = await tx.dailyStatusReport.update({
//         where: { id },
//         data: { summary: summary ?? existing.summary },
//       });

//       if (Array.isArray(items)) {
//         await tx.dailyStatusItem.deleteMany({ where: { reportId: id } });
//         const toCreate = items.map((it: any) => ({
//           reportId: id,
//           section: it.section,
//           entityType: it.entityType ?? null,
//           entityId: it.entityId ?? null,
//           title: it.title ?? null,
//           note: it.note ?? "",
//           raisedToAccountId: it.raisedToAccountId ?? null,
//           resolved: Boolean(it.resolved ?? false),
//           timeSpentMinutes: typeof it.timeSpentMinutes === "number" ? it.timeSpentMinutes : null,
//         }));
//         if (toCreate.length > 0) await tx.dailyStatusItem.createMany({ data: toCreate });
//       }

//       const full = await tx.dailyStatusReport.findUnique({
//         where: { id },
//         include: { items: { orderBy: { createdAt: "asc" } } },
//       });
//       return full;
//     });

//     return sendSuccessResponse(res, 200, "Report updated", result);
//   } catch (err: any) {
//     console.error("patchReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to update report");
//   }
// }

// /* ============================
//    POST /api/v1/ds/reports/:id/submit
//    Locks DRAFT and marks SUBMITTED
// ============================ */
// export async function submitReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { id } = req.params;
//     const existing = await prisma.dailyStatusReport.findUnique({ where: { id }, include: { items: true } });
//     if (!existing) return sendErrorResponse(res, 404, "Report not found");
//     if (existing.accountId !== accountId) return sendErrorResponse(res, 403, "Not authorized");
//     if (existing.state !== "DRAFT") return sendErrorResponse(res, 400, "Report not in DRAFT state");

//     if (!existing.items || existing.items.length === 0) {
//       return sendErrorResponse(res, 400, "Report must contain at least one item before submit");
//     }

//     const updated = await prisma.dailyStatusReport.update({
//       where: { id },
//       data: { state: "SUBMITTED", submittedAt: new Date() },
//     });

//     // Optionally notify manager(s) / watchers
//     // Create notification row and emit via socket to reviewers/manager. Simple example: notify account's manager if exists
//     try {
//       const io = getIo();
//       // create a local notification record for the account (owner) and also for managers if you have manager relationship
//       await prisma.notification.create({
//         data: {
//           accountId: null, // broadcast to managers? set null or specific account
//           category: "REMINDER",
//           level: "INFO",
//           title: "Daily Status Submitted",
//           body: `Daily status submitted by ${existing.accountId} for ${existing.reportDate.toISOString().slice(0,10)}`,
//           payload: { reportId: id, accountId: existing.accountId, type: "daily_status_submitted" },
//           createdBy: existing.accountId,
//           sentAt: new Date(),
//         },
//       });
//       // emit broadcast (or emit to manager rooms if available)
//       io.emit("notification:daily_status_submitted", { reportId: id, accountId: existing.accountId });
//     } catch (e) {
//       console.warn("submitReport: notification emit failed", e);
//     }

//     return sendSuccessResponse(res, 200, "Report submitted", updated);
//   } catch (err: any) {
//     console.error("submitReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to submit report");
//   }
// }

// /* ============================
//    POST /api/v1/ds/reports/:id/review
//    body: { reviewNote?: string, approve: boolean }
//    Only ADMIN or manager can review (set state=REVIEWED)
// ============================ */
// export async function reviewReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     if (!req.user?.roles?.includes?.("ADMIN")) {
//       // optionally check manager role if you have it
//       return sendErrorResponse(res, 403, "Admin access required");
//     }
//     const accountId = await getAccountIdFromReqUser(userId);

//     const { id } = req.params;
//     const { reviewNote, approve } = req.body as { reviewNote?: string; approve?: boolean };

//     const existing = await prisma.dailyStatusReport.findUnique({ where: { id } });
//     if (!existing) return sendErrorResponse(res, 404, "Report not found");
//     if (existing.state !== "SUBMITTED") return sendErrorResponse(res, 400, "Only SUBMITTED reports can be reviewed");

//     const updated = await prisma.dailyStatusReport.update({
//       where: { id },
//       data: {
//         state: "REVIEWED",
//         reviewedAt: new Date(),
//         reviewedBy: accountId,
//         reviewNote: reviewNote ?? null,
//       },
//     });

//     // create notification to owner informing review result
//     try {
//       const io = getIo();
//       await prisma.notification.create({
//         data: {
//           accountId: existing.accountId,
//           category: "SYSTEM",
//           level: approve ? "SUCCESS" : "INFO",
//           title: "Daily Status Reviewed",
//           body: reviewNote ?? (approve ? "Approved" : "Reviewed"),
//           payload: { reportId: id, approve: Boolean(approve) },
//           createdBy: accountId,
//           sentAt: new Date(),
//         },
//       });
//       io.to(`notif:${existing.accountId}`).emit("notification", { type: "daily_status_reviewed", reportId: id, approve: Boolean(approve) });
//     } catch (e) {
//       console.warn("reviewReport: notification failed", e);
//     }

//     return sendSuccessResponse(res, 200, "Report reviewed", updated);
//   } catch (err: any) {
//     console.error("reviewReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to review report");
//   }
// }

// /* ============================
//    GET /api/v1/ds/reports
//    Admin listing with filters (accountId?, fromDate?, toDate?, state?)
// ============================ */
// export async function listReportsAdmin(req: Request, res: Response) {
//   try {
//     if (!req.user?.roles?.includes?.("ADMIN")) return sendErrorResponse(res, 403, "Admin access required");

//     const { accountId, fromDate, toDate, state, page = "1", limit = "50" } = req.query as Record<string, string>;
//     const pageNumber = Math.max(Number(page) || 1, 1);
//     const pageSize = Math.min(Number(limit) || 200, 200);

//     const where: any = {};
//     if (accountId) where.accountId = accountId;
//     if (state) where.state = state;
//     if (fromDate || toDate) {
//       where.reportDate = {};
//       if (fromDate) where.reportDate.gte = normalizeDateToStart(fromDate);
//       if (toDate) where.reportDate.lte = normalizeDateToStart(toDate);
//     }

//     const [total, reports] = await prisma.$transaction([
//       prisma.dailyStatusReport.count({ where }),
//       prisma.dailyStatusReport.findMany({
//         where,
//         include: { items: true, account: { select: { id: true, firstName: true, lastName: true } } },
//         orderBy: { reportDate: "desc" },
//         skip: (pageNumber - 1) * pageSize,
//         take: pageSize,
//       }),
//     ]);

//     return sendSuccessResponse(res, 200, "Reports fetched", {
//       data: reports,
//       meta: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
//     });
//   } catch (err: any) {
//     console.error("listReportsAdmin error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to list reports");
//   }
// }

// /* ============================
//    Prefill: create draft from assigned tasks/leads/support
//    POST /api/v1/ds/prefill
//    body: { date?: "YYYY-MM-DD", includeAssignedTasks?: boolean, includeAssignedLeads?: boolean }
//    returns created/updated report
// ============================ */
// export async function prefillReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { date, includeAssignedTasks = true, includeAssignedLeads = true } = req.body as any;
//     const day = normalizeDateToStart(date);

//     // fetch assigned tasks / leads that are relevant (active / in progress)
//     const promises: Promise<any>[] = [];
//     if (includeAssignedTasks) {
//       // adjust filter to your Task model fields
//       promises.push(
//         prisma.task.findMany({
//           where: { assignments: { some: { accountId } }, status: { in: ["IN_PROGRESS", "PENDING"] } },
//           select: { id: true, title: true, status: true },
//         }),
//       );
//     } else promises.push(Promise.resolve([]));

//     if (includeAssignedLeads) {
//       promises.push(
//         prisma.lead.findMany({
//           where: {
//             assignments: { some: { isActive: true, accountId } },
//             status: { in: ["PENDING", "IN_PROGRESS"] },
//           },
//           select: { id: true, customerName: true, productTitle: true, status: true },
//         }),
//       );
//     } else promises.push(Promise.resolve([]));

//     const [tasks, leads] = (await Promise.all(promises)) as any[];

//     // Build items
//     const items: any[] = [];
//     for (const t of tasks) {
//       items.push({
//         section: "IN_PROGRESS",
//         entityType: "TASK",
//         entityId: t.id,
//         title: t.title,
//         note: `Working on task "${t.title}" (status: ${t.status})`,
//       });
//     }
//     for (const l of leads) {
//       items.push({
//         section: "IN_PROGRESS",
//         entityType: "LEAD",
//         entityId: l.id,
//         title: l.customerName,
//         note: `Working on lead "${l.customerName}" (${l.productTitle ?? "—"})`,
//       });
//     }

//     // create or upsert report (reuse createOrUpdateReport logic style)
//     const existing = await prisma.dailyStatusReport.findUnique({
//       where: { accountId_reportDate: { accountId, reportDate: day } as any },
//     });

//     const result = await prisma.$transaction(async (tx) => {
//       const report = existing
//         ? await tx.dailyStatusReport.update({
//             where: { id: existing.id },
//             data: { summary: existing.summary ?? "Prefilled from assignments" },
//           })
//         : await tx.dailyStatusReport.create({
//             data: {
//               accountId,
//               reportDate: day,
//               summary: "Prefilled from assignments",
//               state: "DRAFT",
//             },
//           });

//       if (items.length > 0) {
//         // clear existing items and insert
//         await tx.dailyStatusItem.deleteMany({ where: { reportId: report.id } });
//         const payload = items.map((i) => ({ reportId: report.id, section: i.section, entityType: i.entityType, entityId: i.entityId, title: i.title, note: i.note }));
//         await tx.dailyStatusItem.createMany({ data: payload });
//       }

//       return tx.dailyStatusReport.findUnique({ where: { id: report.id }, include: { items: true } });
//     });

//     return sendSuccessResponse(res, 200, "Prefill applied", result);
//   } catch (err: any) {
//     console.error("prefillReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to prefill report");
//   }
// }

// /* ============================
//    Prefill: create draft from assigned tasks/leads/support
//    POST /api/v1/ds/prefill
//    body: { date?: "YYYY-MM-DD", includeAssignedTasks?: boolean, includeAssignedLeads?: boolean }
//    returns created/updated report
// ============================ */
// /**
//  * POST /api/v1/ds/prefill
//  * body: { date?: string }
//  */
// export async function applyPrefill(req: Request, res: Response) {
//   try {
//     const accountId = await getAccountIdFromReqUser(req.user?.id);
//     if (!accountId) return sendErrorResponse(res, 401, "Unauthorized");

//     const day = normalizeDateToStart(req.body.date);

//     const [tasks, leads] = await Promise.all([
//       prisma.task.findMany({
//         where: {
//           assignments: { some: { accountId, status: "PENDING" } },
//           status: { in: ["PENDING", "IN_PROGRESS"] },
//           updatedAt: { gte: day },
//         },
//         select: { id: true, title: true, status: true },
//       }),
//       prisma.lead.findMany({
//         where: {
//           assignments: { some: { accountId, isActive: true } },
//           status: { in: ["PENDING", "IN_PROGRESS"] },
//           updatedAt: { gte: day },
//         },
//         select: { id: true, customerName: true, productTitle: true },
//       }),
//     ]);

//     const items = [
//       ...tasks.map((t) => ({
//         section: "IN_PROGRESS",
//         entityType: "TASK",
//         entityId: t.id,
//         title: t.title,
//         note: `Working on task: ${t.title}`,
//       })),
//       ...leads.map((l) => ({
//         section: "IN_PROGRESS",
//         entityType: "LEAD",
//         entityId: l.id,
//         title: l.customerName,
//         note: `Working on lead: ${l.customerName}`,
//       })),
//     ];

//     const report = await prisma.$transaction(async (tx) => {
//       const report = await tx.dailyStatusReport.upsert({
//         where: { accountId_reportDate: { accountId, reportDate: day } },
//         update: { state: "DRAFT" },
//         create: {
//           accountId,
//           reportDate: day,
//           state: "DRAFT",
//           summary: "Auto-prefilled from today's assignments",
//         },
//       });

//       // avoid duplicates
//             for (const item of items) {
//               const existingItem = await tx.dailyStatusItem.findFirst({
//                 where: {
//                   reportId: report.id,
//                   // entityType: item.entityType,
//                   entityId: item.entityId,
//                 },
//                 select: { id: true },
//               });
//               if (!existingItem) {
//                 // await tx.dailyStatusItem.create({ data: { ...item, reportId: report.id } });
//               }
//             }

//       return tx.dailyStatusReport.findUnique({
//         where: { id: report.id },
//         include: { items: true },
//       });
//     });

//     return sendSuccessResponse(res, 200, "Prefill applied", report);
//   } catch (err: any) {
//     return sendErrorResponse(res, 500, err.message);
//   }
// }


// /* ============================
//    Analytics: weekly / monthly
//    GET /api/v1/ds/analytics/weekly?accountId?&teamId?
//    returns aggregated metrics by section, timeSpent, counts (links)
// ============================ */
// export async function analyticsWeekly(req: Request, res: Response) {
//   try {
//     // optional filters
//     const { accountId, teamId, weeks = "4" } = req.query as Record<string, string>;
//     const weeksNum = Math.max(Number(weeks) || 4, 1);

//     // compute date range from (start of week N weeks ago) to now
//     const to = new Date();
//     const from = new Date();
//     from.setDate(from.getDate() - weeksNum * 7);

//     // Base where condition: filter by accountId or team (team -> accounts in team)
//     let accountFilter: string[] | null = null;
//     if (teamId) {
//       const members = await prisma.teamMember.findMany({ where: { teamId, isActive: true }, select: { accountId: true } });
//       accountFilter = members.map((m) => m.accountId);
//       if (accountFilter.length === 0) accountFilter = ["__none__"];
//     } else if (accountId) {
//       accountFilter = [accountId];
//     }

//     const where: any = { reportDate: { gte: from, lte: to } };
//     if (accountFilter) where.accountId = { in: accountFilter };

//     // fetch items aggregated
//     const rawItems = await prisma.dailyStatusItem.findMany({
//       where,
//       select: {
//         section: true,
//         timeSpentMinutes: true,
//         entityType: true,
//         createdAt: true,
//         report: { select: { accountId: true, reportDate: true } },
//       },
//     });

//     // Aggregate in JS: counts per section, sum timeSpent, reports submitted
//     const agg: any = { bySection: {}, totalTimeMinutes: 0, reportsSubmitted: 0 };
//     for (const it of rawItems) {
//       agg.bySection[it.section] = (agg.bySection[it.section] || 0) + 1;
//       if (typeof it.timeSpentMinutes === "number") agg.totalTimeMinutes += it.timeSpentMinutes;
//     }

//     // reports submitted count in range
//     const reportsSubmitted = await prisma.dailyStatusReport.count({ where: { ...where, state: "SUBMITTED" } });
//     agg.reportsSubmitted = reportsSubmitted;

//     return sendSuccessResponse(res, 200, "Weekly analytics", { from, to, weeks: weeksNum, agg });
//   } catch (err: any) {
//     console.error("analyticsWeekly error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to compute analytics");
//   }
// }

// /* ============================
//    Monthly analytics wrapper
// ============================ */
// export async function analyticsMonthly(req: Request, res: Response) {
//   try {
//     const months = Number(req.query.months ?? 3);
//     const to = new Date();
//     const from = new Date();
//     from.setMonth(from.getMonth() - Math.max(1, months));
//     // reuse weekly code but adapt
//     // For brevity, reuse weekly aggregation with different window
//     const rawItems = await prisma.dailyStatusItem.findMany({
//       where: { createdAt: { gte: from, lte: to } },
//       select: { section: true, timeSpentMinutes: true },
//     });
//     const agg: any = { bySection: {}, totalTimeMinutes: 0 };
//     for (const it of rawItems) {
//       agg.bySection[it.section] = (agg.bySection[it.section] || 0) + 1;
//       if (typeof it.timeSpentMinutes === "number") agg.totalTimeMinutes += it.timeSpentMinutes;
//     }
//     return sendSuccessResponse(res, 200, "Monthly analytics", { from, to, months, agg });
//   } catch (err: any) {
//     console.error("analyticsMonthly error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to compute monthly analytics");
//   }
// }
























// // src/controllers/dailyStatus.controller.ts
// import { Request, Response } from "express";
// import { prisma } from "../../config/database.config";
// import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
// import { isValid, parseISO, startOfDay, endOfDay } from "date-fns";
// import { getIo } from "../../core/utils/socket";

// /**
//  * Helpers
//  */
// const getAccountIdFromReqUser = async (userId?: string | null) => {
//   if (!userId) return null;
//   const u = await prisma.user.findUnique({
//     where: { id: userId },
//     select: { accountId: true },
//   });
//   return u?.accountId ?? null;
// };

// function normalizeDateToStart(date?: string) {
//   if (!date) return startOfDay(new Date());
//   try {
//     const d = parseISO(date);
//     if (!isValid(d)) return startOfDay(new Date());
//     return startOfDay(d);
//   } catch {
//     return startOfDay(new Date());
//   }
// }

// /* ============================
//    CRUD: Create / Upsert Report
//    POST /api/v1/user/ds/reports
//    Body: {
//      reportDate?: "YYYY-MM-DD",
//      summary?: string,
//      items?: [...],
//      state?: "DRAFT" | "SUBMITTED"
//    }
// ============================ */
// export async function createOrUpdateReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { reportDate, summary, items, state } = req.body as any;
//     const day = normalizeDateToStart(reportDate);

//     const existing = await prisma.dailyStatusReport.findUnique({
//       where: { accountId_reportDate: { accountId, reportDate: day } as any },
//     });

//     if (existing && existing.state !== "DRAFT" && state === "SUBMITTED") {
//       return sendErrorResponse(res, 400, "Cannot modify submitted report");
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       const report = existing
//         ? await tx.dailyStatusReport.update({
//             where: { id: existing.id },
//             data: { 
//               summary: summary ?? existing.summary,
//               state: state ?? existing.state,
//               updatedAt: new Date()
//             },
//           })
//         : await tx.dailyStatusReport.create({
//             data: {
//               accountId,
//               reportDate: day,
//               summary: summary ?? null,
//               state: state ?? "DRAFT",
//             },
//           });

//       if (Array.isArray(items) && items.length > 0) {
//         // Remove existing items if updating
//         if (existing) {
//           await tx.dailyStatusItem.deleteMany({ where: { reportId: report.id } });
//         }
        
//         const toCreate = items.map((it: any) => ({
//           reportId: report.id,
//           section: it.section,
//           entityType: it.entityType ?? null,
//           entityId: it.entityId ?? null,
//           title: it.title ?? null,
//           note: it.note ?? "",
//           raisedToAccountId: it.raisedToAccountId ?? null,
//           resolved: Boolean(it.resolved ?? false),
//           timeSpentMinutes: typeof it.timeSpentMinutes === "number" ? it.timeSpentMinutes : null,
//         }));
        
//         if (toCreate.length > 0) {
//           await tx.dailyStatusItem.createMany({ data: toCreate });
//         }
//       }

//       return tx.dailyStatusReport.findUnique({
//         where: { id: report.id },
//         include: { 
//           items: { orderBy: { createdAt: "asc" } },
//           account: { select: { id: true, firstName: true, lastName: true } }
//         },
//       });
//     });

//     return sendSuccessResponse(res, existing ? 200 : 201, existing ? "Report updated" : "Report created", result);
//   } catch (err: any) {
//     console.error("createOrUpdateReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to save report");
//   }
// }

// /* ============================
//    GET my report for a date
//    GET /api/v1/user/ds/reports/my?date=YYYY-MM-DD
// ============================ */
// export async function getMyReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { date } = req.query as Record<string, string>;
//     const day = normalizeDateToStart(date);

//     const report = await prisma.dailyStatusReport.findUnique({
//       where: { accountId_reportDate: { accountId, reportDate: day } as any },
//       include: { 
//         items: { orderBy: { createdAt: "asc" } },
//         account: { select: { id: true, firstName: true, lastName: true } }
//       },
//     });

//     if (!report) {
//       // Return empty structure for easy form initialization
//       return sendSuccessResponse(res, 200, "No report found", {
//         reportDate: day,
//         state: "DRAFT",
//         summary: null,
//         items: []
//       });
//     }

//     return sendSuccessResponse(res, 200, "Report fetched", report);
//   } catch (err: any) {
//     console.error("getMyReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to fetch report");
//   }
// }

// /* ============================
//    ADD single item to report
//    POST /api/v1/user/ds/reports/:id/items
//    Body: { section, entityType?, entityId?, title?, note, timeSpentMinutes?, raisedToAccountId? }
// ============================ */
// export async function addItemToReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { id } = req.params;
//     const itemData = req.body;

//     const report = await prisma.dailyStatusReport.findUnique({ where: { id } });
//     if (!report) return sendErrorResponse(res, 404, "Report not found");
//     if (report.accountId !== accountId) return sendErrorResponse(res, 403, "Not authorized");
//     if (report.state !== "DRAFT") return sendErrorResponse(res, 400, "Cannot modify submitted report");

//     const newItem = await prisma.dailyStatusItem.create({
//       data: {
//         reportId: id,
//         section: itemData.section,
//         entityType: itemData.entityType ?? null,
//         entityId: itemData.entityId ?? null,
//         title: itemData.title ?? null,
//         note: itemData.note ?? "",
//         raisedToAccountId: itemData.raisedToAccountId ?? null,
//         resolved: Boolean(itemData.resolved ?? false),
//         timeSpentMinutes: typeof itemData.timeSpentMinutes === "number" ? itemData.timeSpentMinutes : null,
//       }
//     });

//     return sendSuccessResponse(res, 201, "Item added", newItem);
//   } catch (err: any) {
//     console.error("addItemToReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to add item");
//   }
// }

// /* ============================
//    UPDATE single item
//    PATCH /api/v1/user/ds/items/:itemId
// ============================ */
// export async function updateItem(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { itemId } = req.params;
//     const updates = req.body;

//     const item = await prisma.dailyStatusItem.findUnique({
//       where: { id: itemId },
//       include: { report: true }
//     });

//     if (!item) return sendErrorResponse(res, 404, "Item not found");
//     if (item.report.accountId !== accountId) return sendErrorResponse(res, 403, "Not authorized");
//     if (item.report.state !== "DRAFT") return sendErrorResponse(res, 400, "Cannot modify submitted report");

//     const updated = await prisma.dailyStatusItem.update({
//       where: { id: itemId },
//       data: {
//         section: updates.section ?? item.section,
//         title: updates.title ?? item.title,
//         note: updates.note ?? item.note,
//         timeSpentMinutes: updates.timeSpentMinutes ?? item.timeSpentMinutes,
//         resolved: updates.resolved ?? item.resolved,
//         raisedToAccountId: updates.raisedToAccountId ?? item.raisedToAccountId,
//       }
//     });

//     return sendSuccessResponse(res, 200, "Item updated", updated);
//   } catch (err: any) {
//     console.error("updateItem error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to update item");
//   }
// }

// /* ============================
//    DELETE single item
//    DELETE /api/v1/user/ds/items/:itemId
// ============================ */
// export async function deleteItem(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { itemId } = req.params;

//     const item = await prisma.dailyStatusItem.findUnique({
//       where: { id: itemId },
//       include: { report: true }
//     });

//     if (!item) return sendErrorResponse(res, 404, "Item not found");
//     if (item.report.accountId !== accountId) return sendErrorResponse(res, 403, "Not authorized");
//     if (item.report.state !== "DRAFT") return sendErrorResponse(res, 400, "Cannot modify submitted report");

//     await prisma.dailyStatusItem.delete({ where: { id: itemId } });

//     return sendSuccessResponse(res, 200, "Item deleted", { id: itemId });
//   } catch (err: any) {
//     console.error("deleteItem error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to delete item");
//   }
// }

// /* ============================
//    POST /api/v1/user/ds/reports/:id/submit
// ============================ */
// export async function submitReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     const accountId = await getAccountIdFromReqUser(userId);
//     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

//     const { id } = req.params;
//     const existing = await prisma.dailyStatusReport.findUnique({ 
//       where: { id }, 
//       include: { items: true } 
//     });
    
//     if (!existing) return sendErrorResponse(res, 404, "Report not found");
//     if (existing.accountId !== accountId) return sendErrorResponse(res, 403, "Not authorized");
//     if (existing.state !== "DRAFT") return sendErrorResponse(res, 400, "Report already submitted");
//     if (!existing.items || existing.items.length === 0) {
//       return sendErrorResponse(res, 400, "Report must contain at least one item");
//     }

//     const updated = await prisma.dailyStatusReport.update({
//       where: { id },
//       data: { state: "SUBMITTED", submittedAt: new Date() },
//       include: { items: true, account: { select: { firstName: true, lastName: true } } }
//     });

//     // Notify managers
//     try {
//       const io = getIo();
//       await prisma.notification.create({
//         data: {
//           accountId: null,
//           category: "REMINDER",
//           level: "INFO",
//           title: "Daily Status Submitted",
//           body: `${updated.account.firstName} ${updated.account.lastName} submitted daily status`,
//           payload: { reportId: id, accountId: existing.accountId },
//           createdBy: existing.accountId,
//           sentAt: new Date(),
//         },
//       });
//       io.emit("notification:daily_status_submitted", { reportId: id });
//     } catch (e) {
//       console.warn("submitReport: notification failed", e);
//     }

//     return sendSuccessResponse(res, 200, "Report submitted successfully", updated);
//   } catch (err: any) {
//     console.error("submitReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to submit report");
//   }
// }

// /* ============================
//    Prefill from assigned tasks/leads
//    POST /api/v1/user/ds/prefill
// ============================ */
// // export async function applyPrefill(req: Request, res: Response) {
// //   try {
// //     const userId = req.user?.id;
// //     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
// //     const accountId = await getAccountIdFromReqUser(userId);
// //     if (!accountId) return sendErrorResponse(res, 401, "Invalid session user");

// //     const { date } = req.body;
// //     const day = normalizeDateToStart(date);
// //     const dayEnd = endOfDay(day);

// //     // Fetch assigned tasks and leads updated today
// //     const [tasks, leads] = await Promise.all([
// //       prisma.task.findMany({
// //         where: {
// //           assignments: { some: { accountId, status: "PENDING" } },
// //           status: { in: ["PENDING", "IN_PROGRESS"] },
// //           updatedAt: { gte: day, lte: dayEnd },
// //         },
// //         select: { id: true, title: true, status: true },
// //         take: 20,
// //       }),
// //       prisma.lead.findMany({
// //         where: {
// //           assignments: { some: { accountId, isActive: true } },
// //           status: { in: ["PENDING", "IN_PROGRESS"] },
// //           updatedAt: { gte: day, lte: dayEnd },
// //         },
// //         select: { id: true, customerName: true, productTitle: true },
// //         take: 20,
// //       }),
// //     ]);

// //     const items = [
// //       ...tasks.map((t) => ({
// //         section: t.status === "IN_PROGRESS" ? "IN_PROGRESS" : "WORKED_ON",
// //         entityType: "TASK",
// //         entityId: t.id,
// //         title: t.title,
// //         note: `Working on: ${t.title}`,
// //       })),
// //       ...leads.map((l) => ({
// //         section: "IN_PROGRESS",
// //         entityType: "LEAD",
// //         entityId: l.id,
// //         title: l.customerName,
// //         note: `Lead: ${l.customerName}${l.productTitle ? ` - ${l.productTitle}` : ''}`,
// //       })),
// //     ];

// //     const report = await prisma.$transaction(async (tx) => {
// //       const report = await tx.dailyStatusReport.upsert({
// //         where: { accountId_reportDate: { accountId, reportDate: day } },
// //         update: { updatedAt: new Date() },
// //         create: {
// //           accountId,
// //           reportDate: day,
// //           state: "DRAFT",
// //           summary: "Auto-prefilled from today's assignments",
// //         },
// //       });

// //       // Add items that don't already exist
// //       for (const item of items) {
// //         const exists = await tx.dailyStatusItem.findFirst({
// //           where: {
// //             reportId: report.id,
// //             entityId: item.entityId,
// //           },
// //         });
        
// //         if (!exists) {
// //           await tx.dailyStatusItem.create({
// //             data: { ...item, reportId: report.id }
// //           });
// //         }
// //       }

// //       return tx.dailyStatusReport.findUnique({
// //         where: { id: report.id },
// //         include: { items: { orderBy: { createdAt: "asc" } } },
// //       });
// //     });

// //     return sendSuccessResponse(res, 200, `Prefilled with ${items.length} items`, report);
// //   } catch (err: any) {
// //     console.error("applyPrefill error:", err);
// //     return sendErrorResponse(res, 500, err?.message ?? "Failed to prefill");
// //   }
// // }

// /* ============================
//    Review Report (Admin)
//    POST /api/v1/user/ds/reports/:id/review
// ============================ */
// export async function reviewReport(req: Request, res: Response) {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return sendErrorResponse(res, 401, "Unauthorized");
//     if (!req.user?.roles?.includes?.("ADMIN")) {
//       return sendErrorResponse(res, 403, "Admin access required");
//     }
//     const accountId = await getAccountIdFromReqUser(userId);

//     const { id } = req.params;
//     const { reviewNote, approve } = req.body as { reviewNote?: string; approve?: boolean };

//     const existing = await prisma.dailyStatusReport.findUnique({ where: { id } });
//     if (!existing) return sendErrorResponse(res, 404, "Report not found");
//     if (existing.state !== "SUBMITTED") {
//       return sendErrorResponse(res, 400, "Only submitted reports can be reviewed");
//     }

//     const updated = await prisma.dailyStatusReport.update({
//       where: { id },
//       data: {
//         state: "REVIEWED",
//         reviewedAt: new Date(),
//         reviewedBy: accountId,
//         reviewNote: reviewNote ?? null,
//       },
//     });

//     // Notify report owner
//     try {
//       const io = getIo();
//       await prisma.notification.create({
//         data: {
//           accountId: existing.accountId,
//           category: "SYSTEM",
//           level: approve ? "SUCCESS" : "INFO",
//           title: "Daily Status Reviewed",
//           body: reviewNote ?? (approve ? "Your report has been approved" : "Your report has been reviewed"),
//           payload: { reportId: id, approve: Boolean(approve) },
//           createdBy: accountId,
//           sentAt: new Date(),
//         },
//       });
//       io.to(`notif:${existing.accountId}`).emit("notification", {
//         type: "daily_status_reviewed",
//         reportId: id,
//         approve: Boolean(approve)
//       });
//     } catch (e) {
//       console.warn("reviewReport: notification failed", e);
//     }

//     return sendSuccessResponse(res, 200, "Report reviewed", updated);
//   } catch (err: any) {
//     console.error("reviewReport error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to review");
//   }
// }

// /* ============================
//    List Reports (Admin)
//    GET /api/v1/user/ds/reports
// ============================ */
// export async function listReportsAdmin(req: Request, res: Response) {
//   try {
//     if (!req.user?.roles?.includes?.("ADMIN")) {
//       return sendErrorResponse(res, 403, "Admin access required");
//     }

//     const { accountId, fromDate, toDate, state, page = "1", limit = "50" } = req.query as Record<string, string>;
//     const pageNumber = Math.max(Number(page) || 1, 1);
//     const pageSize = Math.min(Number(limit) || 50, 200);

//     const where: any = {};
//     if (accountId) where.accountId = accountId;
//     if (state) where.state = state;
//     if (fromDate || toDate) {
//       where.reportDate = {};
//       if (fromDate) where.reportDate.gte = normalizeDateToStart(fromDate);
//       if (toDate) where.reportDate.lte = normalizeDateToStart(toDate);
//     }

//     const [total, reports] = await prisma.$transaction([
//       prisma.dailyStatusReport.count({ where }),
//       prisma.dailyStatusReport.findMany({
//         where,
//         include: {
//           items: true,
//           account: { select: { id: true, firstName: true, lastName: true } }
//         },
//         orderBy: { reportDate: "desc" },
//         skip: (pageNumber - 1) * pageSize,
//         take: pageSize,
//       }),
//     ]);

//     return sendSuccessResponse(res, 200, "Reports fetched", {
//       data: reports,
//       meta: { page: pageNumber, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
//     });
//   } catch (err: any) {
//     console.error("listReportsAdmin error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to list reports");
//   }
// }

// /* ============================
//    Analytics
// ============================ */
// export async function analyticsWeekly(req: Request, res: Response) {
//   try {
//     const { accountId, weeks = "4" } = req.query as Record<string, string>;
//     const weeksNum = Math.max(Number(weeks) || 4, 1);

//     const to = new Date();
//     const from = new Date();
//     from.setDate(from.getDate() - weeksNum * 7);

//     const where: any = { reportDate: { gte: from, lte: to } };
//     if (accountId) where.accountId = accountId;

//     const [reports, items] = await Promise.all([
//       prisma.dailyStatusReport.findMany({ where, select: { state: true, reportDate: true } }),
//       prisma.dailyStatusItem.findMany({
//         where: { report: where },
//         select: { section: true, timeSpentMinutes: true, createdAt: true }
//       })
//     ]);

//     const bySection: Record<string, number> = {};
//     let totalTimeMinutes = 0;

//     items.forEach(item => {
//       bySection[item.section] = (bySection[item.section] || 0) + 1;
//       if (item.timeSpentMinutes) totalTimeMinutes += item.timeSpentMinutes;
//     });

//     const submittedCount = reports.filter(r => r.state === "SUBMITTED" || r.state === "REVIEWED").length;

//     return sendSuccessResponse(res, 200, "Weekly analytics", {
//       from,
//       to,
//       weeks: weeksNum,
//       stats: {
//         bySection,
//         totalTimeMinutes,
//         totalTimeHours: Math.round(totalTimeMinutes / 60 * 10) / 10,
//         reportsSubmitted: submittedCount,
//         totalReports: reports.length
//       }
//     });
//   } catch (err: any) {
//     console.error("analyticsWeekly error:", err);
//     return sendErrorResponse(res, 500, err?.message ?? "Failed to compute analytics");
//   }
// }