// // src/services/notifications.ts
// import { getIo } from "../core/utils/socket";
// import { prisma } from "../config/database.config";

// type TriggerArgs = {
//   leadId: string;
//   assigneeAccountId?: string | null;
//   assigneeTeamId?: string | null;
// };

// export async function triggerAssignmentNotification({
//   leadId,
//   assigneeAccountId = null,
//   assigneeTeamId = null,
// }: TriggerArgs) {
//   console.log("\n🔔 triggerAssignmentNotification called", {
//     leadId,
//     assigneeAccountId,
//     assigneeTeamId,
//   });

//   try {
//     const io = getIo();
//     console.log("\n✅ Socket IO instance acquired");

//     // Fetch minimal lead info for payload
//     const lead = await prisma.lead.findUnique({
//       where: { id: leadId },
//       select: {
//         id: true,
//         customerName: true,
//         productTitle: true,
//         cost: true,
//         status: true,
//         createdAt: true,
//         createdBy: true,
//         createdByAcc: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//       },
//     });

//     if (!lead) {
//       console.warn("⚠️ Lead not found for notification", leadId);
//       return;
//     }

//     console.log("\n📦 Lead fetched for notification", {
//       id: lead.id,
//       customerName: lead.customerName,
//     });

//     const payload = {
//       type: "lead_assigned",
//       leadId: lead.id,
//       lead: {
//         customerName: lead.customerName,
//         productTitle: lead.productTitle ?? null,
//         cost: lead.cost ?? null,
//         status: lead.status,
//         createdAt: lead.createdAt,
//       },
//       assignedAt: new Date().toISOString(),
//       assignedBy: lead.createdByAcc
//         ? {
//             id: lead.createdByAcc.id,
//             name: `${lead.createdByAcc.firstName ?? ""} ${lead.createdByAcc.lastName ?? ""}`.trim(),
//           }
//         : { id: lead.createdBy ?? null },
//     };

//     // ─────────────────────────────
//     // Account assignment
//     // ─────────────────────────────
//     if (assigneeAccountId) {
//       const room = `notif:${assigneeAccountId}`;

//       console.log("\n📤 Emitting notification to ACCOUNT", {
//         room,
//         leadId: lead.id,
//       });

//       io.to(room).emit("notification", payload);

//       console.log("\n✅ Notification emitted to account room", room);
//       return;
//     }

//     // ─────────────────────────────
//     // Team assignment
//     // ─────────────────────────────
//     if (assigneeTeamId) {
//       console.log("\n👥 Team assignment detected", assigneeTeamId);

//       const members = await prisma.teamMember.findMany({
//         where: { teamId: assigneeTeamId, isActive: true },
//         select: { accountId: true },
//       });

//       if (!members || members.length === 0) {
//         console.warn("⚠️ No active team members found", assigneeTeamId);
//         return;
//       }

//       console.log("\n👥 Active team members found", {
//         teamId: assigneeTeamId,
//         count: members.length,
//       });

//       for (const m of members) {
//         if (!m?.accountId) continue;

//         const room = `notif:${m.accountId}`;

//         console.log("\n📤 Emitting notification to TEAM MEMBER", {
//           room,
//           leadId: lead.id,
//         });

//         io.to(room).emit("notification", payload);
//       }

//       console.log("\n✅ Team notifications emitted", {
//         teamId: assigneeTeamId,
//         total: members.length,
//       });

//       return;
//     }

//     console.warn("⚠️ No assignee provided for notification", {
//       leadId,
//       assigneeAccountId,
//       assigneeTeamId,
//     });
//   } catch (err) {
//     console.error("❌ triggerAssignmentNotification error:", err);
//   }
// }



// import { getIo } from "../core/utils/socket";
// import { prisma } from "../config/database.config";
// import * as webpush from "web-push"; // enable when VAPID is configured

// type TriggerArgs = {
//   leadId: string;
//   assigneeAccountId?: string | null;
//   assigneeTeamId?: string | null;
// };

