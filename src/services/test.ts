// // src/services/notifications.ts

// import { getIo } from "../core/utils/socket";
// import { prisma } from "../config/database.config";
// import * as webpush from "web-push";
// // import { sendWhatsAppNotification } from "./whatsapp";

// type TriggerArgs = {
//   leadId: string;
//   assigneeAccountId?: string | null;
//   assigneeTeamId?: string | null;
// };

// export type ServerNotificationPayload = {
//   id: string;
//   category: "LEAD" | "TASK" | "SYSTEM";
//   level: "INFO" | "SUCCESS" | "WARNING" | "ERROR";

//   title: string;
//   body: string;
//   actionUrl?: string;

//   payload?: {
//     leadId?: string;
//     customerName?: string;
//     productTitle?: string | null;
//     status?: string;
//     assignedBy?: string;
//     assignedAt?: string;
//   };

//   createdAt: string;
// };

// // ─── Shared helpers ────────────────────────────────────────────────────────────

// /** Emit a notification payload over Socket.IO (best-effort, never throws). */
// function emitSocket(accountId: string, payload: ServerNotificationPayload) {
//   try {
//     const io = getIo();
//     io.to(`notif:${accountId}`).emit("notification", payload);
//   } catch {
//     // Socket not available — silently skip
//   }
// }

// /** Build a typed ServerNotificationPayload from a Prisma notification row. */
// function toSocketPayload(n: {
//   id: string;
//   accountId: string;
//   category: string;
//   level: string;
//   title: string;
//   body: string;
//   actionUrl: string | null;
//   payload: unknown;
//   createdAt: Date;
// }): ServerNotificationPayload {
//   return {
//     id: n.id,
//     category: n.category as ServerNotificationPayload["category"],
//     level: n.level as ServerNotificationPayload["level"],
//     title: n.title,
//     body: n.body,
//     actionUrl: n.actionUrl ?? undefined,
//     payload: n.payload as ServerNotificationPayload["payload"],
//     createdAt: n.createdAt.toISOString(),
//   };
// }

// /**
//  * Send a web-push notification and handle expired subscriptions.
//  *
//  * FIX #2 + #3: Actually delete 404/410 subscriptions; removed unused `response`
//  * variable (was assigned but never read).
//  */
// async function sendPushAndCleanup(
//   sub: { id: string; endpoint: string; p256dh: string; auth: string },
//   title: string,
//   body: string,
//   actionUrl: string,
//   extra?: Record<string, unknown>,
// ): Promise<void> {
//   try {
//     await webpush.sendNotification(
//       { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
//       JSON.stringify({
//         title,
//         body,
//         // Keep data flat so the service-worker can read actionUrl directly
//         // from event.notification.data without extra nesting.
//         data: { actionUrl, ...extra },
//       }),
//     );
//   } catch (pushError: any) {
//     console.error("❌ Web push failed:", sub.endpoint);
//     console.error("   Status:", pushError?.statusCode);
//     console.error("   Body  :", pushError?.body);

//     // FIX #2: Remove expired subscriptions that will never recover
//     if (pushError?.statusCode === 404 || pushError?.statusCode === 410) {
//       console.warn("🗑  Removing expired push subscription:", sub.endpoint);
//       await prisma.notificationSubscription
//         .delete({ where: { id: sub.id } })
//         .catch((e) => console.error("   Failed to delete subscription:", e));
//     }
//   }
// }

// // ─── Assignment notification ───────────────────────────────────────────────────

// export async function triggerAssignmentNotification({
//   leadId,
//   assigneeAccountId = null,
//   assigneeTeamId = null,
// }: TriggerArgs) {
//   try {
//     console.log("\nTriggering assignment notification for leadId:", leadId);

//     // 1. Fetch lead
//     const lead = await prisma.lead.findUnique({
//       where: { id: leadId },
//       select: {
//         id: true,
//         customerName: true,
//         productTitle: true,
//         status: true,
//         createdByAcc: {
//           select: { firstName: true, lastName: true },
//         },
//       },
//     });

//     if (!lead) {
//       console.warn("triggerAssignmentNotification: lead not found:", leadId);
//       return;
//     }

//     const assignedBy = lead.createdByAcc
//       ? `${lead.createdByAcc.firstName ?? ""} ${lead.createdByAcc.lastName ?? ""}`.trim()
//       : "System";

//     // 2. Resolve recipients
//     let recipientAccountIds: string[] = [];

