import { Request, Response } from "express";
import { prisma } from "../../config/database.config";

/**
 * POST /api/notifications/subscribe
 * Stores or updates push subscription
 */
export async function subscribeNotifications(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { subscription, platform } = req.body;

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return res.status(400).json({ message: "Invalid push subscription" });
    }
    let a =10;

    // USER → ACCOUNT
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });

    if (!user?.accountId) {
      return res.status(400).json({ message: "Invalid user account" });
    }

    await prisma.notificationSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        accountId: user.accountId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        platform: platform ?? "web",
        userAgent: req.headers["user-agent"],
        isActive: true,
      },
      update: {
        accountId: user.accountId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        platform: platform ?? "web",
        isActive: true,
        updatedAt: new Date(),
      },
    });

    return res.status(201).json({
      message: "Notification subscription saved",
    });
  } catch (err) {
    console.error("subscribeNotifications error:", err);
    return res
      .status(500)
      .json({ message: "Failed to subscribe notifications" });
  }
}

/**
 * POST /api/notifications/unsubscribe
 * Deactivates a push subscription
 */
export async function unsubscribeNotifications(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { endpoint } = req.body;
    if (!endpoint)
      return res.status(400).json({ message: "Endpoint required" });

    await prisma.notificationSubscription.updateMany({
      where: { endpoint },
      data: { isActive: false },
    });

    return res.json({ message: "Unsubscribed successfully" });
  } catch (err) {
    console.error("unsubscribeNotifications error:", err);
    return res.status(500).json({ message: "Failed to unsubscribe" });
  }
}

/**
 * GET /api/notifications/subscription-status
 * Used on login to know if we should prompt user
 */
export async function getNotificationSubscriptionStatus(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountId: true },
    });

    if (!user?.accountId)
      return res.status(400).json({ message: "Invalid user account" });

    const count = await prisma.notificationSubscription.count({
      where: {
        accountId: user.accountId,
        isActive: true,
      },
    });

    return res.json({
      subscribed: count > 0,
    });
  } catch (err) {
    console.error("getNotificationSubscriptionStatus error:", err);
    return res.status(500).json({ message: "Failed to fetch status" });
  }
}