// export async function triggerAssignmentNotification({
//   leadId,
//   assigneeAccountId = null,
//   assigneeTeamId = null,
// }: TriggerArgs) {
//   try {
//     // ─────────────────────────────
//     // 1. Fetch lead (minimal)
//     // ─────────────────────────────
//     const lead = await prisma.lead.findUnique({
//       where: { id: leadId },
//       select: {
//         id: true,
//         customerName: true,
//         productTitle: true,
//         status: true,
//         createdAt: true,
//         createdByAcc: {
//           select: { firstName: true, lastName: true },
//         },
//       },
//     });

//     if (!lead) return;

//     const assignedBy =
//       lead.createdByAcc
//         ? `${lead.createdByAcc.firstName ?? ""} ${lead.createdByAcc.lastName ?? ""}`.trim()
//         : "System";

//     // ─────────────────────────────
//     // 2. Resolve recipient accountIds
//     // ─────────────────────────────
//     let recipientAccountIds: string[] = [];

//     if (assigneeAccountId) {
//       recipientAccountIds = [assigneeAccountId];
//     } else if (assigneeTeamId) {
//       const members = await prisma.teamMember.findMany({
//         where: { teamId: assigneeTeamId, isActive: true },
//         select: { accountId: true },
//       });
//       recipientAccountIds = members.map((m) => m.accountId);
//     }

//     if (recipientAccountIds.length === 0) return;

//     // ─────────────────────────────
//     // 3. Persist notifications (DB = source of truth)
//     // ─────────────────────────────
//     const notifications = await prisma.$transaction(
//       recipientAccountIds.map((accountId) =>
//         prisma.notification.create({
//           data: {
//             accountId,
//             category: "LEAD",
//             level: "INFO",
//             title: "New Lead Assigned",
//             body: `${lead.customerName}${
//               lead.productTitle ? ` – ${lead.productTitle}` : ""
//             }`,
//             actionUrl: `/leads/${lead.id}`,
//             dedupeKey: `lead:${lead.id}:assigned:${accountId}`,
//             deliveryChannels: ["web", "chrome"],
//             payload: {
//               leadId: lead.id,
//               customerName: lead.customerName,
//               productTitle: lead.productTitle ?? null,
//               status: lead.status,
//               assignedBy,
//               assignedAt: new Date().toISOString(),
//             },
//           },
//         }),
//       ),
//     );

//     // ─────────────────────────────
//     // 4. Socket delivery (best-effort)
//     // ─────────────────────────────
//     let io;
//     try {
//       io = getIo();
//     } catch {
//       io = null;
//     }

//     if (io) {
//       for (const n of notifications) {
//         if (!n.accountId) continue;
//         io.to(`notif:${n.accountId}`).emit("notification", {
//           id: n.id,
//           title: n.title,
//           body: n.body,
//           category: n.category,
//           level: n.level,
//           createdAt: n.createdAt,
//           actionUrl: n.actionUrl,
//         });
//       }
//     }

//     // ─────────────────────────────
//     // 5. Web / Chrome Push delivery (DB-driven)
//     // ─────────────────────────────
//     const subscriptions = await prisma.notificationSubscription.findMany({
//       where: {
//         accountId: { in: recipientAccountIds },
//         isActive: true,
//         platform: { in: ["web", "chrome"] },
//       },
//     });

//     for (const sub of subscriptions) {
//       try {
//         // ⚠️ Enable when web-push is configured

//         await webpush.sendNotification(
//           {
//             endpoint: sub.endpoint,
//             keys: { p256dh: sub.p256dh, auth: sub.auth },
//           },
//           JSON.stringify({
//             title: "New Lead Assigned",
//             body: lead.customerName,
//             data: { leadId: lead.id },
//           }),
//         );

//       } catch (err) {
//         // Expired or invalid subscription → deactivate
//         await prisma.notificationSubscription.update({
//           where: { id: sub.id },
//           data: { isActive: false },
//         });
//       }
//     }

//     // ─────────────────────────────
//     // 6. Mark sentAt (delivery attempted)
//     // ─────────────────────────────
//     await prisma.notification.updateMany({
//       where: { id: { in: notifications.map((n) => n.id) } },
//       data: { sentAt: new Date() },
//     });
//   } catch (err) {
//     // 🔒 Notifications must never break main flow
//     console.error("triggerAssignmentNotification failed:", err);
//   }
// }




import { getIo } from "../core/utils/socket";
import { prisma } from "../config/database.config";
import * as webpush from "web-push";

