import { prisma } from "../../../config/database.config";
import { getNotificationProvider } from "../providers/provider.factory";
import { TemplateEngine } from "../templates/template.engine";
import {
  LEAD_TEMPLATES,
  getCustomerTrackingUrl,
  getTeamMemberLeadUrl,
  renderCustomerConfirmation,
  renderTeamMemberAssignment,
  renderAdminPublicLead,
  LeadCustomerTemplateVariables,
  LeadTeamMemberTemplateVariables,
  LeadAdminPublicLeadTemplateVariables,
} from "../templates/lead.templates";
import { normalizePhoneNumber, isValidPhoneNumber } from "../utils/phone.util";
import { idempotencyCache } from "../utils/idempotency.util";
import { NotificationEvent, NotificationModule, RecipientType } from "../types";

export interface LeadCreatedNotificationParams {
  leadId: string;
  performedByAccountId?: string | null;
  bypassDedupe?: boolean;
}

export interface LeadAssignedNotificationParams {
  leadId: string;
  assigneeAccountId?: string | null;
  assigneeTeamId?: string | null;
  assignedByAccountId?: string | null;
  bypassDedupe?: boolean;
}

export interface LeadAdminPublicLeadNotificationParams {
  leadId: string;
  source?: string;
  bypassDedupe?: boolean;
}

export interface LogLeadNotificationActivityParams {
  leadId: string;
  recipientType: "CUSTOMER" | "TEAM_MEMBER" | "ADMIN";
  status: "SENT" | "FAILED" | "NOT_SENT";
  recipientName?: string;
  recipientPhone?: string;
  campaignName?: string;
  messageId?: string;
  error?: string;
  reason?: string;
  performedByAccountId?: string | null;
}

/**
 * Safely creates an activity log entry for WhatsApp notification attempts.
 */
