import { Router } from "express";
import {
  subscribeNotifications,
  unsubscribeNotifications,
  getNotificationSubscriptionStatus,
  deleteNotificationSubscription
} from "../../controller/auth/notificationSubscription.controller";
import { requireAuth } from "../../core/middleware/auth";

const router = Router();

router.post("/subscribe", requireAuth, subscribeNotifications);
router.post("/unsubscribe", requireAuth, unsubscribeNotifications);
router.delete("/subscription", requireAuth, deleteNotificationSubscription);
router.get(
  "/subscription-status",
  requireAuth,
  getNotificationSubscriptionStatus,
);

export default router;
