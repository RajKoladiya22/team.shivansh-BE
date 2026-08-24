export const QUOTATION_BASE_URL =
  process.env.PUBLIC_QUOTATION_URL ||
  process.env.QUOTATION_BASE_URL ||
  "https://shivanshinfosys.in/quotation";

export function getPublicQuotationUrl(quotationId: string): string {
  return `${QUOTATION_BASE_URL.replace(/\/$/, "")}/${quotationId}`;
}

export interface QuotationTemplateVariables {
  customer_name?: string;
  quotation_number?: string;
  grand_total?: string;
  quotation_summary?: string;
  valid_until?: string;
  quotation_url?: string;
  prepared_by_name?: string;
  prepared_by_phone?: string;
  company_name?: string;
  company_website?: string;
  subject?: string;
  note?: string;
  // Aliases for campaign parameter compatibility
  quotation_id?: string;
  total_amount?: string;
}

export function formatCurrency(amount: number | string | any): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatQuotationDate(date: Date | string | null | undefined): string {
  if (!date) return "N/A";
  try {
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "N/A";
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "N/A";
  }
}

/**
 * Builds a concise, clean summary of line items for WhatsApp messaging.
 */
export function buildQuotationSummary(lineItems: any[] = [], subject?: string | null): string {
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    const items = lineItems
      .slice(0, 3)
      .map((item) => {
        const name = (item.name || item.title || "Item").trim();
        const qty = item.qty ? ` (Qty: ${item.qty})` : "";
        return `${name}${qty}`;
      });

    let summary = items.join(", ");
    if (lineItems.length > 3) {
      summary += ` and ${lineItems.length - 3} more item(s)`;
    }
    return summary;
  }

  if (subject && subject.trim()) {
    return subject.trim();
  }

  return "Product / Service Quotation";
}

/**
 * Builds the customer quotation message adhering strictly to Meta's
 * Utility category guidelines (transactional, factual, non-promotional).
 */
export function renderQuotationSent(variables: QuotationTemplateVariables): string {
  const customerName = (variables.customer_name || "Valued Customer").replace(/^\*|\*$/g, "").trim();
  const quotationNumber = (variables.quotation_number || "N/A").replace(/^\*|\*$/g, "").trim();
  const grandTotal = variables.grand_total || "0.00";
  const validUntil = variables.valid_until || "N/A";
  const summary = variables.quotation_summary || "Quotation details";
  const quotationUrl = variables.quotation_url || (variables.quotation_id ? getPublicQuotationUrl(variables.quotation_id) : "");
  const preparerName = (variables.prepared_by_name || "Mr. Mehul Patel").replace(/^\*|\*$/g, "").trim();
  const preparerPhone = variables.prepared_by_phone || "8141703007";
  const website = variables.company_website || "www.shivanshinfosys.in";

  const lines: string[] = [];
  lines.push(`Hello ${customerName},`);
  lines.push("");
  lines.push("Thank you for contacting Shivansh Infosys.");
  lines.push(`Your quotation *#${quotationNumber}* is ready.`);
  lines.push("");
  lines.push("Quotation Details:");
  lines.push(`• Total Amount: ₹${grandTotal}`);
  if (validUntil && validUntil !== "N/A") {
    lines.push(`• Valid Until: ${validUntil}`);
  }
  lines.push(`• Scope/Items: ${summary}`);

  if (quotationUrl) {
    lines.push("");
    lines.push("View and accept your quotation online:");
    lines.push(quotationUrl);
  }

  lines.push("");
  lines.push("If you have any questions, please contact:");
  lines.push(preparerName);
  lines.push(preparerPhone);
  lines.push("");
  lines.push("Regards,");
  lines.push("Shivansh Infosys");
  lines.push(website);

  return lines.join("\n");
}

/**
 * Builds the follow-up reminder message adhering strictly to Meta's
 * Utility category guidelines.
 */
export function renderQuotationReminder(variables: QuotationTemplateVariables): string {
  const customerName = (variables.customer_name || "Valued Customer").replace(/^\*|\*$/g, "").trim();
  const quotationNumber = (variables.quotation_number || "N/A").replace(/^\*|\*$/g, "").trim();
  const grandTotal = variables.grand_total || "0.00";
  const validUntil = variables.valid_until || "N/A";
  const summary = variables.quotation_summary || "Quotation details";
  const quotationUrl = variables.quotation_url || (variables.quotation_id ? getPublicQuotationUrl(variables.quotation_id) : "");
  const preparerName = (variables.prepared_by_name || "Mr. Mehul Patel").replace(/^\*|\*$/g, "").trim();
  const preparerPhone = variables.prepared_by_phone || "8141703007";
  const website = variables.company_website || "www.shivanshinfosys.in";

  const lines: string[] = [];
  lines.push(`Hello ${customerName},`);
  lines.push("");
  lines.push(`This is a gentle reminder regarding quotation *#${quotationNumber}* from Shivansh Infosys.`);
  lines.push("");
  lines.push("Quotation Details:");
  lines.push(`• Total Amount: ₹${grandTotal}`);
  if (validUntil && validUntil !== "N/A") {
    lines.push(`• Valid Until: ${validUntil}`);
  }
  lines.push(`• Scope/Items: ${summary}`);

  if (quotationUrl) {
    lines.push("");
    lines.push("View and accept your quotation online:");
    lines.push(quotationUrl);
  }

  lines.push("");
  lines.push("If you have any questions, please contact:");
  lines.push(preparerName);
  lines.push(preparerPhone);
  lines.push("");
  lines.push("Regards,");
  lines.push("Shivansh Infosys");
  lines.push(website);

  return lines.join("\n");
}

export const QUOTATION_TEMPLATES = {
  QUOTATION_SENT: `Hello {{customer_name}},

Thank you for contacting Shivansh Infosys.
Your quotation *#{{quotation_number}}* is ready.

Quotation Details:
• Total Amount: ₹{{grand_total}}
• Valid Until: {{valid_until}}
• Scope/Items: {{quotation_summary}}

View and accept your quotation online:
{{quotation_url}}

If you have any questions, please contact:
{{prepared_by_name}}
{{prepared_by_phone}}

Regards,
Shivansh Infosys
www.shivanshinfosys.in`,

  QUOTATION_REMINDER: `Hello {{customer_name}},

This is a gentle reminder regarding quotation *#{{quotation_number}}* from Shivansh Infosys.

Quotation Details:
• Total Amount: ₹{{grand_total}}
• Valid Until: {{valid_until}}
• Scope/Items: {{quotation_summary}}

View and accept your quotation online:
{{quotation_url}}

If you have any questions, please contact:
{{prepared_by_name}}
{{prepared_by_phone}}

Regards,
Shivansh Infosys
www.shivanshinfosys.in`,
};
