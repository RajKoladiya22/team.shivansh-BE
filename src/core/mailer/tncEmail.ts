// src/core/mailer/tncEmail.ts

export interface TncEmailData {
  customerName: string;
  customerCompanyName?: string | null;
  acceptUrl: string;
  tncVersion: string;
  quotationNumber?: string | null; // optional — if T&C is linked to a quotation
  quotationGrandTotal?: number | null;
  validUntil?: string | null;      // ISO date string
  expiresInDays?: number;          // link expiry (default 7)
  isReminder?: boolean;
  companyName?: string;
}

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

export function tncEmailHtml(data: TncEmailData): string {
  const {
    customerName,
    customerCompanyName,
    acceptUrl,
    tncVersion,
    quotationNumber,
    quotationGrandTotal,
    validUntil,
    expiresInDays = 7,
    isReminder = false,
    companyName = "Shivansh Infosys",
  } = data;

  const year = new Date().getFullYear();

  const quotationBlock =
    quotationNumber && quotationGrandTotal
      ? `<div style="background:#f8fafc;border-radius:10px;padding:20px 24px;margin:24px 0;border:1px solid #e2e8f0;">
           <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:12px;">
             Linked Quotation
           </div>
           <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
             <tr>
               <td style="font-size:13px;color:#6b7280;">Quotation No.</td>
               <td style="font-size:14px;font-weight:700;color:#111827;text-align:right;font-family:'Courier New',monospace;">${quotationNumber}</td>
             </tr>
             <tr>
               <td style="font-size:13px;color:#6b7280;padding-top:8px;">Grand Total</td>
               <td style="font-size:16px;font-weight:800;color:#dc2626;text-align:right;padding-top:8px;">₹${fmt(quotationGrandTotal)}</td>
             </tr>
             ${validUntil ? `<tr><td style="font-size:13px;color:#6b7280;padding-top:8px;">Valid Until</td><td style="font-size:13px;color:#374151;text-align:right;padding-top:8px;">${fmtDate(validUntil)}</td></tr>` : ""}
           </table>
         </div>`
      : "";

  const heroText = isReminder
    ? `This is a friendly reminder to review and accept our Terms &amp; Conditions. Your acceptance is required to proceed.`
    : `To complete our agreement and proceed with the services, kindly review and digitally accept our Terms &amp; Conditions by clicking the button below.`;

  const tncPoints = [
    "All software licenses are non-transferable and non-refundable.",
    "Support services are provided during business hours (Mon–Sat, 10AM–6PM IST).",
    "Payment is due within the agreed terms; delays may affect service continuity.",
    "Shivansh Infosys retains the right to update T&C with prior notice.",
    "Unauthorized use or redistribution of licensed software is strictly prohibited.",
    "Both parties agree to resolve disputes through mutual discussion before legal action.",
  ];

  const tncRows = tncPoints
    .map(
      (point, i) =>
        `<tr>
           <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;vertical-align:top;width:28px;">
             <div style="width:22px;height:22px;border-radius:50%;background:#fef2f2;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#dc2626;">${i + 1}</div>
           </td>
           <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#374151;line-height:1.6;">${point}</td>
         </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isReminder ? "Reminder: " : ""}Terms & Conditions Acceptance · Shivansh Infosys</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#374151;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f5f9;padding:28px 12px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;">

  <!-- ══ HEADER ══ -->
  <tr>
    <td style="background:linear-gradient(140deg,#0f172a 0%,#1e293b 100%);border-radius:16px 16px 0 0;padding:32px 36px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.3px;margin-bottom:6px;">
        <span style="color:#dc2626;">SHIVANSH</span>
        <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
      </div>
      <div style="font-size:10px;color:#64748b;letter-spacing:0.3px;margin-bottom:24px;">
        Authorized Tally Partner &nbsp;·&nbsp; Quick Response – Quick Support
      </div>

      <!-- Badge -->
      <div style="display:inline-block;background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.3);border-radius:20px;padding:6px 18px;margin-bottom:16px;">
        <span style="font-size:12px;font-weight:700;color:#fca5a5;letter-spacing:0.5px;">
          ${isReminder ? "⏰ REMINDER · " : ""}📋 TERMS &amp; CONDITIONS
        </span>
      </div>

      <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
        Digital Acceptance<br/>Required
      </div>
      <div style="font-size:13px;color:#64748b;margin-top:10px;">
        Version ${tncVersion} &nbsp;·&nbsp; Link valid for ${expiresInDays} days
      </div>
    </td>
  </tr>

  <!-- ══ GREETING ══ -->
  <tr>
    <td style="background:#ffffff;padding:32px 36px 0;">
      <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:8px;">
        Dear ${customerCompanyName ? `${customerCompanyName}` : customerName},
      </div>
      <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.75;">
        ${heroText}
      </p>
      ${quotationBlock}
    </td>
  </tr>

  <!-- ══ T&C SUMMARY ══ -->
  <tr>
    <td style="background:#ffffff;padding:24px 36px 0;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px;">
        Summary of Terms &amp; Conditions
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        ${tncRows}
      </table>
      <div style="margin-top:16px;padding:12px 16px;background:#fef2f2;border-radius:8px;font-size:12px;color:#7f1d1d;line-height:1.6;">
        📄 The full Terms &amp; Conditions document is available on our website at
        <a href="https://shivanshinfosys.in/terms" style="color:#dc2626;font-weight:600;text-decoration:none;">shivanshinfosys.in/terms</a>.
        By clicking the accept button below, you confirm that you have read and agree to all terms.
      </div>
    </td>
  </tr>

  <!-- ══ LEGAL NOTICE ══ -->
  <tr>
    <td style="background:#ffffff;padding:20px 36px 0;">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 20px;">
        <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px;">⚠️ Important Notice</div>
        <div style="font-size:12px;color:#78350f;line-height:1.7;">
          By clicking "Accept Terms &amp; Conditions", you are providing your digital signature confirming that you accept
          all terms on behalf of <strong>${customerCompanyName || customerName}</strong>.
          This acceptance is legally binding and will be recorded with a timestamp and your IP address.
        </div>
      </div>
    </td>
  </tr>

  <!-- ══ CTA ══ -->
  <tr>
    <td style="background:#ffffff;padding:32px 36px;text-align:center;">
      <a href="${acceptUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#ffffff;text-decoration:none;padding:16px 48px;border-radius:10px;font-weight:700;font-size:16px;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(220,38,38,0.3);">
        ✅ &nbsp;Accept Terms &amp; Conditions
      </a>

      <div style="margin-top:16px;font-size:12px;color:#94a3b8;line-height:1.6;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${acceptUrl}" style="color:#dc2626;text-decoration:none;word-break:break-all;font-size:11px;">${acceptUrl}</a>
      </div>

      <div style="margin-top:14px;padding:10px 16px;background:#f1f5f9;border-radius:8px;display:inline-block;font-size:11px;color:#6b7280;">
        🔒 This link expires in ${expiresInDays} days &nbsp;·&nbsp; One-time use per customer
      </div>
    </td>
  </tr>

  <!-- ══ CONTACT ══ -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
      <div style="font-size:12px;color:#6b7280;line-height:1.8;">
        Questions about our terms? Contact us:<br/>
        📞 <strong>8141 703007 &nbsp;/&nbsp; 9484843007</strong><br/>
        ✉️ <a href="mailto:info@shivanshinfosys.com" style="color:#dc2626;text-decoration:none;">info@shivanshinfosys.com</a>
        &nbsp;·&nbsp;
        <a href="https://shivanshinfosys.in" style="color:#dc2626;text-decoration:none;">shivanshinfosys.in</a>
      </div>
    </td>
  </tr>

  <!-- ══ FOOTER ══ -->
  <tr>
    <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center;">
      <div style="font-size:14px;font-weight:800;">
        <span style="color:#dc2626;">SHIVANSH</span>
        <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
      </div>
      <div style="font-size:10px;color:#475569;margin-top:4px;">
        214–215 Soham Arcade, Adajan, Surat 395009 &nbsp;·&nbsp; 105 Ajit Plaza, Vapi 396191
      </div>
      <div style="margin-top:10px;font-size:10px;color:#1e293b;">
        © ${year} ${companyName}. All rights reserved.
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

export function tncEmailText(data: TncEmailData): string {
  const { customerName, acceptUrl, tncVersion, quotationNumber, expiresInDays = 7 } = data;
  return `Dear ${customerName},

Please review and accept our Terms & Conditions (${tncVersion}) to proceed with our services.
${quotationNumber ? `\nLinked Quotation: ${quotationNumber}` : ""}

Click the link below to accept:
${acceptUrl}

This link expires in ${expiresInDays} days.

If you have any questions, contact us at:
info@shivanshinfosys.com | 8141 703007

— Shivansh Infosys`;
}