export async function logLeadNotificationActivity(params: LogLeadNotificationActivityParams): Promise<void> {
  try {
    await prisma.leadActivityLog.create({
      data: {
        leadId: params.leadId,
        action: "UPDATED",
        performedBy: params.performedByAccountId ?? null,
        meta: {
          type: "WHATSAPP_NOTIFICATION",
          recipientType: params.recipientType,
          status: params.status,
          recipientName: params.recipientName,
          recipientPhone: params.recipientPhone,
          campaignName: params.campaignName,
          messageId: params.messageId,
          error: params.error,
          reason: params.reason,
          at: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.warn(`[Notification] Failed to log lead activity for ${params.leadId}:`, err);
  }
}

/**
 * Records an activity log when a notification is intentionally skipped.
 */
export async function recordLeadNotificationSkipped(params: {
  leadId: string;
  recipientType: "CUSTOMER" | "TEAM_MEMBER";
  recipientPhone?: string;
  recipientName?: string;
  performedByAccountId?: string | null;
  reason?: string;
}): Promise<void> {
  await logLeadNotificationActivity({
    leadId: params.leadId,
    recipientType: params.recipientType,
    status: "NOT_SENT",
    recipientPhone: params.recipientPhone,
    recipientName: params.recipientName,
    reason: params.reason || "Notification disabled during lead creation",
    performedByAccountId: params.performedByAccountId,
  });
}

/**
 * Handles WhatsApp notification when a new Lead is created.
 * Sends confirmation to the customer with tracking URL and assigned representative details.
 */
export async function dispatchLeadCreatedNotification(params: LeadCreatedNotificationParams): Promise<{
  success: boolean;
  status: "SENT" | "FAILED" | "NOT_SENT";
  messageId?: string;
  error?: string;
}> {
  const { leadId, performedByAccountId, bypassDedupe = false } = params;

  try {
    const isEnabled = process.env.ONBITS_ENABLED !== "false";
    if (!isEnabled) {
      console.log(`[Notification] WhatsApp notifications disabled via ONBITS_ENABLED=false`);
      await logLeadNotificationActivity({
        leadId,
        recipientType: "CUSTOMER",
        status: "NOT_SENT",
        reason: "WhatsApp notifications disabled via ONBITS_ENABLED=false",
        performedByAccountId,
      });
      return { success: false, status: "NOT_SENT", error: "WhatsApp provider disabled" };
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        productCatalog: {
          select: { introVideoId: true, demoUrl: true, detailedVideoId: true, title: true },
        },
        assignments: {
          where: { isActive: true },
          include: {
            account: {
              select: { firstName: true, lastName: true, contactPhone: true },
            },
            team: {
              select: { name: true },
            },
          },
          take: 1,
        },
      },
    });

    if (!lead) {
      console.warn(`[Notification] Lead not found for leadId: ${leadId}`);
      return { success: false, status: "FAILED", error: "Lead not found" };
    }

    if (!isValidPhoneNumber(lead.mobileNumber)) {
      console.warn(`[Notification] Lead ${leadId} has invalid customer phone: ${lead.mobileNumber}`);
      await logLeadNotificationActivity({
        leadId,
        recipientType: "CUSTOMER",
        status: "FAILED",
        recipientName: lead.customerName,
        recipientPhone: lead.mobileNumber,
        error: `Invalid recipient phone number: ${lead.mobileNumber}`,
        performedByAccountId,
      });
      return { success: false, status: "FAILED", error: `Invalid phone number: ${lead.mobileNumber}` };
    }

    const customerPhone = normalizePhoneNumber(lead.mobileNumber)!;
    const dedupeKey = `lead:created:${leadId}:${customerPhone}`;

    if (!bypassDedupe && !idempotencyCache.acquire(dedupeKey)) {
      console.log(`[Notification] Duplicate lead created notification prevented for ${dedupeKey}`);
      return { success: true, status: "SENT", error: "Duplicate request prevented" };
    }

    // Resolve assigned member details or default support contact
    const activeAssignment = lead.assignments?.[0];
    let teamMemberName = "Mr. Mehul Patel";
    let teamMemberPhone = "8141703007";

    if (activeAssignment?.account) {
      const acc = activeAssignment.account;
      const resolvedName = `${acc.firstName || ""} ${acc.lastName || ""}`.trim();
      if (resolvedName) teamMemberName = resolvedName;
      if (acc.contactPhone) teamMemberPhone = acc.contactPhone;
    } else if (activeAssignment?.team) {
      teamMemberName = activeAssignment.team.name;
    }

    // Resolve product demo YouTube video link
    let productDemoUrl = "";

    // 1. From lead.product JSON (if array or object)
    if (lead.product) {
      const rawProd: any = lead.product;
      const primaryItem = Array.isArray(rawProd) ? rawProd[0] : rawProd;
      if (primaryItem?.introVideoId) {
        productDemoUrl = primaryItem.introVideoId.startsWith("http")
          ? primaryItem.introVideoId
          : `https://youtu.be/${primaryItem.introVideoId}`;
      } else if (primaryItem?.demoUrl) {
        productDemoUrl = primaryItem.demoUrl;
      }
    }

    // 2. From relation productCatalog
    if (!productDemoUrl && lead.productCatalog?.length) {
      const cat = lead.productCatalog[0];
      if (cat.introVideoId) {
        productDemoUrl = cat.introVideoId.startsWith("http")
          ? cat.introVideoId
          : `https://youtu.be/${cat.introVideoId}`;
      } else if (cat.demoUrl) {
        productDemoUrl = cat.demoUrl;
      }
    }

    // 3. Fallback search in ProductCatalog by title or catalog ID
    if (!productDemoUrl && (lead.productCatalogId || lead.productTitle)) {
      const matchedCatalog = await prisma.productCatalog.findFirst({
        where: {
          OR: [
            ...(lead.productCatalogId ? [{ id: lead.productCatalogId }] : []),
            ...(lead.productTitle ? [{ title: { equals: lead.productTitle, mode: "insensitive" as const } }] : []),
          ],
        },
        select: { introVideoId: true, demoUrl: true },
      });
      if (matchedCatalog?.introVideoId) {
        productDemoUrl = matchedCatalog.introVideoId.startsWith("http")
          ? matchedCatalog.introVideoId
          : `https://youtu.be/${matchedCatalog.introVideoId}`;
      } else if (matchedCatalog?.demoUrl) {
        productDemoUrl = matchedCatalog.demoUrl;
      }
    }

    const baseProductTitle =
      lead.productTitle?.trim() || (lead.productCatalog?.length ? lead.productCatalog[0].title : "") || "General Inquiry";
    const productTitleFormatted = productDemoUrl
      ? `*${baseProductTitle}*  Product Demo: ${productDemoUrl}`
      : `*${baseProductTitle}*`;

    const variables: LeadCustomerTemplateVariables = {
      customer_name: lead.customerName,
      product_title: productTitleFormatted,
      member_name: teamMemberName,
      member_phone: teamMemberPhone,
    };

    const message = renderCustomerConfirmation(variables);
    const provider = getNotificationProvider();
    const campaignName = process.env.ONBITS_CUSTOMER_LEAD_CAMPAIGN || "New Customer Lead";

    const result = await provider.sendMessage({
      to: customerPhone,
      message,
      campaignName,
      templateName: "lead_customer_confirmation",
      templateVariables: {
        customer_name: `*${(lead.customerName || "Customer").trim()}*`,
        product_title: productTitleFormatted,
        member_name: `*${(teamMemberName || "Mr. Mehul Patel").trim()}*`,
        member_phone: teamMemberPhone || "8141703007",
      },
      meta: {
        module: NotificationModule.LEAD,
        event: NotificationEvent.LEAD_CREATED,
        leadId: lead.id,
        recipientType: RecipientType.CUSTOMER,
      },
    });

    if (!result.success) {
      console.error(`[Notification] Failed to send customer lead creation WhatsApp to ${customerPhone}:`, result.error);
      await logLeadNotificationActivity({
        leadId,
        recipientType: "CUSTOMER",
        status: "FAILED",
        recipientName: lead.customerName,
        recipientPhone: customerPhone,
        campaignName,
        error: result.error || "WhatsApp delivery failed",
        performedByAccountId,
      });
      return { success: false, status: "FAILED", error: result.error };
    }

    console.log(`[Notification] Customer WhatsApp notification sent successfully for Lead ${leadId}`);
    await logLeadNotificationActivity({
      leadId,
      recipientType: "CUSTOMER",
      status: "SENT",
      recipientName: lead.customerName,
      recipientPhone: customerPhone,
      campaignName,
      messageId: result.messageId,
      performedByAccountId,
    });

    return { success: true, status: "SENT", messageId: result.messageId };
  } catch (err: any) {
    console.error(`[Notification] Error processing lead created notification for ${leadId}:`, err);
    await logLeadNotificationActivity({
      leadId,
      recipientType: "CUSTOMER",
      status: "FAILED",
      error: err?.message || "Internal notification error",
      performedByAccountId,
    });
    return { success: false, status: "FAILED", error: err?.message || "Internal notification error" };
  }
}

/**
 * Handles WhatsApp notification when a Lead is assigned / reassigned.
 * Sends notification with lead information and direct portal link to the assigned team member(s).
 */
export async function dispatchLeadAssignedNotification(params: LeadAssignedNotificationParams): Promise<{
  success: boolean;
  status: "SENT" | "FAILED" | "NOT_SENT";
  count: number;
  errors: string[];
}> {
  const { leadId, assigneeAccountId, assigneeTeamId, assignedByAccountId, bypassDedupe = false } = params;

  try {
    const isEnabled = process.env.ONBITS_ENABLED !== "false";
    if (!isEnabled) {
      console.log(`[Notification] WhatsApp notifications disabled via ONBITS_ENABLED=false`);
      await logLeadNotificationActivity({
        leadId,
        recipientType: "TEAM_MEMBER",
        status: "NOT_SENT",
        reason: "WhatsApp notifications disabled via ONBITS_ENABLED=false",
        performedByAccountId: assignedByAccountId,
      });
      return { success: false, status: "NOT_SENT", count: 0, errors: ["WhatsApp provider disabled"] };
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        customer: {
          select: { email: true, mobile: true },
        },
        productCatalog: {
          select: { title: true },
        },
        createdByAcc: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!lead) {
      console.warn(`[Notification] Lead not found for assignment notification: ${leadId}`);
      return { success: false, status: "FAILED", count: 0, errors: ["Lead not found"] };
    }

    // Resolve assigner name
    let assignedByName = "Administrator";
    if (assignedByAccountId) {
      const assigner = await prisma.account.findUnique({
        where: { id: assignedByAccountId },
        select: { firstName: true, lastName: true },
      });
      if (assigner) {
        assignedByName = `${assigner.firstName || ""} ${assigner.lastName || ""}`.trim() || assignedByName;
      }
    } else if (lead.createdByAcc) {
      assignedByName = `${lead.createdByAcc.firstName || ""} ${lead.createdByAcc.lastName || ""}`.trim();
    }

    // Resolve recipient accounts
    const recipientAccounts: Array<{ id: string; name: string; phone: string }> = [];

    if (assigneeAccountId) {
      const account = await prisma.account.findUnique({
        where: { id: assigneeAccountId },
        select: { id: true, firstName: true, lastName: true, contactPhone: true, isActive: true },
      });
      if (account && account.isActive && isValidPhoneNumber(account.contactPhone)) {
        recipientAccounts.push({
          id: account.id,
          name: `${account.firstName || ""} ${account.lastName || ""}`.trim(),
          phone: account.contactPhone,
        });
      }
    } else if (assigneeTeamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: assigneeTeamId, isActive: true },
        include: {
          account: {
            select: { id: true, firstName: true, lastName: true, contactPhone: true, isActive: true },
          },
        },
      });

      for (const m of members) {
        if (m.account && m.account.isActive && isValidPhoneNumber(m.account.contactPhone)) {
          recipientAccounts.push({
            id: m.account.id,
            name: `${m.account.firstName || ""} ${m.account.lastName || ""}`.trim(),
            phone: m.account.contactPhone,
          });
        }
      }
    }

    if (recipientAccounts.length === 0) {
      await logLeadNotificationActivity({
        leadId,
        recipientType: "TEAM_MEMBER",
        status: "FAILED",
        error: "No active assigned team members with valid phone numbers found",
        performedByAccountId: assignedByAccountId,
      });
      return { success: false, status: "FAILED", count: 0, errors: ["No valid recipient phone numbers found"] };
    }

    const provider = getNotificationProvider();
    const teamMemberUrl = getTeamMemberLeadUrl(lead.id);

    // Resolve product title
    const resolvedProductTitle =
      lead.productTitle || (lead.productCatalog?.length ? lead.productCatalog[0].title : "") || "General Inquiry";

    const customerPhone = lead.mobileNumber || lead.customer?.mobile || "";
    const customerEmail = lead.customer?.email || "";
    const campaignName = process.env.ONBITS_TEAM_LEAD_CAMPAIGN || "New Member Lead";

    let successCount = 0;
    const errors: string[] = [];

    for (const recipient of recipientAccounts) {
      const normalizedPhone = normalizePhoneNumber(recipient.phone);
      if (!normalizedPhone) {
        await logLeadNotificationActivity({
          leadId: lead.id,
          recipientType: "TEAM_MEMBER",
          status: "FAILED",
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
          error: "Invalid phone number format",
          performedByAccountId: assignedByAccountId,
        });
        continue;
      }

      const dedupeKey = `lead:assigned:${lead.id}:${recipient.id}:${normalizedPhone}`;
      if (!bypassDedupe && !idempotencyCache.acquire(dedupeKey, 10 * 60 * 1000)) {
        continue;
      }

      const cleanRemark = (lead.remark || "No additional remarks")
        .replace(/[\r\n]+/g, " | ")
        .replace(/[\t]+/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .trim();

      const variables: LeadTeamMemberTemplateVariables = {
        lead_id: lead.id,
        team_member_name: recipient.name,
        customer_name: lead.customerName || "Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        product_title: resolvedProductTitle,
        is_important: Boolean(lead.isImportant),
        remark: cleanRemark,
        assigned_by_name: assignedByName,
        team_member_url: teamMemberUrl,
      };

      const message = renderTeamMemberAssignment(variables);

      const result = await provider.sendMessage({
        to: normalizedPhone,
        message,
        campaignName,
        templateName: "lead_team_member_assignment",
        templateVariables: {
          team_member_name: recipient.name,
          customer_name: `*${(lead.customerName || "Customer").trim()}*`,
          customer_phone: customerPhone || "N/A",
          product_title: `*${(resolvedProductTitle || "General Inquiry").trim()}*`,
          remark: `*${cleanRemark}*`,
          team_member_url: teamMemberUrl,
        },
        meta: {
          module: NotificationModule.LEAD,
          event: NotificationEvent.LEAD_ASSIGNED,
          leadId: lead.id,
          recipientAccountId: recipient.id,
          recipientType: RecipientType.TEAM_MEMBER,
        },
      });

      if (!result.success) {
        console.error(`[Notification] Failed to send team member lead assignment WhatsApp to ${normalizedPhone}:`, result.error);
        errors.push(result.error || `Failed to send to ${recipient.name}`);
        await logLeadNotificationActivity({
          leadId: lead.id,
          recipientType: "TEAM_MEMBER",
          status: "FAILED",
          recipientName: recipient.name,
          recipientPhone: normalizedPhone,
          campaignName,
          error: result.error || "WhatsApp delivery failed",
          performedByAccountId: assignedByAccountId,
        });
      } else {
        successCount++;
        console.log(`[Notification] Lead assignment WhatsApp sent successfully to ${recipient.name} (${normalizedPhone}) for Lead ${lead.id}`);
        await logLeadNotificationActivity({
          leadId: lead.id,
          recipientType: "TEAM_MEMBER",
          status: "SENT",
          recipientName: recipient.name,
          recipientPhone: normalizedPhone,
          campaignName,
          messageId: result.messageId,
          performedByAccountId: assignedByAccountId,
        });
      }
    }

    return {
      success: successCount > 0,
      status: successCount > 0 ? "SENT" : "FAILED",
      count: successCount,
      errors,
    };
  } catch (err: any) {
    console.error(`[Notification] Error processing lead assigned notification for ${leadId}:`, err);
    await logLeadNotificationActivity({
      leadId,
      recipientType: "TEAM_MEMBER",
      status: "FAILED",
      error: err?.message || "Internal notification error",
      performedByAccountId: assignedByAccountId,
    });
    return { success: false, status: "FAILED", count: 0, errors: [err?.message || "Internal notification error"] };
  }
}

