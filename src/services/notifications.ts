// src/services/notifications.ts

import { getIo } from "../core/utils/socket";
import { prisma } from "../config/database.config";
import * as webpush from "web-push";
import { sendWhatsAppSmart } from "./whatsapp";

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

// Add these new types at the top alongside ServerNotificationPayload
export type TaskNotificationEvent =
  | "CREATED"
  | "ASSIGNED"
  | "UPDATED"
  | "STATUS_CHANGED"
  | "COMPLETED"
  | "REMINDER";

type TaskNotificationArgs = {
  taskId: string;
  event: TaskNotificationEvent;
  performedByAccountId: string;
  // Pass recipients directly — already resolved in the controller
  recipientAccountIds: string[];
};

export async function triggerAssignmentNotification({
  leadId,
  assigneeAccountId = null,
  assigneeTeamId = null,
}: TriggerArgs) {
  try {
    // console.log("\n\nTriggering assignment notification for leadId:", leadId);

    // 1. Fetch lead
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerName: true,
        productTitle: true,
        status: true,
        cost: true,
        remark: true,
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

    // WhatsApp notification to first recipient (best effort, outside transaction)
//     if (recipientAccountIds.length > 0) {
//       const assignee = await prisma.account.findUnique({
//         where: { id: recipientAccountIds[0] },
//         select: { contactPhone: true, firstName: true },
//       });

//       if (assignee?.contactPhone) {
//         const message = `*New Lead*

// *Customer Name:* ${lead.customerName}
// *Mobile Number:* ${assignee.contactPhone}
// *Product:* ${lead.productTitle ?? "-"}
// *Cost:* - ${lead.cost ?? "-"}
// *Remark:* -${lead.remark ?? "-"}

// *Assigned By* - ${assignedBy}`;

//         await sendWhatsAppSmart({
//           phoneNumber: assignee.contactPhone,
//           message: `*Lead*

// *Customer Name:* ${lead.customerName}
// *Mobile Number:* ${assignee.contactPhone}
// *Product:* ${lead.productTitle ?? "-"}
// *Cost:* 25000
// *Remark:* call them to connect

// *Assigned By* - ${assignedBy}`,

//           templateName: "pract", // approved template
//           // templateName: "new_lead_assigned",
//         });
//       }
//     }

    // Step 3 — find existing by dedupeKey and update or create per recipient (dedupeKey is not a unique field in Prisma schema)
    const notifications = await Promise.all(
      recipientAccountIds.map(async (accountId) => {
        const dedupeKey = `lead:${lead.id}:assigned:${accountId}`;

        const existing = await prisma.notification.findFirst({
          where: { dedupeKey },
          select: { id: true },
        });

        if (existing) {
          return prisma.notification.update({
            where: { id: existing.id },
            data: {
              // Refresh the notification on re-assignment
              sentAt: null,
              createdAt: new Date(),
              payload: {
                leadId: lead.id,
                customerName: lead.customerName,
                productTitle: lead.productTitle ?? null,
                status: lead.status,
                assignedBy,
                assignedAt: new Date().toISOString(),
              },
            },
          });
        }

        return prisma.notification.create({
          data: {
            accountId,
            category: "LEAD",
            level: "INFO",
            title: "New Lead Assigned",
            body: `${lead.customerName}${lead.productTitle ? ` – ${lead.productTitle}` : ""}`,
            actionUrl: `/user/leads/${lead.id}`,
            dedupeKey,
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
        });
      }),
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
        // isActive: true,
        // platform: { in: ["web", "chrome"] },
      },
    });

    for (const sub of subscriptions) {
      try {
        const response = await webpush.sendNotification(
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
            actionUrl: `/user/leads/${lead.id}`,
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
      } catch (pushError: any) {
        console.log("❌ Web push failed:", sub.endpoint);
        console.log("Status:", pushError?.statusCode);
        console.log("Body:", pushError?.body);

        // Optional: auto-remove invalid subscription
        if (pushError?.statusCode === 404 || pushError?.statusCode === 410) {
          console.warn("🗑 Removing expired subscription:", sub.endpoint);
          // delete subscription from DB here
        }
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

export async function triggerAdminRegistrationNotification({
  requestId,
  firstName,
  lastName,
  email,
  phone,
}: {
  requestId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}) {
  try {
    // 1. Fetch ADMIN accounts
    const admins = await prisma.account.findMany({
      where: { designation: "Owner", isActive: true },
      select: { id: true },
    });

    if (admins.length === 0) return;

    const adminIds = admins.map((a) => a.id);

    // 2. Persist notifications
    const notifications = await prisma.$transaction(
      adminIds.map((accountId) =>
        prisma.notification.create({
          data: {
            accountId,
            category: "SYSTEM",
            level: "INFO",
            title: "New employee registration request",
            body: `${firstName} ${lastName} requested access`,
            actionUrl: `/employee/requests`,
            dedupeKey: `registration:${requestId}:admin:${accountId}`,
            deliveryChannels: ["web", "chrome"],
            payload: {
              requestId,
              firstName,
              lastName,
              email,
              phone,
            },
          },
        }),
      ),
    );

    // 3. Socket delivery (best effort)
    let io;
    try {
      io = getIo();
    } catch {
      io = null;
    }

    if (io) {
      notifications.forEach((n) => {
        io.to(`notif:${n.accountId}`).emit("notification", {
          id: n.id,
          category: n.category,
          level: n.level,
          title: n.title,
          body: n.body,
          actionUrl: n.actionUrl ?? undefined,
          payload: n.payload,
          createdAt: n.createdAt.toISOString(),
        });
      });
    }

    // 4. Push notifications
    const subscriptions = await prisma.notificationSubscription.findMany({
      where: {
        accountId: { in: adminIds },
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
            title: "New employee registration request",
            body: `${firstName} ${lastName} requested access`,
            actionUrl: `/employee/requests`,
            data: {
              actionUrl: `/employee/requests`,
            },
          }),
        );
      } catch (err) {
        console.warn("⚠️ Admin push failed", err);
      }
    }

    // 5. Mark sent
    await prisma.notification.updateMany({
      where: { id: { in: notifications.map((n) => n.id) } },
      data: { sentAt: new Date() },
    });
  } catch (err) {
    console.error("triggerAdminRegistrationNotification failed:", err);
  }
}

export async function triggerPublicLeadNotification({
  leadId,
  source,
}: {
  leadId: string;
  source: string;
}) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerName: true,
        mobileNumber: true,
        productTitle: true,
        source: true,
      },
    });
    if (!lead) return;

    /* ── Resolve ADMIN + SALES role accounts ────── */
    const roleAccounts = await prisma.userRole.findMany({
      where: {
        role: { name: { in: ["ADMIN", "SALES"] } },
        user: { account: { isActive: true } },
      },
      select: {
        user: {
          select: {
            accountId: true,
          },
        },
      },
    });

    const recipientAccountIds = [
      ...new Set(
        roleAccounts.map((r) => r.user.accountId).filter(Boolean) as string[],
      ),
    ];

    if (recipientAccountIds.length === 0) return;

    const sourceLabel: Record<string, string> = {
      WEBSITE: "Website",
      INQUIRY_FORM: "Inquiry Form",
      YOUTUBE: "YouTube",
    };

    const title = `New Inquiry – ${sourceLabel[source] ?? source}`;
    const body = `${lead.customerName} (${lead.mobileNumber})${lead.productTitle ? ` · ${lead.productTitle}` : ""}`;

    /* ── Persist + socket + push ────────────────── */
    const notifications = await Promise.all(
      recipientAccountIds.map(async (accountId) => {
        const dedupeKey = `public_lead:${lead.id}:${accountId}`;

        const existing = await prisma.notification.findFirst({
          where: { dedupeKey },
          select: { id: true },
        });

        if (existing) {
          return prisma.notification.update({
            where: { id: existing.id },
            data: {
              sentAt: null,
              createdAt: new Date(),
              payload: {
                leadId: lead.id,
                customerName: lead.customerName,
                mobileNumber: lead.mobileNumber,
                productTitle: lead.productTitle ?? null,
                source: lead.source,
              },
            },
          });
        }

        return prisma.notification.create({
          data: {
            accountId,
            category: "LEAD",
            level: "INFO",
            title,
            body,
            actionUrl: `/admin/leads/${lead.id}`,
            dedupeKey,
            deliveryChannels: ["web", "chrome"],
            payload: {
              leadId: lead.id,
              customerName: lead.customerName,
              mobileNumber: lead.mobileNumber,
              productTitle: lead.productTitle ?? null,
              source: lead.source,
            },
          },
        });
      }),
    );

    // Socket
    let io: ReturnType<typeof getIo> | null = null;
    try {
      io = getIo();
    } catch {
      /* no-op */
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
          io!.to(`notif:${n.accountId}`).emit("notification", payload);
        }
        // ── Once: push new lead into lead lists ────────
        const leadCreatedPayload = {
          id: lead.id,
          customerName: lead.customerName,
          mobileNumber: lead.mobileNumber,
          productTitle: lead.productTitle ?? null,
          source: lead.source,
          status: "PENDING",
          createdAt: new Date().toISOString(),
        };

        io.to("leads:admin").emit("lead:created", leadCreatedPayload);

        recipientAccountIds.forEach((accountId) => {
          io!
            .to(`leads:user:${accountId}`)
            .emit("lead:created", leadCreatedPayload);
        });
      });
    }

    // Push
    const subscriptions = await prisma.notificationSubscription.findMany({
      where: { accountId: { in: recipientAccountIds } },
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({
            title,
            body,
            actionUrl: `/admin/leads/${lead.id}`,
            data: { actionUrl: `/admin/leads/${lead.id}` },
          }),
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          console.warn("Removing expired push subscription:", sub.endpoint);
          await prisma.notificationSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        }
      }
    }

    await prisma.notification.updateMany({
      where: { id: { in: notifications.map((n) => n.id) } },
      data: { sentAt: new Date() },
    });
  } catch (err) {
    console.error("triggerPublicLeadNotification failed:", err);
  }
}


