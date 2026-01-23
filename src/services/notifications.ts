// // src/services/notifications.ts
// import { getIo } from "../core/utils/socket";
// import { prisma } from "../config/database.config"; 

// type TriggerArgs = {
//   leadId: string;
//   assigneeAccountId?: string | null;
//   assigneeTeamId?: string | null;
// };

// export async function triggerAssignmentNotification({ leadId, assigneeAccountId = null, assigneeTeamId = null }: TriggerArgs) {
//   try {
//     const io = getIo();

//     // Fetch minimal lead info for payload (no heavy joins)
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
//         // include createdBy name if you like:
//         createdByAcc: {
//           select: { id: true, firstName: true, lastName: true },
//         },
//       },
//     });

//     if (!lead) {
//       console.warn("triggerAssignmentNotification: lead not found", leadId);
//       return;
//     }

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
//       assignedBy: lead.createdByAcc ? {
//         id: lead.createdByAcc.id,
//         name: `${lead.createdByAcc.firstName ?? ""} ${lead.createdByAcc.lastName ?? ""}`.trim(),
//       } : { id: lead.createdBy ?? null },
//     };

//     // If single account assigned -> emit to that user's notification room
//     if (assigneeAccountId) {
//       io.to(`notif:${assigneeAccountId}`).emit("notification", payload);
//       return;
//     }

//     // If team assigned -> fetch active team members and emit to each member room
//     if (assigneeTeamId) {
//       // Adjust this query to your actual TeamMember/Team schema
//       const members = await prisma.teamMember.findMany({
//         where: { teamId: assigneeTeamId, isActive: true },
//         select: { accountId: true },
//       });

//       if (!members || members.length === 0) {
//         console.warn("triggerAssignmentNotification: no active team members", assigneeTeamId);
//         return;
//       }

//       for (const m of members) {
//         if (m?.accountId) {
//           io.to(`notif:${m.accountId}`).emit("notification", payload);
//         }
//       }
//       return;
//     }

//     console.warn("triggerAssignmentNotification: no assignee provided", { leadId, assigneeAccountId, assigneeTeamId });
//   } catch (err) {
//     console.error("triggerAssignmentNotification error:", err);
//   }
// }




// src/services/notifications.ts
import { getIo } from "../core/utils/socket";
import { prisma } from "../config/database.config";

type TriggerArgs = {
  leadId: string;
  assigneeAccountId?: string | null;
  assigneeTeamId?: string | null;
};

export async function triggerAssignmentNotification({
  leadId,
  assigneeAccountId = null,
  assigneeTeamId = null,
}: TriggerArgs) {
  console.log("\n🔔 triggerAssignmentNotification called", {
    leadId,
    assigneeAccountId,
    assigneeTeamId,
  });

  try {
    const io = getIo();
    console.log("\n✅ Socket IO instance acquired");

    // Fetch minimal lead info for payload
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        customerName: true,
        productTitle: true,
        cost: true,
        status: true,
        createdAt: true,
        createdBy: true,
        createdByAcc: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!lead) {
      console.warn("⚠️ Lead not found for notification", leadId);
      return;
    }

    console.log("\n📦 Lead fetched for notification", {
      id: lead.id,
      customerName: lead.customerName,
    });

    const payload = {
      type: "lead_assigned",
      leadId: lead.id,
      lead: {
        customerName: lead.customerName,
        productTitle: lead.productTitle ?? null,
        cost: lead.cost ?? null,
        status: lead.status,
        createdAt: lead.createdAt,
      },
      assignedAt: new Date().toISOString(),
      assignedBy: lead.createdByAcc
        ? {
            id: lead.createdByAcc.id,
            name: `${lead.createdByAcc.firstName ?? ""} ${lead.createdByAcc.lastName ?? ""}`.trim(),
          }
        : { id: lead.createdBy ?? null },
    };

    // ─────────────────────────────
    // Account assignment
    // ─────────────────────────────
    if (assigneeAccountId) {
      const room = `notif:${assigneeAccountId}`;

      console.log("\n📤 Emitting notification to ACCOUNT", {
        room,
        leadId: lead.id,
      });

      io.to(room).emit("notification", payload);

      console.log("\n✅ Notification emitted to account room", room);
      return;
    }

    // ─────────────────────────────
    // Team assignment
    // ─────────────────────────────
    if (assigneeTeamId) {
      console.log("\n👥 Team assignment detected", assigneeTeamId);

      const members = await prisma.teamMember.findMany({
        where: { teamId: assigneeTeamId, isActive: true },
        select: { accountId: true },
      });

      if (!members || members.length === 0) {
        console.warn("⚠️ No active team members found", assigneeTeamId);
        return;
      }

      console.log("\n👥 Active team members found", {
        teamId: assigneeTeamId,
        count: members.length,
      });

      for (const m of members) {
        if (!m?.accountId) continue;

        const room = `notif:${m.accountId}`;

        console.log("\n📤 Emitting notification to TEAM MEMBER", {
          room,
          leadId: lead.id,
        });

        io.to(room).emit("notification", payload);
      }

      console.log("\n✅ Team notifications emitted", {
        teamId: assigneeTeamId,
        total: members.length,
      });

      return;
    }

    console.warn("⚠️ No assignee provided for notification", {
      leadId,
      assigneeAccountId,
      assigneeTeamId,
    });
  } catch (err) {
    console.error("❌ triggerAssignmentNotification error:", err);
  }
}
