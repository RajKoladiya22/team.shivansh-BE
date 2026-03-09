// // src/routes/admin/holiday.routes.ts
// import { Router } from "express";
// import {
//   adminGetHolidays,
//   adminGetHolidayById,
//   adminCreateHoliday,
//   adminBulkCreateHolidays,
//   adminUpdateHoliday,
//   adminDeleteHoliday,
//   adminSeedNextYearHolidays,
//   adminSyncHolidayAttendance,
// } from "../../controller/admin/holiday.controller";
// import { requireAuth } from "../../core/middleware/auth";

// const router = Router();

// router.use(requireAuth); // all holiday routes require auth — admin guard is inside each handler

// /* ── Listing ── */
// router.get("/", adminGetHolidays); // GET  /admin/holidays
// router.get("/:id", adminGetHolidayById); // GET  /admin/holidays/:id

// /* ── Creation ── */
// router.post("/", adminCreateHoliday); // POST /admin/holidays
// router.post("/bulk", adminBulkCreateHolidays); // POST /admin/holidays/bulk

// /* ── Mutation ── */
// router.patch("/:id", adminUpdateHoliday); // PATCH /admin/holidays/:id
// router.delete("/:id", adminDeleteHoliday); // DELETE /admin/holidays/:id

// /* ── Utilities ── */
// router.post("/seed-next-year", adminSeedNextYearHolidays); // POST /admin/holidays/seed-next-year
// router.post("/:id/sync-attendance", adminSyncHolidayAttendance); // POST /admin/holidays/:id/sync-attendance

// export default router;
