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
}

export interface LeadAssignedNotificationParams {
  leadId: string;
  assigneeAccountId?: string | null;
  assigneeTeamId?: string | null;
  assignedByAccountId?: string | null;
}

export interface LeadAdminPublicLeadNotificationParams {
  leadId: string;
  source?: string;
}

/**
 * Handles WhatsApp notification when a new Lead is created.
 * Sends confirmation to the customer with tracking URL and assigned representative details.
 */
export async function dispatchLeadCreatedNotification(params: LeadCreatedNotificationParams): Promise<void> {
  const { leadId } = params;

  try {
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
      return;
    }

    if (!isValidPhoneNumber(lead.mobileNumber)) {
      console.warn(`[Notification] Lead ${leadId} has invalid customer phone: ${lead.mobileNumber}`);
      return;
    }

    const customerPhone = normalizePhoneNumber(lead.mobileNumber)!;
    const dedupeKey = `lead:created:${leadId}:${customerPhone}`;

    if (!idempotencyCache.acquire(dedupeKey)) {
      console.log(`[Notification] Duplicate lead created notification prevented for ${dedupeKey}`);
      return;
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

    const result = await provider.sendMessage({
      to: customerPhone,
      message,
      campaignName: process.env.ONBITS_CUSTOMER_LEAD_CAMPAIGN || "New Customer Lead",
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
    } else {
      console.log(`[Notification] Customer WhatsApp notification sent successfully for Lead ${leadId}`);
    }
  } catch (err) {
    console.error(`[Notification] Error processing lead created notification for ${leadId}:`, err);
  }
}

/**
 * Handles WhatsApp notification when a Lead is assigned / reassigned.
 * Sends notification with lead information and direct portal link to the assigned team member(s).
 */
export async function dispatchLeadAssignedNotification(params: LeadAssignedNotificationParams): Promise<void> {
  const { leadId, assigneeAccountId, assigneeTeamId, assignedByAccountId } = params;

  try {
    const isEnabled = process.env.ONBITS_ENABLED !== "false";
    if (!isEnabled) {
      console.log(`[Notification] WhatsApp notifications disabled via ONBITS_ENABLED=false`);
      return;
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
      return;
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
      return;
    }

    const provider = getNotificationProvider();
    const teamMemberUrl = getTeamMemberLeadUrl(lead.id);

    // Resolve product title
    const resolvedProductTitle =
      lead.productTitle || (lead.productCatalog?.length ? lead.productCatalog[0].title : "") || "General Inquiry";

    const customerPhone = lead.mobileNumber || lead.customer?.mobile || "";
    const customerEmail = lead.customer?.email || "";

    for (const recipient of recipientAccounts) {
      const normalizedPhone = normalizePhoneNumber(recipient.phone);
      if (!normalizedPhone) continue;

      const dedupeKey = `lead:assigned:${lead.id}:${recipient.id}:${normalizedPhone}`;
      if (!idempotencyCache.acquire(dedupeKey, 10 * 60 * 1000)) {
        // Skip duplicate assignment notification within 10 minutes
        continue;
      }

      const variables: LeadTeamMemberTemplateVariables = {
        lead_id: lead.id,
        team_member_name: recipient.name,
        customer_name: lead.customerName || "Customer",
        customer_phone: customerPhone,
        customer_email: customerEmail,
        product_title: resolvedProductTitle,
        is_important: Boolean(lead.isImportant),
        remark: lead.remark || undefined,
        assigned_by_name: assignedByName,
        team_member_url: teamMemberUrl,
      };

      const message = renderTeamMemberAssignment(variables);

      const result = await provider.sendMessage({
        to: normalizedPhone,
        message,
        campaignName: process.env.ONBITS_TEAM_LEAD_CAMPAIGN || "New Member Lead",
        templateName: "lead_team_member_assignment",
        templateVariables: {
          team_member_name: recipient.name,
          customer_name: `*${(lead.customerName || "Customer").trim()}*`,
          customer_phone: customerPhone || "N/A",
          product_title: `*${(resolvedProductTitle || "General Inquiry").trim()}*`,
          remark: `*${(lead.remark || "No additional remarks").trim()}*`,
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
      } else {
        console.log(`[Notification] Lead assignment WhatsApp sent successfully to ${recipient.name} (${normalizedPhone}) for Lead ${lead.id}`);
      }
    }
  } catch (err) {
    console.error(`[Notification] Error processing lead assigned notification for ${leadId}:`, err);
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
    const remark = lead.remark?.trim() || "No additional remarks";

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