type TriggerArgs = {
  leadId: string;
  assigneeAccountId?: string | null;
  assigneeTeamId?: string | null;
};

export type ServerNotificationPayload = {
  id: string;
  category: "LEAD" | "TASK" | "SYSTEM";
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR";

  title: string;
  body: string;
  actionUrl?: string;

  payload?: {
    leadId?: string;
    customerName?: string;
    productTitle?: string | null;
    status?: string;
    assignedBy?: string;
    assignedAt?: string;
  };

  createdAt: string;
};

export async function triggerAssignmentNotification({
  leadId,
  assigneeAccountId = null,
  assigneeTeamId = null,
}: TriggerArgs) {
  try {
    // 1. Fetch lead
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerName: true,
        productTitle: true,
        status: true,
        createdByAcc: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!lead) return;

    const assignedBy = lead.createdByAcc
      ? `${lead.createdByAcc.firstName ?? ""} ${lead.createdByAcc.lastName ?? ""}`.trim()
      : "System";

    // 2. Resolve recipients
    let recipientAccountIds: string[] = [];

    if (assigneeAccountId) {
      recipientAccountIds = [assigneeAccountId];
    } else if (assigneeTeamId) {
      const teamMembers = await prisma.teamMember.findMany({
        where: { teamId: assigneeTeamId, isActive: true },
        select: { accountId: true },
      });
      recipientAccountIds = teamMembers.map((m) => m.accountId);
    }

    if (recipientAccountIds.length === 0) return;

    // 3. Persist notifications
    const notifications = await prisma.$transaction(
      recipientAccountIds.map((accountId) =>
        prisma.notification.create({
          data: {
            accountId,
            category: "LEAD",
            level: "INFO",
            title: "New Lead Assigned",
            body: `${lead.customerName}${lead.productTitle ? ` – ${lead.productTitle}` : ""}`,
            actionUrl: `/user/leads/${lead.id}`,
            dedupeKey: `lead:${lead.id}:assigned:${accountId}`,
            deliveryChannels: ["web", "chrome"],
            payload: {
              leadId: lead.id,
              customerName: lead.customerName,
              productTitle: lead.productTitle ?? null,
              status: lead.status,
              assignedBy,
              assignedAt: new Date().toISOString(),
            },
          },
        }),
      ),
    );

    // 4. Socket (best effort)
    let io;
    try {
      io = getIo();
    } catch {
      io = null;
    }

    if (io) {
      notifications.forEach((n) => {
        const payload: ServerNotificationPayload = {
          id: n.id,
          category: n.category as any,
          level: n.level as any,
          title: n.title,
          body: n.body,
          actionUrl: n.actionUrl ?? undefined,
          payload: n.payload as any,
          createdAt: n.createdAt.toISOString(),
        };

        if (n.accountId) {
          io.to(`notif:${n.accountId}`).emit("notification", payload);
        }
      });
    }

    // 5. Push delivery
    const subscriptions = await prisma.notificationSubscription.findMany({
      where: {
        accountId: { in: recipientAccountIds },
        isActive: true,
        platform: { in: ["web", "chrome"] },
      },
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: "New Lead Assigned",
            body: `${lead.customerName}${lead.productTitle ? ` – ${lead.productTitle}` : ""}`,
            data: {
              actionUrl: `/user/leads/${lead.id}`,
              payload: {
                leadId: lead.id,
                customerName: lead.customerName,
                productTitle: lead.productTitle ?? null,
                status: lead.status,
                assignedBy,
              },
            },
          }),
        );
      } catch (pushError) {
        // console.log("Web push failed, deactivating subscription:", sub.id, "\nError:\n", pushError);

        // deactivate invalid subscription
        // await prisma.notificationSubscription.update({
        //   where: { id: sub.id },
        //   data: { isActive: false },
        // });
        console.warn("⚠️ Web push failed", pushError);
      }
    }

    // 6. Mark notifications as sent
    await prisma.notification.updateMany({
      where: { id: { in: notifications.map((n) => n.id) } },
      data: { sentAt: new Date() },
    });
  } catch (error) {
    console.error("triggerAssignmentNotification failed:", error);
  }
}
