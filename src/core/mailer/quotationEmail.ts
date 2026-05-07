// // src/emails/quotationEmail.ts

// export interface QuotationLineItem {
//   title: string;
//   type?: string;
//   qty: number;
//   rate: number;             // discountedPrice (after per-item discount)
//   baseRate?: number;        // basePrice (before discount)
//   discountType?: string;    // "PERCENTAGE" | "FIXED"
//   discountValue?: number;
//   taxPercent?: number;
//   amount: number;           // totalPrice incl. tax
// }

// export interface QuotationEmailData {
//   quotationNumber: string;
//   quotationUrl: string;
//   subject?: string;                  // q.subject — "New Tally"
//   customerName: string;
//   customerCompanyName?: string;      // q.customer.customerCompanyName
//   customerCity?: string;
//   customerState?: string;
//   customerGstin?: string;            // q.customerGstin
//   companyGstin?: string;             // q.gstin
//   companyName: string;
//   preparedByName?: string;
//   preparedByDesignation?: string;
//   preparedByPhone?: string;
//   grandTotal: number;
//   subtotal: number;
//   taxAmount: number;
//   totalDiscount?: number;            // q.totalDiscount
//   extraDiscountType?: string;        // "PERCENTAGE" | "FIXED"
//   extraDiscountValue?: number;       // e.g. 10
//   extraDiscountNote?: string;
//   taxLabel?: string;
//   currency?: string;
//   createdAt: string;
//   validUntil?: string;
//   isReminder?: boolean;
//   items: QuotationLineItem[];
//   introNote?: string;                // q.introNote — opening letter text
//   termsNote?: string;                // q.termsNote — bullet T&C
//   footerNote?: string;               // q.footerNote
//   paymentTerms?: string;             // q.paymentTerms
//   paymentDueDays?: number;           // q.paymentDueDays
//   deliveryScope?: string;            // q.deliveryScope — bullet points
//   deliveryDays?: number;             // q.deliveryDays
// }

// // ─── formatters ──────────────────────────────────────────────────────────────

// function fmt(n: number): string {
//   return new Intl.NumberFormat("en-IN", {
//     minimumFractionDigits: 2,
//     maximumFractionDigits: 2,
//   }).format(n);
// }

// function fmtDate(iso: string): string {
//   return new Date(iso).toLocaleDateString("en-IN", {
//     day: "numeric",
//     month: "long",
//     year: "numeric",
//   });
// }

// /** Convert bullet-point text (lines starting with •) to HTML list */
// function bulletToHtml(text: string): string {
//   return text
//     .split("\n")
//     .map((line) => line.trim())
//     .filter(Boolean)
//     .map((line) => {
//       const clean = line.startsWith("•") ? line.slice(1).trim() : line;
//       return `<li style="margin-bottom:6px;">${clean}</li>`;
//     })
//     .join("");
// }

// // ─── main HTML template ───────────────────────────────────────────────────────

// export function quotationEmailHtml(data: QuotationEmailData): string {
//   const {
//     quotationNumber,
//     quotationUrl,
//     subject,
//     customerName,
//     customerCompanyName,
//     customerCity,
//     customerState,
//     customerGstin,
//     companyGstin,
//     companyName,
//     preparedByName,
//     preparedByDesignation,
//     preparedByPhone,
//     grandTotal,
//     subtotal,
//     taxAmount,
//     totalDiscount,
//     extraDiscountType,
//     extraDiscountValue,
//     extraDiscountNote,
//     taxLabel = "GST",
//     currency = "INR",
//     createdAt,
//     validUntil,
//     isReminder = false,
//     items,
//     introNote,
//     termsNote,
//     footerNote,
//     paymentTerms,
//     paymentDueDays,
//     deliveryScope,
//     deliveryDays,
//   } = data;

//   const year = new Date().getFullYear();
//   const ctaText = isReminder ? "Review Quotation" : "View & Accept Quotation";
//   const heroMessage = isReminder
//     ? `This is a friendly reminder about quotation <strong>${quotationNumber}</strong>. It's still awaiting your review.`
//     : `Please find enclosed our best proposal for your requirements.`;

//   // ── Extra discount label ──
//   const extraDiscountLabel =
//     extraDiscountType && extraDiscountValue
//       ? extraDiscountType === "PERCENTAGE"
//         ? `Extra Discount (${extraDiscountValue}%)`
//         : `Extra Discount`
//       : null;

//   // ── Per-item discount indicator ──
//   const hasLineDiscount = items.some(
//     (it) => it.discountValue != null && it.discountValue > 0,
//   );

//   // ── Build item rows ──
//   const itemRows = items
//     .map((item, i) => {
//       const hasDiscount =
//         item.discountValue != null &&
//         item.discountValue > 0 &&
//         item.baseRate != null &&
//         item.baseRate !== item.rate;

//       const discountBadge = hasDiscount
//         ? `<div style="display:inline-block;margin-top:4px;font-size:10px;font-weight:600;color:#16a34a;background:#dcfce7;border-radius:4px;padding:1px 6px;">
//              −${item.discountType === "PERCENTAGE" ? `${item.discountValue}%` : `₹${fmt(item.discountValue!)}`} off
//            </div>`
//         : "";

//       return `<tr>
//         <td style="padding:14px 16px;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${i + 1}</td>
//         <td style="padding:14px 16px;vertical-align:top;border-bottom:1px solid #f3f4f6;">
//           <div style="font-weight:600;color:#111827;font-size:13px;line-height:1.45;">${item.title}</div>
//           ${item.type ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px;letter-spacing:0.5px;text-transform:uppercase;">${item.type}</div>` : ""}
//           ${discountBadge}
//         </td>
//         <td style="padding:14px 16px;text-align:center;color:#374151;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${item.qty}</td>
//         <td style="padding:14px 16px;text-align:right;vertical-align:top;border-bottom:1px solid #f3f4f6;">
//           ${hasDiscount ? `<div style="font-size:11px;color:#9ca3af;text-decoration:line-through;">₹${fmt(item.baseRate!)}</div>` : ""}
//           <div style="font-size:13px;color:#374151;font-weight:500;">₹${fmt(item.rate)}</div>
//         </td>
//         <td style="padding:14px 16px;text-align:center;color:#6b7280;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">${item.taxPercent != null ? `${item.taxPercent}%` : "—"}</td>
//         <td style="padding:14px 16px;text-align:right;font-weight:700;color:#111827;font-size:13px;vertical-align:top;border-bottom:1px solid #f3f4f6;">₹${fmt(item.amount)}</td>
//       </tr>`;
//     })
//     .join("");

