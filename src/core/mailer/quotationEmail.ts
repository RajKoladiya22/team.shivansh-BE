// src/emails/quotationEmail.ts

export interface QuotationLineItem {
  title: string;
  type?: string;
  qty: number;
  rate: number;             // discountedPrice (after per-item discount)
  baseRate?: number;        // basePrice (before discount)
  discountType?: string;    // "PERCENTAGE" | "FIXED"
  discountValue?: number;
  taxPercent?: number;
  amount: number;           // totalPrice incl. tax
}

export interface QuotationEmailData {
  quotationNumber: string;
  quotationUrl: string;
  subject?: string;                  // q.subject — "New Tally"
  customerName: string;
  customerCompanyName?: string;      // q.customer.customerCompanyName
  customerCity?: string;
  customerState?: string;
  customerGstin?: string;            // q.customerGstin
  companyGstin?: string;             // q.gstin
  companyName: string;
  preparedByName?: string;
  preparedByDesignation?: string;
  preparedByPhone?: string;
  grandTotal: number;
  subtotal: number;
  taxAmount: number;
  totalDiscount?: number;            // q.totalDiscount
  extraDiscountType?: string;        // "PERCENTAGE" | "FIXED"
  extraDiscountValue?: number;       // e.g. 10
  extraDiscountNote?: string;
  taxLabel?: string;
  currency?: string;
  createdAt: string;
  validUntil?: string;
  isReminder?: boolean;
  items: QuotationLineItem[];
  introNote?: string;                // q.introNote — opening letter text
  termsNote?: string;                // q.termsNote — bullet T&C
  footerNote?: string;               // q.footerNote
  paymentTerms?: string;             // q.paymentTerms
  paymentDueDays?: number;           // q.paymentDueDays
  deliveryScope?: string;            // q.deliveryScope — bullet points
  deliveryDays?: number;             // q.deliveryDays
}

// ─── formatters ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Convert bullet-point text (lines starting with •) to HTML list */
function bulletToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const clean = line.startsWith("•") ? line.slice(1).trim() : line;
      return `<li style="margin-bottom:6px;">${clean}</li>`;
    })
    .join("");
}

// ─── main HTML template ───────────────────────────────────────────────────────

