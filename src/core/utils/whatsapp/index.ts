import { prisma } from "../../../config/database.config";
import axios from "axios";

// Helper: build formatted WhatsApp text message
function buildWhatsAppMessage(params: {
  leadType: string;
  leadSource?: string | null;
  customerName: string;
  mobileNumber: string;
  productTitle?: string | null;
  cost?: string | number | null;
  remark?: string | null;
  assigneeName?: string | null;
  adminName?: string | null;
}) {
  const {
    leadType,
    leadSource,
    customerName,
    mobileNumber,
    productTitle,
    cost,
    remark,
    assigneeName,
    adminName,
  } = params;

  const lines: string[] = [];
  // header
  lines.push(`*${leadType} - Lead*`);
  if (leadSource) lines.push(`*Source:* ${leadSource}`);
  lines.push(`*Customer:* ${customerName}`);
  lines.push(`*Mobile:* ${mobileNumber}`);
  if (productTitle) lines.push(`*Product:* ${productTitle}`);
  if (typeof cost !== "undefined" && cost !== null && String(cost) !== "") lines.push(`*Cost:* ₹${cost}`);
  if (remark) lines.push(`*Remark:* ${remark}`);
  if (assigneeName) lines.push(`*Assigned to:* ${assigneeName}`);
  // footer
  lines.push(``);
  lines.push(`*By* - ${adminName ?? "Admin"}`);

  return lines.join("\n");
}

// Helper: send whatsapp via Meta WhatsApp Cloud API
export async function sendWhatsAppMessage(toPhone: string, messageBody: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const base = process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com";

  if (!phoneNumberId || !token) {
    throw new Error("WhatsApp credentials missing (WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN)");
  }

  const url = `${base}/v16.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "text",
    text: {
      body: messageBody,
    },
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 10_000,
  });

  return resp.data;
}

/**
 * Trigger assignment notification:
 * - Fetch lead details & assignee info (account or team -> members)
 * - Send WhatsApp message to the recipient phones (best-effort)
 * - Write a leadActivityLog entry recording the notification metadata
 *
 * This is intentionally non-blocking for createLeadAdmin. Call with void triggerAssignmentNotification(...)
 */
// export async function triggerAssignmentNotification(params: {
//   leadId: string;
//   assigneeAccountId?: string | null;
//   assigneeTeamId?: string | null;
//   performedByAccountId?: string | null; // admin who created lead (so we can show admin name)
// }) {
//   const { leadId, assigneeAccountId, assigneeTeamId, performedByAccountId } = params;
//   try {
//     // fetch lead, include product/title and remark
//     const lead = await prisma.lead.findUnique({
//       where: { id: leadId },
//       include: {
//         // no heavy join - only needed fields
//       },
//     });

//     if (!lead) {
//       console.warn("triggerAssignmentNotification: lead not found", leadId);
//       return;
//     }

//     // resolve admin (performedBy) name
//     let adminName: string | null = null;
//     if (performedByAccountId) {
//       const adminAcc = await prisma.account.findUnique({
//         where: { id: performedByAccountId },
//         select: { firstName: true, lastName: true },
//       });
//       adminName = adminAcc ? `${adminAcc.firstName} ${adminAcc.lastName}` : null;
//     }

//     // resolve recipients
//     const recipients: { id?: string; phone: string; name?: string | null }[] = [];

//     if (assigneeAccountId) {
//       const acc = await prisma.account.findUnique({
//         where: { id: assigneeAccountId },
//         select: { id: true, firstName: true, lastName: true, contactPhone: true },
//       });
//       if (acc && acc.contactPhone) {
//         recipients.push({ id: acc.id, phone: String(acc.contactPhone).replace(/\D/g, ""), name: `${acc.firstName} ${acc.lastName}`.trim() });
//       }
//     } else if (assigneeTeamId) {
//       // fetch active team members and their account phones
//       const team = await prisma.team.findUnique({
//         where: { id: assigneeTeamId },
//         include: {
//           members: {
//             where: { isActive: true },
//             include: { account: { select: { id: true, firstName: true, lastName: true, contactPhone: true } } },
//           },
//         },
//       });

//       if (team?.members?.length) {
//         for (const m of team.members) {
//           if (m.account?.contactPhone) {
//             recipients.push({
//               id: m.account.id,
//               phone: String(m.account.contactPhone).replace(/\D/g, ""),
//               name: `${m.account.firstName ?? ""} ${m.account.lastName ?? ""}`.trim(),
//             });
//           }
//         }
//       }
//     }

//     if (recipients.length === 0) {
//       console.info("triggerAssignmentNotification: no recipients found for lead", leadId);
//       return;
//     }

//     // build message
//     const leadType = String(lead.type ?? "LEAD");
//     const leadSource = String(lead.source ?? "");
//     const productTitle = typeof lead.product === "object" && lead.product?.title ? lead.product.title : lead.productTitle ?? null;

//     const results: any[] = [];
//     for (const r of recipients) {
//       try {
//         const message = buildWhatsAppMessage({
//           leadType,
//           leadSource,
//           customerName: lead.customerName,
//           mobileNumber: lead.mobileNumber,
//           productTitle,
//           cost: lead.cost ?? null,
//           remark: lead.remark ?? null,
//           assigneeName: r.name ?? null,
//           adminName: adminName ?? undefined,
//         });

//         const sent = await sendWhatsAppMessage(r.phone, message);
//         results.push({ recipient: r, sent, success: true });
//       } catch (err: any) {
//         console.error("WhatsApp send failed for", r.phone, err?.message ?? err);
//         results.push({ recipient: r, error: err?.message ?? String(err), success: false });
//       }
//     }

//     // write an activity log entry to record notification attempts
//     try {
//       await prisma.leadActivityLog.create({
//         data: {
//           leadId,
//           action: "UPDATED", // use UPDATED as a safe existing enum to denote notification meta
//           performedBy: performedByAccountId ?? undefined,
//           meta: {
//             notification: {
//               channel: "WHATSAPP",
//               recipients: results.map((r) => ({
//                 id: r.recipient.id,
//                 phone: r.recipient.phone,
//                 name: r.recipient.name ?? null,
//                 success: r.success,
//                 result: r.sent ?? null,
//                 error: r.error ?? null,
//               })),
//             },
//           },
//         },
//       });
//     } catch (err) {
//       console.error("Failed to write notification activity log:", err);
//     }
//   } catch (err) {
//     console.error("triggerAssignmentNotification failed:", err);
//   }
// }