export async function triggerTaskNotification({
  taskId,
  event,
  performedByAccountId,
  recipientAccountIds,
}: TaskNotificationArgs) {
  try {
    if (recipientAccountIds.length === 0) return;

    // 1. Fetch task + performer
    const [task, performer] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          projectId: true,
          project: { select: { name: true } },
        },
      }),
      prisma.account.findUnique({
        where: { id: performedByAccountId },
        select: { firstName: true, lastName: true },
      }),
    ]);

    if (!task) return;

    const performerName = performer
      ? `${performer.firstName} ${performer.lastName}`.trim()
      : "Someone";

    // 2. Build title/body per event type
    const copy: Record<TaskNotificationEvent, { title: string; body: string }> = {
      CREATED: {
        title: "New task assigned",
        body: `${performerName} assigned you: ${task.title}`,
      },
      ASSIGNED: {
        title: "Task reassigned",
        body: `${performerName} reassigned "${task.title}" to you`,
      },
      UPDATED: {
        title: "Task updated",
        body: `${performerName} updated "${task.title}"`,
      },
      STATUS_CHANGED: {
        title: "Task status changed",
        body: `"${task.title}" is now ${task.status.toLowerCase().replace("_", " ")}`,
      },
      COMPLETED: {
        title: "Task completed",
        body: `"${task.title}" was marked complete by ${performerName}`,
      },
      REMINDER: {
        title: "Task reminder",
        body: task.dueDate
          ? `"${task.title}" is due soon`
          : `Don't forget: "${task.title}"`,
      },
    };

    const { title, body } = copy[event];
    const actionUrl = `/tasks/${task.id}`;

    // 3. Persist notifications (upsert via dedupeKey)
    const notifications = await Promise.all(
      recipientAccountIds
        .filter((id) => id !== performedByAccountId) // don't notify the actor
        .map(async (accountId) => {
          const dedupeKey = `task:${task.id}:${event}:${accountId}`;

          const existing = await prisma.notification.findFirst({
            where: { dedupeKey },
            select: { id: true },
          });

          if (existing) {
            return prisma.notification.update({
              where: { id: existing.id },
              data: {
                sentAt: null,
                createdAt: new Date(),
                payload: {
                  taskId: task.id,
                  taskTitle: task.title,
                  status: task.status,
                  event,
                  performedBy: performerName,
                },
              },
            });
          }

          return prisma.notification.create({
            data: {
              accountId,
              category: "TASK",
              level: event === "REMINDER" ? "WARNING" : "INFO",
              title,
              body,
              actionUrl,
              dedupeKey,
              deliveryChannels: ["web", "chrome"],
              payload: {
                taskId: task.id,
                taskTitle: task.title,
                status: task.status,
                event,
                performedBy: performerName,
                projectName: task.project?.name ?? null,
              },
            },
          });
        }),
    );

    // 4. Socket emit
    let io: ReturnType<typeof getIo> | null = null;
    try { io = getIo(); } catch { /* no-op */ }

    if (io) {
      notifications.forEach((n) => {
        if (!n.accountId) return;
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
        io!.to(`notif:${n.accountId}`).emit("notification", payload);
      });
    }

    // 5. Web push (Chrome)
    const subscriptions = await prisma.notificationSubscription.findMany({
      where: { accountId: { in: recipientAccountIds } },
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title,
            body,
            icon: "/favicon.png",
            badge: "/favicon.png",
            data: { actionUrl },
          }),
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.notificationSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        }
      }
    }

    // 6. Mark sent
    await prisma.notification.updateMany({
      where: { id: { in: notifications.map((n) => n.id) } },
      data: { sentAt: new Date() },
    });
  } catch (err) {
    console.error("triggerTaskNotification failed:", err);
  }
}