//   // ── Totals block rows ──
//   const discountRow =
//     totalDiscount && totalDiscount > 0
//       ? `<tr>
//            <td style="padding:5px 0;font-size:13px;color:#16a34a;">Item Discounts</td>
//            <td style="padding:5px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:500;">−₹${fmt(totalDiscount)}</td>
//          </tr>`
//       : "";

//   const extraDiscountRow =
//     extraDiscountLabel && extraDiscountValue
//       ? `<tr>
//            <td style="padding:5px 0;font-size:13px;color:#16a34a;">
//              ${extraDiscountLabel}
//              ${extraDiscountNote ? `<div style="font-size:11px;color:#9ca3af;">${extraDiscountNote}</div>` : ""}
//            </td>
//            <td style="padding:5px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:500;">Applied</td>
//          </tr>`
//       : "";

//   // ── Delivery/payment/terms section ──
//   const hasExtra = paymentTerms || deliveryScope || termsNote;

//   const deliverySection = deliveryScope
//     ? `<div style="margin-bottom:20px;">
//          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">
//            Delivery Scope${deliveryDays ? ` · ${deliveryDays} days` : ""}
//          </div>
//          <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.6;">
//            ${bulletToHtml(deliveryScope)}
//          </ul>
//        </div>`
//     : "";

//   const paymentSection = paymentTerms
//     ? `<div style="margin-bottom:20px;">
//          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;margin-bottom:6px;">
//            Payment Terms${paymentDueDays ? ` · Due in ${paymentDueDays} days` : ""}
//          </div>
//          <div style="font-size:13px;color:#374151;">${paymentTerms}</div>
//        </div>`
//     : "";

//   const termsSection = termsNote
//     ? `<div>
//          <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;margin-bottom:8px;">Terms &amp; Conditions</div>
//          <ul style="margin:0;padding-left:18px;color:#6b7280;font-size:12px;line-height:1.7;">
//            ${bulletToHtml(termsNote)}
//          </ul>
//        </div>`
//     : "";

//   const extraSection = hasExtra
//     ? `<tr>
//          <td style="background:#f9fafb;border-top:1px solid #f3f4f6;padding:24px 36px;">
//            ${deliverySection}${paymentSection}${termsSection}
//          </td>
//        </tr>`
//     : "";

//   // ── GSTIN row ──
// //   const gstinRow =
// //     companyGstin || customerGstin
// //       ? `<tr style="background:#f9fafb;">
// //            ${companyGstin ? `<td style="padding:6px 36px;font-size:11px;color:#9ca3af;">Our GSTIN: <span style="color:#374151;font-weight:600;font-family:monospace;">${companyGstin}</span></td>` : "<td></td>"}
// //            ${customerGstin ? `<td style="padding:6px 36px;font-size:11px;color:#9ca3af;">Your GSTIN: <span style="color:#374151;font-weight:600;font-family:monospace;">${customerGstin}</span></td>` : "<td></td>"}
// //          </tr>`
// //       : "";

//   return `<!DOCTYPE html>
// <html lang="en">
// <head>
//   <meta charset="UTF-8" />
//   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
//   <title>${isReminder ? "Reminder: " : ""}Quotation ${quotationNumber} · Shivansh Infosys</title>
// </head>
// <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#374151;">

// <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:28px 12px;">
// <tr><td align="center">
// <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:660px;">

//   <!-- ══ HERO HEADER ══ -->
//   <tr>
//     <td style="background:linear-gradient(140deg,#0f172a 0%,#1e293b 100%);border-radius:16px 16px 0 0;padding:32px 36px 28px;">
//       <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
//         <tr>
//           <td style="vertical-align:top;">
//             <!-- Brand -->
//             <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;line-height:1;">
//               <span style="color:#dc2626;">SHIVANSH</span>
//               <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
//             </div>
//             <div style="font-size:10px;color:#64748b;margin-top:4px;letter-spacing:0.3px;">
//               Authorized Tally Partner &nbsp;·&nbsp; Quick Response – Quick Support
//             </div>
//             <!-- Company address block -->
//             <div style="margin-top:14px;font-size:11px;color:#64748b;line-height:1.7;">
//               📍 214–215 Soham Arcade, Adajan, Surat 395009<br/>
//               📍 105, Ajit Plaza, Vapi, Valsad 396191<br/>
//               📞 8141 703007 &nbsp;/&nbsp; 9484843007<br/>
//               ✉️ info@shivanshinfosys.com
//             </div>
//           </td>
//           <td align="right" valign="top" style="min-width:140px;">
//             <div style="font-size:10px;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Grand Total</div>
//             <div style="font-size:32px;font-weight:800;color:#ffffff;line-height:1;">₹${fmt(grandTotal)}</div>
//             <div style="font-size:10px;color:#475569;margin-top:4px;">${currency} · incl. all taxes</div>
//             ${validUntil ? `<div style="margin-top:10px;font-size:11px;font-weight:600;color:#fbbf24;">⏳ Valid: ${fmtDate(validUntil)}</div>` : ""}
//           </td>
//         </tr>
//       </table>

//       <!-- Quotation number + badge -->
//       <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
//         <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;font-family:'Courier New',Courier,monospace;">
//           ${quotationNumber}
//         </div>
//         ${subject ? `<div style="margin-top:6px;font-size:12px;color:#94a3b8;">${subject}</div>` : ""}
//         <div style="margin-top:10px;display:inline-block;padding:3px 12px;border-radius:20px;background:rgba(255,255,255,0.09);color:#cbd5e1;font-size:11px;font-weight:500;">
//           ${isReminder ? "⏰ Reminder" : "📄 Quotation"} &nbsp;·&nbsp; ${fmtDate(createdAt)}
//         </div>
//       </div>
//     </td>
//   </tr>