/**
 * Direct Manual / Resend trigger for Lead WhatsApp Notifications.
 */
export async function sendLeadWhatsAppNotificationDirect(params: {
  leadId: string;
  recipientType: "CUSTOMER" | "TEAM_MEMBER";
  performedByAccountId: string;
}): Promise<{
  success: boolean;
  status: "SENT" | "FAILED";
  message: string;
  error?: string;
}> {
  const { leadId, recipientType, performedByAccountId } = params;

  if (recipientType === "CUSTOMER") {
    const res = await dispatchLeadCreatedNotification({
      leadId,
      performedByAccountId,
      bypassDedupe: true,
    });
    return {
      success: res.success,
      status: res.status === "SENT" ? "SENT" : "FAILED",
      message: res.success
        ? "WhatsApp notification sent to Customer successfully"
        : res.error || "Failed to send WhatsApp notification to Customer",
      error: res.error,
    };
  } else {
    // Find active assignment for this lead
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignments: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!lead) {
      return { success: false, status: "FAILED", message: "Lead not found" };
    }

    const activeAssignment = lead.assignments?.[0];
    if (!activeAssignment) {
      return { success: false, status: "FAILED", message: "No active team member or team assigned to this lead" };
    }

    const res = await dispatchLeadAssignedNotification({
      leadId,
      assigneeAccountId: activeAssignment.accountId ?? undefined,
      assigneeTeamId: activeAssignment.teamId ?? undefined,
      assignedByAccountId: performedByAccountId,
      bypassDedupe: true,
    });

    return {
      success: res.success,
      status: res.status === "SENT" ? "SENT" : "FAILED",
      message: res.success
        ? `WhatsApp notification sent to ${res.count} assigned member(s)`
        : res.errors.join(", ") || "Failed to send WhatsApp notification to team member(s)",
      error: res.errors.join(", "),
    };
  }
}