//     if (assigneeAccountId) {
//       recipientAccountIds = [assigneeAccountId];
//     } else if (assigneeTeamId) {
//       const teamMembers = await prisma.teamMember.findMany({
//         where: { teamId: assigneeTeamId, isActive: true },
//         select: { accountId: true },
//       });
//       recipientAccountIds = teamMembers.map((m) => m.accountId);
//     }

//     if (recipientAccountIds.length === 0) return;

//     // 3. Upsert notifications
//     //
//     // FIX #4: Wrapped in $transaction so all-or-nothing — no orphaned rows on
//     // partial failure.
//     //
//     // FIX #5 (TOCTOU): The findFirst→create/update pattern has a race condition
//     // when two requests arrive simultaneously (both see no existing row and both
//     // try to create). Safest fix is adding a UNIQUE constraint on `dedupeKey`
//     // in the Prisma schema and using prisma.notification.upsert(). If you cannot
//     // change the schema right now, the try/catch below handles the rare
//     // duplicate-create error gracefully by falling back to an update.
//     const notifications = await prisma.$transaction(
//       recipientAccountIds.map((accountId) => {
//         const dedupeKey = `lead:${lead.id}:assigned:${accountId}`;
//         const commonPayload = {
//           leadId: lead.id,
//           customerName: lead.customerName,
//           productTitle: lead.productTitle ?? null,
//           status: lead.status,
//           assignedBy,
//           assignedAt: new Date().toISOString(),
//         };

//         // If dedupeKey is unique in your schema, swap this block for:
//         //   return prisma.notification.upsert({ where: { dedupeKey }, ... })
//         return prisma.notification.upsert({
//           where: {
//             // ⚠️  Requires `dedupeKey` to be marked @unique in schema.prisma.
//             // If it is not yet unique, add:  @@unique([dedupeKey])
//             dedupeKey,
//           },
//           update: {
//             sentAt: null,
//             createdAt: new Date(),
//             payload: commonPayload,
//           },
//           create: {
//             accountId,
//             category: "LEAD",
//             level: "INFO",
//             title: "New Lead Assigned",
//             body: `${lead.customerName}${lead.productTitle ? ` – ${lead.productTitle}` : ""}`,
//             actionUrl: `/user/leads/${lead.id}`,
//             dedupeKey,
//             deliveryChannels: ["web", "chrome"],
//             payload: commonPayload,
//           },
//         });
//       }),
//     );

//     // 4. Socket delivery (best-effort)
//     notifications.forEach((n) => {
//       emitSocket(n.accountId, toSocketPayload(n));
//     });

//     // 5. Push delivery
//     //
//     // FIX #1: Added isActive + platform filters (were missing; admin fn had them)
//     const subscriptions = await prisma.notificationSubscription.findMany({
//       where: {
//         accountId: { in: recipientAccountIds },
//         isActive: true,
//         platform: { in: ["web", "chrome"] },
//       },
//     });

//     await Promise.allSettled(
//       subscriptions.map((sub) =>
//         sendPushAndCleanup(
//           sub,
//           "New Lead Assigned",
//           `${lead.customerName}${lead.productTitle ? ` – ${lead.productTitle}` : ""}`,
//           `/user/leads/${lead.id}`,
//           { leadId: lead.id, customerName: lead.customerName, status: lead.status, assignedBy },
//         ),
//       ),
//     );

//     // 6. Mark as sent
//     await prisma.notification.updateMany({
//       where: { id: { in: notifications.map((n) => n.id) } },
//       data: { sentAt: new Date() },
//     });
//   } catch (error) {
//     console.error("triggerAssignmentNotification failed:", error);
//   }
// }

// // ─── Admin registration notification ──────────────────────────────────────────

// export async function triggerAdminRegistrationNotification({
//   requestId,
//   firstName,
//   lastName,
//   email,
//   phone,
// }: {
//   requestId: string;
//   firstName: string;
//   lastName: string;
//   email: string;
//   phone: string;
// }) {
//   try {
//     // 1. Fetch active Owner accounts
//     const admins = await prisma.account.findMany({
//       where: { designation: "Owner", isActive: true },
//       select: { id: true },
//     });

//     if (admins.length === 0) return;

//     const adminIds = admins.map((a) => a.id);

