// src/routes/notifications/notification.user.routes.ts
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import {
  listMyNotifications,
  getMyNotificationById,
  markNotificationRead,
  markAllNotificationsRead,
  hideNotification,
  getUnreadNotificationCount,
} from "../../controller/user/notification.controller";

const router = Router();

router.get("/", requireAuth, listMyNotifications);
router.get("/unread-count", requireAuth, getUnreadNotificationCount);
router.get("/:id", requireAuth, getMyNotificationById);
router.patch("/:id/read", requireAuth, markNotificationRead);
router.patch("/read-all", requireAuth, markAllNotificationsRead);
router.patch("/:id/hide", requireAuth, hideNotification);

export default router;
