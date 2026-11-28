// src/core/job/index.ts
import cron from "node-cron";
import { autoFinalizeAttendance } from "./attendance/attendance.auto";
import { registerRecurringTaskJob } from "./recurringTask/recurringTask.job";
import { registerProductSyncJob } from "./product/product-sync.job";

console.log("Job scheduler initialized.");


cron.schedule(
  "55 18 * * *",
  async () => {
    // 18:55 IST (6:55 PM Asia/Kolkata) daily: closes open sessions, syncs leaves/holidays, marks absent on Mon-Sat working days
    await autoFinalizeAttendance();
  },
  { timezone: "Asia/Kolkata" },
);


registerRecurringTaskJob();

registerProductSyncJob();