/**
 * Handles automated WhatsApp notification to all ADMIN users when a public lead is submitted.
 */
export async function dispatchAdminPublicLeadNotification(
  params: LeadAdminPublicLeadNotificationParams,
): Promise<void> {
  const { leadId, source } = params;

  try {
    const isEnabled = process.env.ONBITS_ENABLED !== "false";
    if (!isEnabled) {
      console.log(`[Notification] WhatsApp notifications disabled via ONBITS_ENABLED=false`);
      return;
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        customer: { select: { email: true, mobile: true } },
        productCatalog: { select: { title: true } },
      },
    });

    if (!lead) {
      console.warn(`[Notification] Lead not found for admin public lead notification: ${leadId}`);
      return;
    }

    // Find all active accounts with role ADMIN
    const adminAccounts = await prisma.account.findMany({
      where: {
        isActive: true,
        user: {
          roles: {
            some: {
              role: {
                name: "ADMIN",
              },
            },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        contactPhone: true,
      },
    });

    if (adminAccounts.length === 0) {
      console.log(`[Notification] No active admin accounts with contact phone found for public lead ${leadId}`);
      return;
    }

    const sourceLabelMap: Record<string, string> = {
      WEBSITE: "Website",
      INQUIRY_FORM: "Inquiry Form",
      YOUTUBE: "YouTube",
    };
    const rawSource = source || lead.source || "WEBSITE";
    const resolvedSource = sourceLabelMap[rawSource] || rawSource;

    const resolvedProductTitle =
      lead.productTitle?.trim() || (lead.productCatalog?.length ? lead.productCatalog[0].title : "") || "General Inquiry";

    const customerPhone = lead.mobileNumber || lead.customer?.mobile || "N/A";
    const remark = (lead.remark || "No additional remarks")
      .replace(/[\r\n]+/g, " | ")
      .replace(/[\t]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .trim();

    const provider = getNotificationProvider();

    for (const admin of adminAccounts) {
      const normalizedPhone = normalizePhoneNumber(admin.contactPhone);
      if (!normalizedPhone) continue;

      const dedupeKey = `lead:public_admin:${lead.id}:${admin.id}:${normalizedPhone}`;
      if (!idempotencyCache.acquire(dedupeKey, 10 * 60 * 1000)) {
        continue;
      }

      const variables: LeadAdminPublicLeadTemplateVariables = {
        source: resolvedSource,
        customer_name: (lead.customerName || "Customer").trim(),
        customer_phone: customerPhone,
        product_title: resolvedProductTitle,
        remark: remark,
        lead_id: lead.id,
      };

      const message = renderAdminPublicLead(variables);

      const result = await provider.sendMessage({
        to: normalizedPhone,
        message,
        campaignName: process.env.ONBITS_ADMIN_LEAD_CAMPAIGN || "New Admin Lead",
        templateName: "lead_admin_public_notification",
        templateVariables: {
          source: `*${resolvedSource}*`,
          customer_name: `*${(lead.customerName || "Customer").trim()}*`,
          customer_phone: customerPhone,
          product_title: `*${resolvedProductTitle}*`,
          remark: `*${remark}*`,
          lead_id: lead.id,
        },
        meta: {
          module: NotificationModule.LEAD,
          event: "PUBLIC_LEAD_CREATED",
          leadId: lead.id,
          recipientAccountId: admin.id,
          recipientType: RecipientType.ADMIN,
        },
      });

      if (!result.success) {
        console.error(`[Notification] Failed to send admin public lead WhatsApp to ${normalizedPhone}:`, result.error);
      } else {
        console.log(`[Notification] Admin public lead WhatsApp sent successfully to ${admin.firstName} (${normalizedPhone}) for Lead ${lead.id}`);
      }
    }
  } catch (err) {
    console.error(`[Notification] Error processing admin public lead notification for ${leadId}:`, err);
  }
}
