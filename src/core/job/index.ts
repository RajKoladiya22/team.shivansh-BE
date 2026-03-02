// src/core/job/index.ts
import cron from "node-cron";
import { autoFinalizeAttendance } from "./attendance/attendance.auto";

console.log("Job scheduler initialized.");


cron.schedule("15 19 * * 1-6", async () => {
  // 19:15 = 7:15 PM
  await autoFinalizeAttendance();
});

cron.schedule("55 18 * * 1-6", async () => {
  // 18:55 = 6:55 PM
  await autoFinalizeAttendance();
});