export function quotationEmailHtml(data: QuotationEmailData): string {
  const {
    quotationNumber,
    quotationUrl,
    subject,
    customerName,
    customerCompanyName,
    customerCity,
    customerState,
    customerGstin,
    companyGstin,
    companyName,
    preparedByName,
    preparedByDesignation,
    preparedByPhone,
    grandTotal,
    subtotal,
    taxAmount,
    totalDiscount,
    extraDiscountType,
    extraDiscountValue,
    extraDiscountNote,
    taxLabel = "GST",
    currency = "INR",
    createdAt,
    validUntil,
    isReminder = false,
    items,
    introNote,
    termsNote,
    footerNote,
    paymentTerms,
    paymentDueDays,
    deliveryScope,
    deliveryDays,
  } = data;

  const year = new Date().getFullYear();
  const ctaText = isReminder ? "Review Quotation" : "View & Accept Quotation";
  const heroMessage = isReminder
    ? `This is a friendly reminder about quotation <strong>${quotationNumber}</strong>. It's still awaiting your review.`
    : `Please find enclosed our best proposal for your requirements.`;

  // ── Extra discount label ──
  const extraDiscountLabel =
    extraDiscountType && extraDiscountValue
      ? extraDiscountType === "PERCENTAGE"
        ? `Extra Discount (${extraDiscountValue}%)`
        : `Extra Discount`
      : null;

  // ── Per-item discount indicator ──
  const hasLineDiscount = items.some(
    (it) => it.discountValue != null && it.discountValue > 0,
  );

  // ── Build item rows ──
  const itemRows = items
    .map((item, i) => {
      const hasDiscount =
        item.discountValue != null &&
        item.discountValue > 0 &&
        item.baseRate != null &&
        item.baseRate !== item.rate;

      const discountBadge = hasDiscount
        ? `<div style="display:inline-block;margin-top:4px;font-size:10px;font-weight:600;color:#16a34a;background:#dcfce7;border-radius:4px;padding:1px 6px;">
             −${item.discountType === "PERCENTAGE" ? `${item.discountValue}%` : `₹${fmt(item.discountValue!)}`} off
           </div>`
        : "";

      return `<tr>
        <td style="padding:14px 16px;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${i + 1}</td>
        <td style="padding:14px 16px;vertical-align:top;border-bottom:1px solid #f3f4f6;">
          <div style="font-weight:600;color:#111827;font-size:13px;line-height:1.45;">${item.title}</div>
          ${item.type ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px;letter-spacing:0.5px;text-transform:uppercase;">${item.type}</div>` : ""}
          ${discountBadge}
        </td>
        <td style="padding:14px 16px;text-align:center;color:#374151;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${item.qty}</td>
        <td style="padding:14px 16px;text-align:right;vertical-align:top;border-bottom:1px solid #f3f4f6;">
          ${hasDiscount ? `<div style="font-size:11px;color:#9ca3af;text-decoration:line-through;">₹${fmt(item.baseRate!)}</div>` : ""}
          <div style="font-size:13px;color:#374151;font-weight:500;">₹${fmt(item.rate)}</div>
        </td>
        <td style="padding:14px 16px;text-align:center;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${item.taxPercent != null ? `${item.taxPercent}%` : "—"}</td>
        <td style="padding:14px 16px;text-align:right;font-weight:700;color:#111827;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">₹${fmt(item.amount)}</td>
      </tr>`;
    })
    .join("");

  // ── Totals block rows ──
  const discountRow =
    totalDiscount && totalDiscount > 0
      ? `<tr>
           <td style="padding:5px 0;font-size:13px;color:#16a34a;">Item Discounts</td>
           <td style="padding:5px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:500;">−₹${fmt(totalDiscount)}</td>
         </tr>`
      : "";

  const extraDiscountRow =
    extraDiscountLabel && extraDiscountValue
      ? `<tr>
           <td style="padding:5px 0;font-size:13px;color:#16a34a;">
             ${extraDiscountLabel}
             ${extraDiscountNote ? `<div style="font-size:11px;color:#9ca3af;">${extraDiscountNote}</div>` : ""}
           </td>
           <td style="padding:5px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:500;">Applied</td>
         </tr>`
      : "";

  // ── Delivery/payment/terms section ──
  const hasExtra = paymentTerms || deliveryScope || termsNote;

  const deliverySection = deliveryScope
    ? `<div style="margin-bottom:20px;">
         <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">
           Delivery Scope${deliveryDays ? ` · ${deliveryDays} days` : ""}
         </div>
         <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.6;">
           ${bulletToHtml(deliveryScope)}
         </ul>
       </div>`
    : "";

  const paymentSection = paymentTerms
    ? `<div style="margin-bottom:20px;">
         <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">
           Payment Terms${paymentDueDays ? ` · Due in ${paymentDueDays} days` : ""}
         </div>
         <div style="font-size:13px;color:#374151;">${paymentTerms}</div>
       </div>`
    : "";

  const termsSection = termsNote
    ? `<div>
         <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Terms &amp; Conditions</div>
         <ul style="margin:0;padding-left:18px;color:#6b7280;font-size:12px;line-height:1.7;">
           ${bulletToHtml(termsNote)}
         </ul>
       </div>`
    : "";

  const extraSection = hasExtra
    ? `<tr>
         <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:24px 36px;">
           ${deliverySection}${paymentSection}${termsSection}
         </td>
       </tr>`
    : "";

  // ── GSTIN row ──
//   const gstinRow =
//     companyGstin || customerGstin
//       ? `<tr style="background:#f9fafb;">
//            ${companyGstin ? `<td style="padding:6px 36px;font-size:11px;color:#9ca3af;">Our GSTIN: <span style="color:#374151;font-weight:600;font-family:monospace;">${companyGstin}</span></td>` : "<td></td>"}
//            ${customerGstin ? `<td style="padding:6px 36px;font-size:11px;color:#9ca3af;">Your GSTIN: <span style="color:#374151;font-weight:600;font-family:monospace;">${customerGstin}</span></td>` : "<td></td>"}
//          </tr>`
//       : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isReminder ? "Reminder: " : ""}Quotation ${quotationNumber} · Shivansh Infosys</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#374151;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:28px 12px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:660px;">

  <!-- ══ HERO HEADER ══ -->
  <tr>
    <td style="background:linear-gradient(140deg,#0f172a 0%,#1e293b 100%);border-radius:16px 16px 0 0;padding:32px 36px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="vertical-align:top;">
            <!-- Brand -->
            <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;line-height:1;">
              <span style="color:#dc2626;">SHIVANSH</span>
              <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
            </div>
            <div style="font-size:10px;color:#64748b;margin-top:4px;letter-spacing:0.3px;">
              Authorized Tally Partner &nbsp;·&nbsp; Quick Response – Quick Support
            </div>
            <!-- Company address block -->
            <div style="margin-top:14px;font-size:11px;color:#64748b;line-height:1.7;">
              📍 214–215 Soham Arcade, Adajan, Surat 395009<br/>
              📍 105, Ajit Plaza, Vapi, Valsad 396191<br/>
              📞 8141 703007 &nbsp;/&nbsp; 9484843007<br/>
              ✉️ info@shivanshinfosys.com
            </div>
          </td>
          <td align="right" valign="top" style="min-width:140px;">
            <div style="font-size:10px;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Grand Total</div>
            <div style="font-size:32px;font-weight:800;color:#ffffff;line-height:1;">₹${fmt(grandTotal)}</div>
            <div style="font-size:10px;color:#475569;margin-top:4px;">${currency} · incl. all taxes</div>
            ${validUntil ? `<div style="margin-top:10px;font-size:11px;font-weight:600;color:#fbbf24;">⏳ Valid: ${fmtDate(validUntil)}</div>` : ""}
          </td>
        </tr>
      </table>

      <!-- Quotation number + badge -->
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;font-family:'Courier New',Courier,monospace;">
          ${quotationNumber}
        </div>
        ${subject ? `<div style="margin-top:6px;font-size:12px;color:#94a3b8;">${subject}</div>` : ""}
        <div style="margin-top:10px;display:inline-block;padding:3px 12px;border-radius:20px;background:rgba(255,255,255,0.09);color:#cbd5e1;font-size:11px;font-weight:500;">
          ${isReminder ? "⏰ Reminder" : "📄 Quotation"} &nbsp;·&nbsp; ${fmtDate(createdAt)}
        </div>
      </div>
    </td>
  </tr>

  <!-- ══ FORMAL LETTER INTRO ══ -->
  <tr>
    <td style="background:#ffffff;padding:28px 36px 20px;border-bottom:1px solid #f1f5f9;">

      <!-- To block -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="vertical-align:top;width:55%;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">To</div>
            ${customerCompanyName ? `<div style="font-size:15px;font-weight:700;color:#111827;">${customerCompanyName}</div>` : ""}
            <div style="font-size:13px;${customerCompanyName ? "color:#6b7280;margin-top:2px;" : "font-size:15px;font-weight:700;color:#111827;"}">${customerName}</div>
            ${customerCity || customerState ? `<div style="font-size:12px;color:#9ca3af;margin-top:3px;">📍 ${[customerCity, customerState].filter(Boolean).join(", ")}</div>` : ""}
            ${customerGstin ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;font-family:monospace;">GSTIN: ${customerGstin}</div>` : ""}
          </td>
          <td style="vertical-align:top;width:45%;text-align:right;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Prepared By</div>
            <div style="font-size:14px;font-weight:700;color:#111827;">${companyName}</div>
            ${preparedByName ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${preparedByName}${preparedByDesignation ? ` — ${preparedByDesignation}` : ""}</div>` : ""}
            ${preparedByPhone ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">📞 ${preparedByPhone}</div>` : ""}
            ${companyGstin ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;font-family:monospace;">GSTIN: ${companyGstin}</div>` : ""}
          </td>
        </tr>
      </table>

      <!-- Respected Sir + intro paragraph -->
      <div style="margin-top:22px;padding:18px 20px;background:#f8fafc;border-left:3px solid #dc2626;border-radius:0 8px 8px 0;">
        <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;">Respected Sir / Ma'am,</div>
        <div style="font-size:13px;color:#4b5563;line-height:1.75;">
          ${
            introNote
              ? introNote
              : isReminder
              ? `This is a friendly reminder about quotation <strong>${quotationNumber}</strong>. It is still awaiting your review and acceptance.`
              : `First of all, thanks for your valued evaluation of our company for your requirements. With respect to your requirements given, please find enclosed herewith our best proposal and commitments to stand along with you and your good organization.`
          }
        </div>
      </div>
    </td>
  </tr>

  <!-- ══ PRODUCTS & SERVICES ══ -->
  <tr>
    <td style="background:#ffffff;padding:20px 24px 0;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:12px;padding:0 12px;">
        Products &amp; Services
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #f1f5f9;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:32px;">#</th>
            <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;">Item</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:50px;">Qty</th>
            <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:90px;">Rate</th>
            <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:60px;">Tax</th>
            <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:90px;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </td>
  </tr>

  <!-- ══ TOTALS ══ -->
  <tr>
    <td style="background:#ffffff;padding:16px 24px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-left:auto;max-width:300px;">
        <tr>
          <td style="padding:5px 0;font-size:13px;color:#6b7280;">Subtotal</td>
          <td style="padding:5px 0;font-size:13px;color:#374151;text-align:right;font-weight:500;">₹${fmt(subtotal)}</td>
        </tr>
        ${discountRow}
        ${extraDiscountRow}
        <tr>
          <td style="padding:5px 0;font-size:13px;color:#6b7280;">${taxLabel}</td>
          <td style="padding:5px 0;font-size:13px;color:#374151;text-align:right;font-weight:500;">₹${fmt(taxAmount)}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding-top:10px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="background:#0f172a;border-radius:10px;padding:14px 18px;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td>
                        <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Grand Total</div>
                        <div style="font-size:10px;color:#475569;margin-top:2px;">${currency} · incl. all taxes</div>
                      </td>
                      <td align="right">
                        <div style="font-size:24px;font-weight:800;color:#ffffff;">₹${fmt(grandTotal)}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ GSTIN ROW ══ -->

  <!-- ══ EXTRA: DELIVERY / PAYMENT / TERMS ══ -->
  ${extraSection}

  <!-- ══ NOTE / FOOTER NOTE ══ -->
  ${
    footerNote
      ? `<tr>
           <td style="background:#fffbeb;border-top:1px solid #fde68a;padding:18px 36px;">
             <div style="font-size:10px;font-weight:700;color:#92400e;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Note</div>
             <div style="font-size:13px;color:#78350f;line-height:1.65;">${footerNote}</div>
           </td>
         </tr>`
      : ""
  }

  <!-- ══ CTA ══ -->
  <tr>
    <td style="background:#ffffff;padding:24px 36px 32px;text-align:center;border-top:1px solid #f1f5f9;">
      <a href="${quotationUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.3px;">
        ${ctaText} →
      </a>
      <div style="margin-top:12px;font-size:11px;color:#94a3b8;">
        Or copy this link:<br/>
        <a href="${quotationUrl}" style="color:#dc2626;text-decoration:none;word-break:break-all;font-size:11px;">${quotationUrl}</a>
      </div>
    </td>
  </tr>

  <!-- ══ HELP ══ -->
  <tr>
    <td style="background:#f8fafc;padding:16px 36px;text-align:center;border-top:1px solid #f1f5f9;">
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="https://shivanshinfosys.in/contact" style="color:#dc2626;text-decoration:none;font-weight:600;">shivanshinfosys.in/contact</a><br/>
        📞 8141 703007 &nbsp;/&nbsp; 9484843007 &nbsp;·&nbsp; ✉️ info@shivanshinfosys.com
      </p>
    </td>
  </tr>

  <!-- ══ FOOTER ══ -->
  <tr>
    <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:22px 36px;text-align:center;">
      <div style="font-size:15px;font-weight:800;letter-spacing:-0.3px;">
        <span style="color:#dc2626;">SHIVANSH</span>
        <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
      </div>
      <div style="font-size:10px;color:#475569;margin-top:3px;">Quick Response – Quick Support</div>
      <div style="margin-top:10px;font-size:10px;color:#334155;">
        214–215 Soham Arcade, Adajan, Surat 395009 &nbsp;·&nbsp; 105 Ajit Plaza, Vapi 396191
      </div>
      <div style="margin-top:10px;font-size:10px;color:#1e293b;">
        © ${year} Shivansh Infosys. All rights reserved.
      </div>
    </td>
  </tr>

  <tr><td style="height:24px;"></td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

// ─── plain-text fallback ──────────────────────────────────────────────────────

export function quotationEmailText(data: QuotationEmailData): string {
  const { quotationNumber, quotationUrl, customerName, grandTotal, isReminder, paymentTerms, validUntil } = data;
  const validLine = validUntil ? `\nValid Until: ${fmtDate(validUntil)}` : "";
  const paymentLine = paymentTerms ? `\nPayment Terms: ${paymentTerms}` : "";
  if (isReminder) {
    return `Dear ${customerName},\n\nThis is a friendly reminder about quotation ${quotationNumber} from Shivansh Infosys. It is still awaiting your review.\n\nGrand Total: ₹${fmt(grandTotal)}${validLine}\n\nView your quotation: ${quotationUrl}\n\n— Shivansh Infosys\n8141 703007 / 9484843007\ninfo@shivanshinfosys.com`;
  }
  return `Dear ${customerName},\n\nThank you for your interest. Please find below our quotation ${quotationNumber} from Shivansh Infosys.\n\nGrand Total: ₹${fmt(grandTotal)}${validLine}${paymentLine}\n\nView & accept your quotation: ${quotationUrl}\n\n— Shivansh Infosys\n8141 703007 / 9484843007\ninfo@shivanshinfosys.com`;
}