//   <!-- ══ FORMAL LETTER INTRO ══ -->
//   <tr>
//     <td style="background:#ffffff;padding:28px 36px 20px;border-bottom:1px solid #f1f5f9;">

//       <!-- To block -->
//       <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
//         <tr>
//           <td style="vertical-align:top;width:55%;">
//             <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">To</div>
//             ${customerCompanyName ? `<div style="font-size:15px;font-weight:700;color:#111827;">${customerCompanyName}</div>` : ""}
//             <div style="font-size:13px;${customerCompanyName ? "color:#6b7280;margin-top:2px;" : "font-size:15px;font-weight:700;color:#111827;"}">${customerName}</div>
//             ${customerCity || customerState ? `<div style="font-size:12px;color:#9ca3af;margin-top:3px;">📍 ${[customerCity, customerState].filter(Boolean).join(", ")}</div>` : ""}
//             ${customerGstin ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;font-family:monospace;">GSTIN: ${customerGstin}</div>` : ""}
//           </td>
//           <td style="vertical-align:top;width:45%;text-align:right;">
//             <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Prepared By</div>
//             <div style="font-size:14px;font-weight:700;color:#111827;">${companyName}</div>
//             ${preparedByName ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${preparedByName}${preparedByDesignation ? ` — ${preparedByDesignation}` : ""}</div>` : ""}
//             ${preparedByPhone ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">📞 ${preparedByPhone}</div>` : ""}
//             ${companyGstin ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;font-family:monospace;">GSTIN: ${companyGstin}</div>` : ""}
//           </td>
//         </tr>
//       </table>

//       <!-- Respected Sir + intro paragraph -->
//       <div style="margin-top:22px;padding:18px 20px;background:#f8fafc;border-left:3px solid #dc2626;border-radius:0 8px 8px 0;">
//         <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px;">Respected Sir / Ma'am,</div>
//         <div style="font-size:13px;color:#4b5563;line-height:1.75;">
//           ${
//             introNote
//               ? introNote
//               : isReminder
//               ? `This is a friendly reminder about quotation <strong>${quotationNumber}</strong>. It is still awaiting your review and acceptance.`
//               : `First of all, thanks for your valued evaluation of our company for your requirements. With respect to your requirements given, please find enclosed herewith our best proposal and commitments to stand along with you and your good organization.`
//           }
//         </div>
//       </div>
//     </td>
//   </tr>

//   <!-- ══ PRODUCTS & SERVICES ══ -->
//   <tr>
//     <td style="background:#ffffff;padding:20px 24px 0;">
//       <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:12px;padding:0 12px;">
//         Products &amp; Services
//       </div>
//       <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #f1f5f9;border-radius:10px;overflow:hidden;">
//         <thead>
//           <tr style="background:#f8fafc;">
//             <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:32px;">#</th>
//             <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;">Item</th>
//             <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:50px;">Qty</th>
//             <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:90px;">Rate</th>
//             <th style="padding:10px 16px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:60px;">Tax</th>
//             <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.8px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #f1f5f9;width:90px;">Amount</th>
//           </tr>
//         </thead>
//         <tbody>${itemRows}</tbody>
//       </table>
//     </td>
//   </tr>

//   <!-- ══ TOTALS ══ -->
//   <tr>
//     <td style="background:#ffffff;padding:16px 24px 24px;">
//       <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-left:auto;max-width:300px;">
//         <tr>
//           <td style="padding:5px 0;font-size:13px;color:#6b7280;">Subtotal</td>
//           <td style="padding:5px 0;font-size:13px;color:#374151;text-align:right;font-weight:500;">₹${fmt(subtotal)}</td>
//         </tr>
//         ${discountRow}
//         ${extraDiscountRow}
//         <tr>
//           <td style="padding:5px 0;font-size:13px;color:#6b7280;">${taxLabel}</td>
//           <td style="padding:5px 0;font-size:13px;color:#374151;text-align:right;font-weight:500;">₹${fmt(taxAmount)}</td>
//         </tr>
//         <tr>
//           <td colspan="2" style="padding-top:10px;">
//             <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
//               <tr>
//                 <td style="background:#0f172a;border-radius:10px;padding:14px 18px;">
//                   <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
//                     <tr>
//                       <td>
//                         <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Grand Total</div>
//                         <div style="font-size:10px;color:#475569;margin-top:2px;">${currency} · incl. all taxes</div>
//                       </td>
//                       <td align="right">
//                         <div style="font-size:24px;font-weight:800;color:#ffffff;">₹${fmt(grandTotal)}</div>
//                       </td>
//                     </tr>
//                   </table>
//                 </td>
//               </tr>
//             </table>
//           </td>
//         </tr>
//       </table>
//     </td>
//   </tr>

//   <!-- ══ GSTIN ROW ══ -->

//   <!-- ══ EXTRA: DELIVERY / PAYMENT / TERMS ══ -->
//   ${extraSection}

//   <!-- ══ NOTE / FOOTER NOTE ══ -->
//   ${
//     footerNote
//       ? `<tr>
//            <td style="background:#fffbeb;border-top:1px solid #fde68a;padding:18px 36px;">
//              <div style="font-size:10px;font-weight:700;color:#92400e;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Note</div>
//              <div style="font-size:13px;color:#78350f;line-height:1.65;">${footerNote}</div>
//            </td>
//          </tr>`
//       : ""
//   }

//   <!-- ══ CTA ══ -->
//   <tr>
//     <td style="background:#ffffff;padding:24px 36px 32px;text-align:center;border-top:1px solid #f1f5f9;">
//       <a href="${quotationUrl}"
//          style="display:inline-block;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.3px;">
//         ${ctaText} →
//       </a>
//       <div style="margin-top:12px;font-size:11px;color:#94a3b8;">
//         Or copy this link:<br/>
//         <a href="${quotationUrl}" style="color:#dc2626;text-decoration:none;word-break:break-all;font-size:11px;">${quotationUrl}</a>
//       </div>
//     </td>
//   </tr>

