// // scripts/dsuReminders.ts
// import { prisma } from "../../../config/database.config";
// import { getIo } from "../socket";
// import { startOfDay, subDays } from "date-fns";
// import { NotificationCategory, NotificationLevel } from "@prisma/client";

// export async function checkMissedDailyReportsForYesterday() {
//   const yesterday = startOfDay(subDays(new Date(), 1));

//   // find active accounts that should submit a report (isActive true)
//   const accounts = await prisma.account.findMany({ where: { isActive: true }, select: { id: true } });

//   const accountIds = accounts.map((a) => a.id);
//   if (accountIds.length === 0) return;

//   // find accounts that DID submit yesterday
//   const submitted = await prisma.dailyStatusReport.findMany({
//     where: { reportDate: yesterday, state: { in: ["SUBMITTED", "REVIEWED"] } },
//     select: { accountId: true },
//   });
//   const submittedSet = new Set(submitted.map((s) => s.accountId));

//   const missing = accountIds.filter((id) => !submittedSet.has(id));
//   if (missing.length === 0) return;
//   // create notifications and emit
//   const io = getIo();
//   const notifs = missing.map((accId) => ({
//     accountId: accId,
//     category: NotificationCategory.REMINDER,
//     level: NotificationLevel.WARNING,
//     title: "Daily Status Missing",
//     body: `You did not submit your daily status for ${yesterday.toISOString().slice(0,10)}.`,
//     payload: { type: "daily_status_missed", reportDate: yesterday.toISOString() },
//     createdBy: null,
//     sentAt: new Date(),
//   }));
//   await prisma.notification.createMany({ data: notifs });
//   await prisma.notification.createMany({ data: notifs });

//   for (const accId of missing) {
//     io.to(`notif:${accId}`).emit("notification", { type: "daily_status_missed", reportDate: yesterday.toISOString() });
//   }

//   console.log(`DSU Reminders sent to ${missing.length} accounts`);
// }

// // If you want to run every day at 20:00, use node-cron or system cron. Example with node-cron:
// // import cron from "node-cron";
// // cron.schedule("0 20 * * *", () => checkMissedDailyReportsForYesterday());

