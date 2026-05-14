// src/core/job/index.ts
import cron from "node-cron";
import { autoFinalizeAttendance } from "./attendance/attendance.auto";
import { registerRecurringTaskJob } from "./recurringTask/recurringTask.job";
import { registerProductSyncJob } from "./product/product-sync.job";

console.log("Job scheduler initialized.");


cron.schedule("55 18 * * 1-6", async () => {
  // 18:55 = 6:55 PM
  await autoFinalizeAttendance();
});


registerRecurringTaskJob();

registerProductSyncJob();