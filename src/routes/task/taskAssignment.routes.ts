// import { Router } from "express";

// import { requireAuth, requireRole } from "../../core/middleware/auth";
// import { assignTaskToUser, createAndAssignTask, getAssignedUserForTask, getMyTasks, updateAssignmentStatus } from "../../controller/task/taskAssignment.controller";

// const router = Router();

// // Only admins should assign tasks
// router.post(
//   "/create",
//   requireAuth,
//   requireRole("ADMIN"),
//   createAndAssignTask
// );

// router.get("/my", requireAuth, getMyTasks);

// router.put(
//   "/assignment-status",
//   requireAuth,
//   updateAssignmentStatus
// );





// router.post(
//   "/assign",
//   requireAuth,
//   requireRole("ADMIN"),
//   assignTaskToUser
// );

// // Get assigned user
// router.get(
//   "/:taskId/assigned-user",
//   requireAuth,
//   requireRole("ADMIN"),
//   getAssignedUserForTask
// );

// export default router;
