import { prisma } from "../../../config/database.config";
import { getNotificationProvider } from "../providers/provider.factory";
import {
  renderQuotationSent,
  renderQuotationReminder,
  getPublicQuotationUrl,
  buildQuotationSummary,
  formatCurrency,
  formatQuotationDate,
  QuotationTemplateVariables,
} from "../templates/quotation.templates";
import { normalizePhoneNumber, isValidPhoneNumber } from "../utils/phone.util";
import { idempotencyCache } from "../utils/idempotency.util";
import { NotificationEvent, NotificationModule, RecipientType } from "../types";

export interface QuotationWhatsAppNotificationParams {
  quotationId: string;
  recipientPhone?: string;
  performedByAccountId?: string | null;
  note?: string;
  isReminder?: boolean;
  bypassDedupe?: boolean;
}

export interface LogQuotationNotificationActivityParams {
  quotationId: string;
  status: "SENT" | "FAILED" | "NOT_SENT";
  recipientName?: string;
  recipientPhone?: string;
  campaignName?: string;
  messageId?: string;
  error?: string;
  reason?: string;
  note?: string;
  performedByAccountId?: string | null;
  isReminder?: boolean;
}

/**
 * Safely creates a QuotationActivity log entry for WhatsApp notification attempts.
 */
export async function logQuotationNotificationActivity(
  params: LogQuotationNotificationActivityParams,
): Promise<void> {
  try {
    await prisma.quotationActivity.create({
      data: {
        quotationId: params.quotationId,
        action: params.isReminder ? "REMINDER_SENT" : "SENT",
        performedBy: params.performedByAccountId ?? null,
        meta: {
          channel: "WHATSAPP",
          type: "WHATSAPP_NOTIFICATION",
          recipientType: "CUSTOMER",
          status: params.status,
          recipientName: params.recipientName,
          recipientPhone: params.recipientPhone,
          campaignName: params.campaignName,
          messageId: params.messageId,
          note: params.note,
          error: params.error,
          reason: params.reason,
          at: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.warn(`[Notification] Failed to log quotation activity for ${params.quotationId}:`, err);
  }
}

/**
 * Dispatches a WhatsApp notification for a Quotation (initial send or reminder).
 * Pulls dynamic quotation details, normalizes phone, builds Meta-compliant template,
 * invokes active WhatsApp provider, and records activity history.
 */
export async function dispatchQuotationWhatsAppNotification(
  params: QuotationWhatsAppNotificationParams,
): Promise<{
  success: boolean;
  status: "SENT" | "FAILED" | "NOT_SENT";
  messageId?: string;
  error?: string;
}> {
  const {
    quotationId,
    recipientPhone: rawRecipientPhone,
    performedByAccountId,
    note,
    isReminder = false,
    bypassDedupe = false,
  } = params;

  try {
    const isEnabled = process.env.ONBITS_ENABLED !== "false";
    if (!isEnabled) {
      console.log(`[Notification] WhatsApp notifications disabled via ONBITS_ENABLED=false`);
      await logQuotationNotificationActivity({
        quotationId,
        status: "NOT_SENT",
        reason: "WhatsApp notifications disabled via ONBITS_ENABLED=false",
        performedByAccountId,
        isReminder,
        note,
      });
      return { success: false, status: "NOT_SENT", error: "WhatsApp provider disabled" };
    }

    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            mobile: true,
            email: true,
            customerCompanyName: true,
          },
        },
        lineItems: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            name: true,
            qty: true,
            unit: true,
            basePrice: true,
            discountedPrice: true,
            totalPrice: true,
          },
        },
        preparedByAcc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            contactPhone: true,
          },
        },
        createdByAcc: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            designation: true,
            contactPhone: true,
          },
        },
      },
    });

    if (!quotation) {
      console.warn(`[Notification] Quotation not found for id: ${quotationId}`);
      return { success: false, status: "FAILED", error: "Quotation not found" };
    }

    const snapshot = quotation.customerSnapshot as any;
    const targetRawPhone =
      rawRecipientPhone?.trim() ||
      quotation.customer?.mobile ||
      snapshot?.mobile ||
      "";

    if (!targetRawPhone || !isValidPhoneNumber(targetRawPhone)) {
      console.warn(`[Notification] Quotation ${quotationId} has invalid customer phone: ${targetRawPhone}`);
      await logQuotationNotificationActivity({
        quotationId,
        status: "FAILED",
        recipientName: quotation.customer?.name || snapshot?.name,
        recipientPhone: targetRawPhone,
        error: `Invalid recipient phone number: ${targetRawPhone || "missing"}`,
        performedByAccountId,
        isReminder,
        note,
      });
      return { success: false, status: "FAILED", error: `Invalid phone number: ${targetRawPhone || "missing"}` };
    }

    const customerPhone = normalizePhoneNumber(targetRawPhone)!;
    const dedupeKey = `quotation:${isReminder ? "reminder" : "sent"}:${quotationId}:${customerPhone}`;

    if (!bypassDedupe && !idempotencyCache.acquire(dedupeKey, 5 * 60 * 1000)) {
      console.log(`[Notification] Duplicate quotation notification prevented for ${dedupeKey}`);
      return { success: true, status: "SENT", error: "Duplicate request prevented" };
    }

    // Resolve preparer / sales representative details
    const preparer = quotation.preparedByAcc || quotation.createdByAcc;
    let preparedByName = "Mr. Mehul Patel";
    let preparedByPhone = "8141703007";

    if (preparer) {
      const resolvedName = `${preparer.firstName || ""} ${preparer.lastName || ""}`.trim();
      if (resolvedName) preparedByName = resolvedName;
      if (preparer.contactPhone) preparedByPhone = preparer.contactPhone;
    }

    const customerName = (quotation.customer?.name || snapshot?.name || "Customer").trim();
    const formattedTotal = formatCurrency(quotation.grandTotal);
    const validUntilDate = formatQuotationDate(quotation.validUntil);
    const quotationSummary = buildQuotationSummary(quotation.lineItems, quotation.subject);
    const quotationUrl = getPublicQuotationUrl(quotation.id);

    const variables: QuotationTemplateVariables = {
      customer_name: customerName,
      quotation_number: quotation.quotationNumber,
      grand_total: formattedTotal,
      quotation_summary: quotationSummary,
      valid_until: validUntilDate,
      quotation_url: quotationUrl,
      prepared_by_name: preparedByName,
      prepared_by_phone: preparedByPhone,
      company_name: "Shivansh Infosys",
      company_website: "www.shivanshinfosys.in",
      subject: quotation.subject || undefined,
      note: note || undefined,
    };

    const message = isReminder
      ? renderQuotationReminder(variables)
      : renderQuotationSent(variables);

    const provider = getNotificationProvider();
    const defaultCampaign = isReminder
      ? process.env.ONBITS_QUOTATION_REMINDER_CAMPAIGN || "Quotation"
      : process.env.ONBITS_QUOTATION_CAMPAIGN || "Quotation";
    const campaignName = defaultCampaign;

    const templateName = isReminder
      ? "quotation_reminder_customer"
      : "quotation_share_customer";

    const result = await provider.sendMessage({
      to: customerPhone,
      message,
      campaignName,
      templateName,
      templateVariables: {
        customer_name: customerName,
        quotation_number: quotation.quotationNumber,
        grand_total: formattedTotal,
        valid_until: validUntilDate,
        quotation_summary: quotationSummary,
        quotation_url: quotationUrl,
        prepared_by_name: preparedByName,
        prepared_by_phone: preparedByPhone,
      },
      meta: {
        module: NotificationModule.QUOTATION,
        event: isReminder ? NotificationEvent.QUOTATION_SENT : NotificationEvent.QUOTATION_SENT,
        quotationId: quotation.id,
        recipientType: RecipientType.CUSTOMER,
      },
    });

    if (!result.success) {
      console.error(
        `[Notification] Failed to send quotation WhatsApp notification to ${customerPhone}:`,
        result.error,
      );
      await logQuotationNotificationActivity({
        quotationId,
        status: "FAILED",
        recipientName: customerName,
        recipientPhone: customerPhone,
        campaignName,
        error: result.error || "WhatsApp delivery failed",
        performedByAccountId,
        isReminder,
        note,
      });
      return { success: false, status: "FAILED", error: result.error };
    }

    console.log(
      `[Notification] Quotation WhatsApp notification sent successfully for Quotation ${quotation.quotationNumber} to ${customerPhone}`,
    );

    await logQuotationNotificationActivity({
      quotationId,
      status: "SENT",
      recipientName: customerName,
      recipientPhone: customerPhone,
      campaignName,
      messageId: result.messageId,
      performedByAccountId,
      isReminder,
      note,
    });

    return { success: true, status: "SENT", messageId: result.messageId };
  } catch (err: any) {
    console.error(`[Notification] Error processing quotation notification for ${quotationId}:`, err);
    await logQuotationNotificationActivity({
      quotationId,
      status: "FAILED",
      error: err?.message || "Internal notification error",
      performedByAccountId,
      isReminder,
      note,
    });
    return { success: false, status: "FAILED", error: err?.message || "Internal notification error" };
  }
}
