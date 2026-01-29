// // src/routes/user/dailyStatus.routes.ts
// import { Router } from "express";
// import { requireAuth } from "../../core/middleware/auth";
// import {
//   // analyticsMonthly,
//   createOrUpdateReport,
//   getMyReport,
//   // patchReport,
//   submitReport,
//   reviewReport,
//   listReportsAdmin,
//   // prefillReport,
//   // applyPrefill,
//   analyticsWeekly,
// } from "../../controller/user/dailyStatus.controller";

// const router = Router();

// // member endpoints
// router.post("/reports", requireAuth, createOrUpdateReport);
// router.get("/reports/my", requireAuth, getMyReport);
// // router.patch("/reports/:id", requireAuth, patchReport);
// router.post("/reports/:id/submit", requireAuth, submitReport);

// // prefill from assignments
// // router.get("/prefill/verify", requireAuth, prefillReport);
// // router.post("/prefill", requireAuth, applyPrefill);

// // admin endpoints
// router.post("/reports/:id/review", requireAuth, reviewReport);
// router.get("/reports", requireAuth, listReportsAdmin);

// // analytics
// router.get("/analytics/weekly", requireAuth, analyticsWeekly);
// // router.get("/analytics/monthly", requireAuth, analyticsMonthly);

// export default router;