//   <!-- ══ HELP ══ -->
//   <tr>
//     <td style="background:#f8fafc;padding:16px 36px;text-align:center;border-top:1px solid #f1f5f9;">
//       <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.7;">
//         Questions? Reply to this email or reach us at
//         <a href="https://shivanshinfosys.in/contact" style="color:#dc2626;text-decoration:none;font-weight:600;">shivanshinfosys.in/contact</a><br/>
//         📞 8141 703007 &nbsp;/&nbsp; 9484843007 &nbsp;·&nbsp; ✉️ info@shivanshinfosys.com
//       </p>
//     </td>
//   </tr>

//   <!-- ══ FOOTER ══ -->
//   <tr>
//     <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:22px 36px;text-align:center;">
//       <div style="font-size:15px;font-weight:800;letter-spacing:-0.3px;">
//         <span style="color:#dc2626;">SHIVANSH</span>
//         <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
//       </div>
//       <div style="font-size:10px;color:#475569;margin-top:3px;">Quick Response – Quick Support</div>
//       <div style="margin-top:10px;font-size:10px;color:#334155;">
//         214–215 Soham Arcade, Adajan, Surat 395009 &nbsp;·&nbsp; 105 Ajit Plaza, Vapi 396191
//       </div>
//       <div style="margin-top:10px;font-size:10px;color:#1e293b;">
//         © ${year} Shivansh Infosys. All rights reserved.
//       </div>
//     </td>
//   </tr>

//   <tr><td style="height:24px;"></td></tr>

// </table>
// </td></tr>
// </table>

// </body>
// </html>`;
// }

// // ─── plain-text fallback ──────────────────────────────────────────────────────

// export function quotationEmailText(data: QuotationEmailData): string {
//   const { quotationNumber, quotationUrl, customerName, grandTotal, isReminder, paymentTerms, validUntil } = data;
//   const validLine = validUntil ? `\nValid Until: ${fmtDate(validUntil)}` : "";
//   const paymentLine = paymentTerms ? `\nPayment Terms: ${paymentTerms}` : "";
//   if (isReminder) {
//     return `Dear ${customerName},\n\nThis is a friendly reminder about quotation ${quotationNumber} from Shivansh Infosys. It is still awaiting your review.\n\nGrand Total: ₹${fmt(grandTotal)}${validLine}\n\nView your quotation: ${quotationUrl}\n\n— Shivansh Infosys\n8141 703007 / 9484843007\ninfo@shivanshinfosys.com`;
//   }
//   return `Dear ${customerName},\n\nThank you for your interest. Please find below our quotation ${quotationNumber} from Shivansh Infosys.\n\nGrand Total: ₹${fmt(grandTotal)}${validLine}${paymentLine}\n\nView & accept your quotation: ${quotationUrl}\n\n— Shivansh Infosys\n8141 703007 / 9484843007\ninfo@shivanshinfosys.com`;
// }


// src/emails/quotationEmail.ts

export interface QuotationLineItem {
  title: string;
  type?: string;
  qty: number;
  rate: number;
  baseRate?: number;
  discountType?: string;
  discountValue?: number;
  taxPercent?: number;
  amount: number;
}

export interface QuotationEmailData {
  quotationNumber: string;
  quotationUrl: string;
  subject?: string;
  customerName: string;
  customerCompanyName?: string;
  customerCity?: string;
  customerState?: string;
  customerGstin?: string;
  companyGstin?: string;
  companyName: string;
  preparedByName?: string;
  preparedByDesignation?: string;
  preparedByPhone?: string;
  grandTotal: number;
  subtotal: number;
  taxAmount: number;
  totalDiscount?: number;
  extraDiscountType?: string;
  extraDiscountValue?: number;
  extraDiscountNote?: string;
  taxLabel?: string;
  currency?: string;
  createdAt: string;
  validUntil?: string;
  isReminder?: boolean;
  items: QuotationLineItem[];
  introNote?: string;
  termsNote?: string;
  footerNote?: string;
  paymentTerms?: string;
  paymentDueDays?: number;
  deliveryScope?: string;
  deliveryDays?: number;
}

// ─── formatters ───────────────────────────────────────────────────────────────

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

// ─── T&C section ─────────────────────────────────────────────────────────────

const TC_SECTIONS = [
  {
    icon: "🕐",
    title: "Support Timings",
    items: [
      "Monday to Saturday, 10:00 AM – 6:00 PM (Lunch: 1:00 PM – 2:00 PM), excluding public holidays.",
      "Queries raised outside working hours will be addressed on the next working day.",
    ],
  },
  {
    icon: "💾",
    title: "Data Backup & Security",
    items: [
      "Always take data backup as per your requirement. Tally Software does not back up your data to any server — your data resides only on your local system.",
      "Data backup is not our responsibility for new Tally Licenses or Tally TDLs.",
      "Maintaining a safe and updated backup is the customer's sole responsibility.",
      "When a TDL is applied on your data, there is a possibility of data corruption. Always test TDLs on backup data first and take a fresh backup before applying.",
    ],
  },
  {
    icon: "🆕",
    title: "For New Tally Users",
    items: [
      "We offer 1 year of free Tally Support AMC for new Tally users. After 1 year, AMC charges or per-call support charges will be applicable (1–2 minor supports may still be provided at our discretion).",
      "A dedicated WhatsApp support group will be created. You must send your query or technical issue in the group; our support team will respond or call back based on your issue.",
      "Queries raised outside working hours will be addressed on the next working day.",
    ],
  },
  {
    icon: "🔄",
    title: "For Tally Renewal Customers",
    items: [
      "Support is not free after Tally renewal. To get support, you must either purchase Tally AMC or opt for pay-per-call support.",
      "Queries raised outside working hours will be addressed on the next working day.",
    ],
  },
  {
    icon: "⚙️",
    title: "For Tally TDL Customers",
    items: [
      "No renewal charges are applicable for TDLs purchased from Shivansh Infosys, except for the Tally-to-WhatsApp module.",
      "If you purchase a 365-day (1-year) TCP file, renewal charges will be applicable after expiry.",
      "We strongly recommend testing the TDL on backup data first to ensure compatibility and avoid disruptions.",
      "1-month free support is included post-purchase.",
      "Queries raised outside working hours will be addressed on the next working day.",
      "For new releases of Tally Prime, we will provide an updated TDL version. However, in rare cases (1–2%), the TDL may not be compatible. Please confirm compatibility with our support team before updating to any new Tally release.",
      "We are not responsible for mandatory TDL updates due to government policy, accounting standard, taxation changes, or Tally updates.",
      "If we are unable to customize any TDL as per your requirement, we will refund your payment. However, no legal claims or proceedings will be entertained in this regard.",
    ],
  },
  {
    icon: "📋",
    title: "For AMC Customers",
    items: [
      "AMC includes full Tally technical support.",
      "AMC covers remote assistance only (e.g., via AnyDesk, UltraViewer, TeamViewer, etc.).",
      "Queries raised outside working hours will be addressed on the next working day.",
      "AMC is valid for 12 months from the date of purchase, unless a custom AMC period has been selected.",
    ],
  },
  {
    icon: "☁️",
    title: "For Cloud Customers",
    items: [
      "Cloud server takes daily backups of Tally data. We still strongly recommend customers maintain their own daily or weekly backup on their local system for additional safety.",
      "Restoring data from the cloud depends on the cloud provider's process and may take a minimum of 1–2 days.",
      "We are a cloud sales partner. Our responsibility is to provide support for any technical issues when the cloud service is not working.",
      "It is very important to set a User ID & Password on your Tally company to protect data privacy and ensure security.",
    ],
  },
];