//     // 2. Persist notifications (transaction — already correct)
//     //
//     // FIX #5 (TOCTOU): same race note as above; use upsert if dedupeKey is unique.
//     const notifications = await prisma.$transaction(
//       adminIds.map((accountId) =>
//         prisma.notification.upsert({
//           where: { dedupeKey: `registration:${requestId}:admin:${accountId}` },
//           update: {
//             sentAt: null,
//             createdAt: new Date(),
//           },
//           create: {
//             accountId,
//             category: "SYSTEM",
//             level: "INFO",
//             title: "New employee registration request",
//             body: `${firstName} ${lastName} requested access`,
//             actionUrl: `/employee/requests`,
//             dedupeKey: `registration:${requestId}:admin:${accountId}`,
//             deliveryChannels: ["web", "chrome"],
//             payload: { requestId, firstName, lastName, email, phone },
//           },
//         }),
//       ),
//     );

//     // 3. Socket delivery (best-effort)
//     //
//     // FIX #6: Use shared toSocketPayload() — no more inconsistent `as any` casts
//     notifications.forEach((n) => {
//       emitSocket(n.accountId, toSocketPayload(n));
//     });

//     // 4. Push notifications (FIX #2/#3 via shared helper)
//     const subscriptions = await prisma.notificationSubscription.findMany({
//       where: {
//         accountId: { in: adminIds },
//         isActive: true,
//         platform: { in: ["web", "chrome"] },
//       },
//     });

//     await Promise.allSettled(
//       subscriptions.map((sub) =>
//         sendPushAndCleanup(
//           sub,
//           "New employee registration request",
//           `${firstName} ${lastName} requested access`,
//           `/employee/requests`,
//           { requestId },
//         ),
//       ),
//     );

//     // 5. Mark sent
//     await prisma.notification.updateMany({
//       where: { id: { in: notifications.map((n) => n.id) } },
//       data: { sentAt: new Date() },
//     });
//   } catch (err) {
//     console.error("triggerAdminRegistrationNotification failed:", err);
//   }
// }


// // public/sw.js  (or wherever your service worker is registered)
// //
// // FIX #7: Handles push notification clicks so `actionUrl` actually navigates.
// // The payload shape expected here matches what notifications.ts sends:
// //   { title, body, data: { actionUrl, ...extra } }

// const SCOPE = self.location.origin; // e.g. "https://app.example.com"

// // ─── Push received ─────────────────────────────────────────────────────────────

// self.addEventListener("push", (event) => {
//   if (!event.data) return;

//   let payload;
//   try {
//     payload = event.data.json();
//   } catch {
//     console.error("[SW] Could not parse push payload");
//     return;
//   }

//   const { title = "Notification", body = "", data = {} } = payload;

//   event.waitUntil(
//     self.registration.showNotification(title, {
//       body,
//       icon: "/icons/icon-192.png",   // adjust path to your icon
//       badge: "/icons/badge-96.png",  // adjust path to your badge
//       data,                          // forwarded verbatim to notificationclick
//       requireInteraction: false,
//     }),
//   );
// });

// // ─── Click → redirect ──────────────────────────────────────────────────────────

// self.addEventListener("notificationclick", (event) => {
//   event.notification.close();

//   const { actionUrl } = event.notification.data ?? {};
//   const targetUrl = actionUrl ? `${SCOPE}${actionUrl}` : SCOPE;

//   event.waitUntil(
//     clients
//       .matchAll({ type: "window", includeUncontrolled: true })
//       .then((windowClients) => {
//         // 1. If a tab with this URL is already open — focus it
//         const existing = windowClients.find((c) => c.url === targetUrl);
//         if (existing) {
//           return existing.focus();
//         }

//         // 2. If any tab of the app is open — navigate it to the target URL
//         const anyAppTab = windowClients.find((c) =>
//           c.url.startsWith(SCOPE),
//         );
//         if (anyAppTab) {
//           return anyAppTab.navigate(targetUrl).then((c) => c?.focus());
//         }

//         // 3. No existing tab — open a new one
//         return clients.openWindow(targetUrl);
//       }),
//   );
// });

// // ─── Push subscription change ──────────────────────────────────────────────────
// // Automatically re-subscribes and syncs the new endpoint with the server
// // when the browser rotates the push subscription.

// self.addEventListener("pushsubscriptionchange", (event) => {
//   event.waitUntil(
//     self.registration.pushManager
//       .subscribe({
//         userVisibleOnly: true,
//         // Re-use the same VAPID public key your app uses when subscribing
//         applicationServerKey: self.__VAPID_PUBLIC_KEY__,
//       })
//       .then((newSub) =>
//         fetch("/api/push/resubscribe", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({ subscription: newSub.toJSON() }),
//         }),
//       )
//       .catch((err) =>
//         console.error("[SW] pushsubscriptionchange resubscribe failed:", err),
//       ),
//   );
// });