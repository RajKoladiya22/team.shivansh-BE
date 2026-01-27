// src/config/webpush.config.ts
import webpush from "web-push";
import { env } from "./database.config";

export function initWebPush() {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn("⚠️ VAPID keys not configured. Web Push disabled.");
    return;
  }

  webpush.setVapidDetails(
    "mailto:Shivansh Infosys <magicallydev@gmail.com>",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  console.log("✅ Web Push VAPID configured");
}