function buildTCSection(): string {
  const sectionRows = TC_SECTIONS.map(
    (sec) => `
    <tr>
      <td style="padding:0 0 20px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#f8fafc;padding:10px 18px;border-bottom:1px solid #e2e8f0;">
              <span style="font-size:13px;font-weight:700;color:#0f172a;letter-spacing:0.2px;">
                ${sec.icon}&nbsp;&nbsp;${sec.title}
              </span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:14px 18px;">
              <ol style="margin:0;padding-left:18px;color:#475569;font-size:12px;line-height:1.75;">
                ${sec.items.map((item) => `<li style="margin-bottom:5px;">${item}</li>`).join("")}
              </ol>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
  ).join("");

  return `
  <!-- ══ TERMS & CONDITIONS ══ -->
  <tr>
    <td style="background:#f8fafc;border-top:2px solid #e2e8f0;padding:32px 36px 8px;">

      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td style="vertical-align:middle;">
            <div style="display:inline-block;background:#0f172a;border-radius:6px;padding:5px 12px;margin-bottom:8px;">
              <span style="font-size:10px;font-weight:700;color:#f8fafc;letter-spacing:1.5px;text-transform:uppercase;">
                Terms &amp; Conditions of Sale
              </span>
            </div>
            <div style="font-size:12px;color:#64748b;line-height:1.6;border-left:3px solid #dc2626;padding-left:12px;margin-top:4px;">
              <strong style="color:#0f172a;">Important:</strong>
              Please read the following terms carefully before proceeding. By accepting this quotation, you agree to the terms stated herein.
            </div>
          </td>
        </tr>
      </table>

      <!-- Two-column grid rows -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        ${sectionRows}
      </table>

    </td>
  </tr>

  <!-- ══ LEGAL FOOTER NOTE ══ -->
  <tr>
    <td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:16px 36px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
        These terms are subject to change without prior notice. For the most current version, visit
        <a href="https://shivanshinfosys.in/terms" style="color:#dc2626;text-decoration:none;font-weight:600;">shivanshinfosys.in/terms</a>
        &nbsp;·&nbsp; This quotation is computer-generated and valid without signature.
      </p>
    </td>
  </tr>`;
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
  const ctaText = isReminder ? "Review Quotation" : "View &amp; Accept Quotation";

  const extraDiscountLabel =
    extraDiscountType && extraDiscountValue
      ? extraDiscountType === "PERCENTAGE"
        ? `Extra Discount (${extraDiscountValue}%)`
        : `Extra Discount`
      : null;

  // ── Item rows ──
  const itemRows = items
    .map((item, i) => {
      const hasDiscount =
        item.discountValue != null &&
        item.discountValue > 0 &&
        item.baseRate != null &&
        item.baseRate !== item.rate;

      const discountBadge = hasDiscount
        ? `<div style="margin-top:4px;display:inline-block;font-size:10px;font-weight:700;color:#15803d;background:#dcfce7;border-radius:4px;padding:2px 6px;">
             −${item.discountType === "PERCENTAGE" ? `${item.discountValue}%` : `₹${fmt(item.discountValue!)}`} off
           </div>`
        : "";

      const rowBg = i % 2 === 0 ? "#ffffff" : "#fafafa";

      return `<tr style="background:${rowBg};">
        <td style="padding:14px 16px;color:#94a3b8;font-size:12px;vertical-align:top;border-bottom:1px solid #f1f5f9;width:32px;font-family:'Courier New',monospace;">${String(i + 1).padStart(2, "0")}</td>
        <td style="padding:14px 16px;vertical-align:top;border-bottom:1px solid #f1f5f9;">
          <div style="font-weight:700;color:#0f172a;font-size:13px;line-height:1.4;">${item.title}</div>
          ${item.type ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;letter-spacing:0.8px;text-transform:uppercase;font-weight:600;">${item.type}</div>` : ""}
          ${discountBadge}
        </td>
        <td style="padding:14px 16px;text-align:center;color:#374151;font-size:13px;vertical-align:top;border-bottom:1px solid #f1f5f9;font-weight:600;">${item.qty}</td>
        <td style="padding:14px 16px;text-align:right;vertical-align:top;border-bottom:1px solid #f1f5f9;">
          ${hasDiscount ? `<div style="font-size:11px;color:#cbd5e1;text-decoration:line-through;margin-bottom:2px;">₹${fmt(item.baseRate!)}</div>` : ""}
          <div style="font-size:13px;color:#0f172a;font-weight:600;">₹${fmt(item.rate)}</div>
        </td>
        <td style="padding:14px 16px;text-align:center;color:#64748b;font-size:12px;vertical-align:top;border-bottom:1px solid #f1f5f9;font-weight:500;">${item.taxPercent != null ? `${item.taxPercent}%` : "—"}</td>
        <td style="padding:14px 16px;text-align:right;font-weight:700;color:#0f172a;font-size:13px;vertical-align:top;border-bottom:1px solid #f1f5f9;">₹${fmt(item.amount)}</td>
      </tr>`;
    })
    .join("");

  // ── Totals ──
  const discountRow =
    totalDiscount && totalDiscount > 0
      ? `<tr>
           <td style="padding:6px 0;font-size:13px;color:#16a34a;display:flex;align-items:center;gap:6px;">
             <span style="display:inline-block;width:6px;height:6px;background:#16a34a;border-radius:50%;margin-right:6px;"></span>
             Item Discounts Applied
           </td>
           <td style="padding:6px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:700;">−₹${fmt(totalDiscount)}</td>
         </tr>`
      : "";

  const extraDiscountRow =
    extraDiscountLabel && extraDiscountValue
      ? `<tr>
           <td style="padding:6px 0;font-size:13px;color:#16a34a;">
             ${extraDiscountLabel}
             ${extraDiscountNote ? `<div style="font-size:11px;color:#86efac;margin-top:1px;">${extraDiscountNote}</div>` : ""}
           </td>
           <td style="padding:6px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:700;">Applied</td>
         </tr>`
      : "";

  // ── Delivery / Payment / Custom Terms ──
  const hasExtra = paymentTerms || deliveryScope || termsNote;

  const deliverySection = deliveryScope
    ? `<div style="margin-bottom:20px;">
         <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">
           Delivery Scope${deliveryDays ? ` · ${deliveryDays} days` : ""}
         </div>
         <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.7;">
           ${bulletToHtml(deliveryScope)}
         </ul>
       </div>`
    : "";

  const paymentSection = paymentTerms
    ? `<div style="margin-bottom:20px;">
         <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">
           Payment Terms${paymentDueDays ? ` · Due in ${paymentDueDays} days` : ""}
         </div>
         <div style="font-size:13px;color:#374151;line-height:1.6;">${paymentTerms}</div>
       </div>`
    : "";

  const termsSection = termsNote
    ? `<div>
         <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Additional Terms &amp; Conditions</div>
         <ul style="margin:0;padding-left:18px;color:#6b7280;font-size:12px;line-height:1.7;">
           ${bulletToHtml(termsNote)}
         </ul>
       </div>`
    : "";

  const extraSection = hasExtra
    ? `<tr>
         <td style="background:#f9fafb;border-top:1px solid #f1f5f9;padding:24px 36px;">
           ${deliverySection}${paymentSection}${termsSection}
         </td>
       </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isReminder ? "Reminder: " : ""}Quotation ${quotationNumber} · Shivansh Infosys</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#374151;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef2f7;padding:32px 12px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:660px;">

  <!-- ══ PRE-HEADER (hidden preview text) ══ -->
  <tr>
    <td style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#eef2f7;">
      ${isReminder ? `Reminder: Quotation ${quotationNumber} awaiting your review` : `Quotation ${quotationNumber} · Grand Total ₹${fmt(grandTotal)} · ${companyName}`}
      &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
    </td>
  </tr>

  <!-- ══ HERO HEADER ══ -->
  <tr>
    <td style="background:#0f172a;border-radius:16px 16px 0 0;padding:0;overflow:hidden;">

      <!-- Top accent bar -->
      <div style="height:4px;background:linear-gradient(90deg,#dc2626 0%,#ef4444 40%,#fca5a5 100%);"></div>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:32px 36px 28px;">
        <tr>
          <td style="vertical-align:top;padding-right:24px;">

            <!-- Brand wordmark -->
            <div style="margin-bottom:16px;">
              <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#dc2626;font-family:Georgia,serif;">SHIVANSH</span>
              <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#fca5a5;margin-left:4px;font-family:Georgia,serif;">INFOSYS</span>
            </div>
            <div style="font-size:10px;color:#475569;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:16px;">
              Authorized Tally Partner &nbsp;·&nbsp; Quick Response, Quick Support
            </div>

            <!-- Company contact block -->
            <table cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="font-size:12px;color:#64748b;line-height:1.8;padding-right:8px;">
                  📍 214–215 Soham Arcade, Adajan, Surat 395009<br/>
                  📍 105, Ajit Plaza, Vapi, Valsad 396191<br/>
                  📞 8141 703007 &nbsp;/&nbsp; 9484843007<br/>
                  ✉️ info@shivanshinfosys.com
                </td>
              </tr>
            </table>
          </td>

          <!-- Grand total callout -->
          <td align="right" valign="top" style="white-space:nowrap;">
            <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px 20px;text-align:center;">
              <div style="font-size:9px;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">Grand Total</div>
              <div style="font-size:30px;font-weight:800;color:#ffffff;line-height:1;font-family:Georgia,serif;">₹${fmt(grandTotal)}</div>
              <div style="font-size:10px;color:#475569;margin-top:4px;">${currency} &nbsp;·&nbsp; incl. taxes</div>
              ${validUntil ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:#fbbf24;background:#292524;border-radius:6px;padding:4px 8px;">⏳ Valid till ${fmtDate(validUntil)}</div>` : ""}
            </div>
          </td>
        </tr>
      </table>

      <!-- Quotation number band -->
      <div style="background:#1e293b;border-top:1px solid #334155;padding:16px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="vertical-align:middle;">
              <span style="font-size:11px;color:#475569;letter-spacing:1px;text-transform:uppercase;font-weight:700;margin-right:12px;">
                ${isReminder ? "⏰ REMINDER" : "📄 QUOTATION"}
              </span>
              <span style="font-size:18px;font-weight:800;color:#f1f5f9;font-family:'Courier New',Courier,monospace;letter-spacing:1px;">${quotationNumber}</span>
              ${subject ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">${subject}</div>` : ""}
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="font-size:11px;color:#475569;">${fmtDate(createdAt)}</span>
            </td>
          </tr>
        </table>
      </div>

    </td>
  </tr>

  <!-- ══ INTRO LETTER ══ -->
  <tr>
    <td style="background:#ffffff;padding:28px 36px 24px;">

      <!-- To / From grid -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:20px;border-right:1px solid #f1f5f9;">
            <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">Bill To</div>
            ${customerCompanyName ? `<div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:3px;">${customerCompanyName}</div>` : ""}
            <div style="font-size:${customerCompanyName ? "13px" : "15px"};${customerCompanyName ? "color:#6b7280;" : "font-weight:700;color:#0f172a;"}margin-bottom:2px;">${customerName}</div>
            ${customerCity || customerState ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">📍 ${[customerCity, customerState].filter(Boolean).join(", ")}</div>` : ""}
            ${customerGstin ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;font-family:'Courier New',monospace;">GSTIN: ${customerGstin}</div>` : ""}
          </td>
          <td style="vertical-align:top;width:50%;padding-left:20px;">
            <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:10px;">Prepared By</div>
            <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:3px;">${companyName}</div>
            ${preparedByName ? `<div style="font-size:13px;color:#6b7280;margin-bottom:2px;">${preparedByName}${preparedByDesignation ? ` &mdash; ${preparedByDesignation}` : ""}</div>` : ""}
            ${preparedByPhone ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">📞 ${preparedByPhone}</div>` : ""}
            ${companyGstin ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;font-family:'Courier New',monospace;">GSTIN: ${companyGstin}</div>` : ""}
          </td>
        </tr>
      </table>

      <!-- Intro note -->
      <div style="background:#fafafa;border-left:3px solid #dc2626;border-radius:0 8px 8px 0;padding:16px 20px;">
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">Respected Sir / Ma'am,</div>
        <div style="font-size:13px;color:#4b5563;line-height:1.8;">
          ${
            introNote
              ? introNote
              : isReminder
              ? `This is a friendly reminder about quotation <strong>${quotationNumber}</strong>. It is still awaiting your review and acceptance. We look forward to your prompt response.`
              : `Thank you for your valued consideration of our company for your requirements. With respect to your inquiry, please find enclosed herewith our best proposal. We are committed to standing alongside you and your organization with our best support and services.`
          }
        </div>
      </div>
    </td>
  </tr>

  <!-- ══ PRODUCTS & SERVICES ══ -->
  <tr>
    <td style="background:#ffffff;padding:0 24px 0;">

      <!-- Section label -->
      <div style="padding:0 12px 12px;">
        <span style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#94a3b8;">Products &amp; Services</span>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <thead>
          <tr style="background:#0f172a;">
            <th style="padding:11px 16px;text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #1e293b;width:32px;">#</th>
            <th style="padding:11px 16px;text-align:left;font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #1e293b;">Description</th>
            <th style="padding:11px 16px;text-align:center;font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #1e293b;width:50px;">Qty</th>
            <th style="padding:11px 16px;text-align:right;font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #1e293b;width:100px;">Rate</th>
            <th style="padding:11px 16px;text-align:center;font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #1e293b;width:60px;">${taxLabel}</th>
            <th style="padding:11px 16px;text-align:right;font-size:9px;font-weight:700;letter-spacing:1px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #1e293b;width:100px;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </td>
  </tr>

  <!-- ══ TOTALS ══ -->
  <tr>
    <td style="background:#ffffff;padding:16px 24px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="width:55%;"></td>
          <td style="width:45%;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                   style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">

              <!-- Subtotal row -->
              <tr style="background:#f8fafc;">
                <td style="padding:10px 16px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">Subtotal</td>
                <td style="padding:10px 16px;font-size:13px;color:#374151;text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">₹${fmt(subtotal)}</td>
              </tr>

              ${
                totalDiscount && totalDiscount > 0
                  ? `<tr style="background:#f0fdf4;">
                       <td style="padding:10px 16px;font-size:13px;color:#16a34a;border-bottom:1px solid #dcfce7;">
                         <span style="display:inline-block;width:6px;height:6px;background:#16a34a;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>
                         Item Discounts
                       </td>
                       <td style="padding:10px 16px;font-size:13px;color:#16a34a;text-align:right;font-weight:700;border-bottom:1px solid #dcfce7;">−₹${fmt(totalDiscount)}</td>
                     </tr>`
                  : ""
              }

              ${
                extraDiscountLabel && extraDiscountValue
                  ? `<tr style="background:#f0fdf4;">
                       <td style="padding:10px 16px;font-size:13px;color:#16a34a;border-bottom:1px solid #dcfce7;">
                         ${extraDiscountLabel}
                         ${extraDiscountNote ? `<div style="font-size:11px;color:#86efac;">${extraDiscountNote}</div>` : ""}
                       </td>
                       <td style="padding:10px 16px;font-size:13px;color:#16a34a;text-align:right;font-weight:700;border-bottom:1px solid #dcfce7;">Applied</td>
                     </tr>`
                  : ""
              }

              <!-- Tax row -->
              <tr style="background:#f8fafc;">
                <td style="padding:10px 16px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;">${taxLabel}</td>
                <td style="padding:10px 16px;font-size:13px;color:#374151;text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">₹${fmt(taxAmount)}</td>
              </tr>

              <!-- Grand total dark row -->
              <tr style="background:#0f172a;">
                <td style="padding:14px 16px;">
                  <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#475569;">Grand Total</div>
                  <div style="font-size:10px;color:#334155;margin-top:2px;">${currency} · incl. all taxes</div>
                </td>
                <td style="padding:14px 16px;text-align:right;">
                  <div style="font-size:22px;font-weight:800;color:#ffffff;font-family:Georgia,serif;">₹${fmt(grandTotal)}</div>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ DELIVERY / PAYMENT / CUSTOM TERMS ══ -->
  ${extraSection}

  <!-- ══ FOOTER NOTE ══ -->
  ${
    footerNote
      ? `<tr>
           <td style="background:#fffbeb;border-top:2px solid #fde68a;padding:18px 36px;">
             <table cellpadding="0" cellspacing="0" role="presentation">
               <tr>
                 <td style="font-size:18px;padding-right:12px;vertical-align:top;color:#92400e;">💡</td>
                 <td>
                   <div style="font-size:10px;font-weight:700;color:#92400e;letter-spacing:1px;text-transform:uppercase;margin-bottom:5px;">Note</div>
                   <div style="font-size:13px;color:#78350f;line-height:1.7;">${footerNote}</div>
                 </td>
               </tr>
             </table>
           </td>
         </tr>`
      : ""
  }

  <!-- ══ CTA SECTION ══ -->
  <tr>
    <td style="background:#ffffff;padding:28px 36px 32px;text-align:center;border-top:1px solid #f1f5f9;">
      <div style="font-size:13px;color:#6b7280;margin-bottom:16px;line-height:1.6;">
        ${isReminder ? "Your quotation is still awaiting acceptance. Click below to review." : "Ready to proceed? Click below to view and accept this quotation."}
      </div>
      <a href="${quotationUrl}"
         style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;padding:14px 44px;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:0.4px;border:2px solid #b91c1c;">
        ${ctaText} &rarr;
      </a>
      <div style="margin-top:14px;font-size:11px;color:#94a3b8;">
        Or copy: <a href="${quotationUrl}" style="color:#dc2626;text-decoration:none;font-family:'Courier New',monospace;font-size:11px;word-break:break-all;">${quotationUrl}</a>
      </div>
    </td>
  </tr>

  <!-- ══ CONTACT HELP ══ -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="text-align:center;">
            <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.8;">
              Questions? Reply to this email or contact us directly<br/>
              📞 <strong style="color:#0f172a;">8141 703007</strong> &nbsp;/&nbsp; <strong style="color:#0f172a;">9484843007</strong>
              &nbsp;&nbsp;✉️ <a href="mailto:info@shivanshinfosys.com" style="color:#dc2626;text-decoration:none;font-weight:600;">info@shivanshinfosys.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ STANDARD T&C ══ -->
  ${buildTCSection()}

  <!-- ══ FOOTER ══ -->
  <tr>
    <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:24px 36px;text-align:center;">
      <div style="height:2px;background:linear-gradient(90deg,#dc2626 0%,#ef4444 50%,#fca5a5 100%);border-radius:2px;margin-bottom:18px;"></div>
      <div style="font-family:Georgia,serif;">
        <span style="font-size:18px;font-weight:800;color:#dc2626;letter-spacing:-0.3px;">SHIVANSH</span>
        <span style="font-size:18px;font-weight:800;color:#fca5a5;margin-left:4px;letter-spacing:-0.3px;">INFOSYS</span>
      </div>
      <div style="font-size:10px;color:#874c61;margin-top:3px;letter-spacing:0.5px;">Quick Response – Quick Support</div>
      <div style="margin-top:10px;font-size:11px;color:#471e2d;line-height:1.6;">
        214–215 Soham Arcade, Adajan, Surat 395009 &nbsp;·&nbsp; 105 Ajit Plaza, Vapi 396191
      </div>
      <div style="margin-top:12px;font-size:10px;color:#1e293b;">
        &copy; ${year} Shivansh Infosys. All rights reserved. &nbsp;·&nbsp;
        <a href="https://shivanshinfosys.in/privacy" style="color:#4f303b;text-decoration:none;">Privacy Policy</a>
        &nbsp;·&nbsp;
        <a href="https://shivanshinfosys.in/terms" style="color:#4f303b;text-decoration:none;">Terms of Service</a>
      </div>
    </td>
  </tr>

  <tr><td style="height:28px;"></td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

// ─── plain-text fallback ──────────────────────────────────────────────────────

export function quotationEmailText(data: QuotationEmailData): string {
  const {
    quotationNumber,
    quotationUrl,
    customerName,
    grandTotal,
    isReminder,
    paymentTerms,
    validUntil,
  } = data;

  const validLine = validUntil ? `\nValid Until: ${fmtDate(validUntil)}` : "";
  const paymentLine = paymentTerms ? `\nPayment Terms: ${paymentTerms}` : "";

  const tcText = `

────────────────────────────────────────────────────────
TERMS & CONDITIONS OF SALE — SHIVANSH INFOSYS
────────────────────────────────────────────────────────

SUPPORT TIMINGS
• Monday to Saturday, 10:00 AM – 6:00 PM (Lunch: 1:00–2:00 PM), excluding public holidays.
• Queries raised outside working hours will be addressed on the next working day.

DATA BACKUP & SECURITY
• Always take data backup as per your requirement. Tally does not backup to any server.
• Data backup is not our responsibility for new Tally Licenses or Tally TDLs.
• Maintaining a safe and updated backup is the customer's sole responsibility.
• Always test TDLs on backup data first before applying.

FOR NEW TALLY USERS
• We offer 1 year of free Tally Support AMC for new Tally users.
• A dedicated WhatsApp support group will be created for your queries.
• Queries raised outside working hours will be addressed on the next working day.

FOR TALLY RENEWAL CUSTOMERS
• Support is not free after Tally renewal. Purchase Tally AMC or opt for pay-per-call support.
• Queries raised outside working hours will be addressed on the next working day.

FOR TALLY TDL CUSTOMERS
• No renewal charges except for the Tally-to-WhatsApp module.
• 365-day (1-year) TCP files require renewal after expiry.
• Always test TDL on backup data first. 1-month free support included post-purchase.
• Confirm compatibility before updating to any new Tally Prime release.
• We are not responsible for mandatory TDL updates due to govt policy or Tally updates.
• If we cannot customize as required, we will refund your payment. No legal claims entertained.

FOR AMC CUSTOMERS
• AMC includes full Tally technical support via remote tools (AnyDesk, UltraViewer, etc.).
• AMC is valid for 12 months from the date of purchase.
• Queries raised outside working hours will be addressed on the next working day.

FOR CLOUD CUSTOMERS
• Cloud server takes daily backups. Still maintain your own local backup for safety.
• Data restoration may take minimum 1–2 days depending on the cloud provider.
• Set a User ID & Password on your Tally company to protect data privacy and security.

────────────────────────────────────────────────────────`;

  if (isReminder) {
    return `Dear ${customerName},\n\nThis is a friendly reminder about quotation ${quotationNumber} from Shivansh Infosys. It is still awaiting your review.\n\nGrand Total: ₹${fmt(grandTotal)}${validLine}\n\nView your quotation: ${quotationUrl}\n\n— Shivansh Infosys\n8141 703007 / 9484843007\ninfo@shivanshinfosys.com${tcText}`;
  }
  return `Dear ${customerName},\n\nThank you for your interest. Please find below our quotation ${quotationNumber} from Shivansh Infosys.\n\nGrand Total: ₹${fmt(grandTotal)}${validLine}${paymentLine}\n\nView & accept your quotation: ${quotationUrl}\n\n— Shivansh Infosys\n8141 703007 / 9484843007\ninfo@shivanshinfosys.com${tcText}`;
}