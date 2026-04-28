// src/core/mailer/tncEmail.ts

export interface TncEmailData {
  customerName: string;
  customerCompanyName?: string | null;
  acceptUrl: string;
  tncVersion: string;
  quotationNumber?: string | null;
  quotationGrandTotal?: number | null;
  validUntil?: string | null;
  expiresInDays?: number;
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
  const displayName = customerCompanyName || customerName;

  const quotationBlock =
    quotationNumber && quotationGrandTotal
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="quotation-block" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin:24px 0;">
          <tr>
            <td style="padding:20px 24px;">
              <div class="label-text" style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px;">📎 Linked Quotation</div>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td class="muted-text" style="font-size:13px;color:#6b7280;padding:4px 0;">Quotation No.</td>
                  <td style="font-size:13px;font-weight:700;color:#111827;text-align:right;font-family:'Courier New',Courier,monospace;" class="mono-val">${quotationNumber}</td>
                </tr>
                <tr>
                  <td class="muted-text" style="font-size:13px;color:#6b7280;padding:4px 0;">Grand Total</td>
                  <td style="font-size:17px;font-weight:800;color:#dc2626;text-align:right;" class="price-val">₹${fmt(quotationGrandTotal)}</td>
                </tr>
                ${validUntil ? `
                <tr>
                  <td class="muted-text" style="font-size:13px;color:#6b7280;padding:4px 0;">Valid Until</td>
                  <td class="mono-val" style="font-size:13px;color:#374151;text-align:right;font-family:'Courier New',Courier,monospace;">${fmtDate(validUntil)}</td>
                </tr>` : ""}
              </table>
            </td>
          </tr>
        </table>`
      : "";

  const tncSections = [
    {
      num: "1",
      title: "Scope of Responsibility",
      body: `We are committed to providing professional support and acting as a dedicated bridge for communication between the <strong>Product Manufacturer/Provider</strong> and the <strong>End User</strong>. Our responsibility is limited to:`,
      bullets: [
        "Timely technical support for installation and configuration.",
        "Facilitating communication for updates or service issues.",
        "Assisting in the resolution of operational queries.",
      ],
    },
    {
      num: "2",
      title: `"Try Before You Buy" Policy`,
      body: `To ensure complete satisfaction, we strongly recommend that all users thoroughly evaluate and understand the features of <strong>Cloud Services, Tally Products, and TDL Customizations</strong> before making a purchase.`,
      bullets: [
        "It is the user's responsibility to verify that the product meets their specific business requirements.",
        "By completing a purchase, the user acknowledges they have reviewed and accepted the product's functionality.",
      ],
    },
    {
      num: "3",
      title: "Limitation of Liability",
      body: `While we strive for excellence in support, the following limitations apply:`,
      subPoints: [
        {
          label: "Product Performance",
          text: "We do not manufacture the core software (Tally/Cloud infrastructure). Any inherent bugs or service outages from the principal provider are beyond our legal control.",
        },
        {
          label: "Legal Indemnity",
          text: "We are <strong>not liable</strong> for any legal actions against us for any data loss, or indirect damages arising from the use of these products after purchase.",
        },
        {
          label: "Maximum Liability",
          text: "In the event of a critical product failure where a resolution cannot be reached, our liability is strictly limited to a <strong>refund of the purchase amount</strong> (subject to the refund eligibility period), and no further claims will be entertained.",
        },
      ],
    },
  ];

  const buildBullets = (bullets: string[]) =>
    bullets
      .map(
        (b) => `
        <tr>
          <td style="width:20px;vertical-align:top;padding:5px 10px 5px 0;">
            <div style="width:6px;height:6px;border-radius:50%;background:#dc2626;margin-top:6px;"></div>
          </td>
          <td class="body-text" style="font-size:13px;color:#4b5563;line-height:1.7;padding:5px 0;">${b}</td>
        </tr>`
      )
      .join("");

  const buildSubPoints = (
    points: { label: string; text: string }[]
  ) =>
    points
      .map(
        (p) => `
        <tr>
          <td style="width:20px;vertical-align:top;padding:6px 10px 6px 0;">
            <div style="width:6px;height:6px;border-radius:50%;background:#dc2626;margin-top:6px;"></div>
          </td>
          <td class="body-text" style="font-size:13px;color:#4b5563;line-height:1.7;padding:6px 0;">
            <span class="strong-label" style="font-weight:700;color:#111827;">${p.label}:</span>&nbsp;${p.text}
          </td>
        </tr>`
      )
      .join("");

  const sectionsHtml = tncSections
    .map(
      (s) => `
      <!-- Section ${s.num} -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="section-card" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:12px;">
        <tr>
          <td style="padding:20px 22px;">
            <!-- Section header -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="width:32px;vertical-align:top;">
                  <div style="width:28px;height:28px;border-radius:8px;background:#fef2f2;display:inline-block;text-align:center;line-height:28px;font-size:13px;font-weight:800;color:#dc2626;">${s.num}</div>
                </td>
                <td style="padding-left:10px;vertical-align:middle;">
                  <div class="section-title" style="font-size:14px;font-weight:700;color:#111827;">${s.title}</div>
                </td>
              </tr>
            </table>
            <!-- Divider -->
            <div class="section-divider" style="height:1px;background:#f3f4f6;margin:14px 0 12px;"></div>
            <!-- Body text -->
            <p class="body-text" style="font-size:13px;color:#4b5563;line-height:1.7;margin:0 0 10px;">${s.body}</p>
            ${
              s.bullets
                ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding-left:4px;">${buildBullets(s.bullets)}</table>`
                : ""
            }
            ${
              s.subPoints
                ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding-left:4px;">${buildSubPoints(s.subPoints)}</table>`
                : ""
            }
          </td>
        </tr>
      </table>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${isReminder ? "Reminder: " : ""}Terms &amp; Conditions · ${companyName}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* ── Reset ── */
    * { box-sizing: border-box; }
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; }

    /* ── Base light styles ── */
    body { background-color: #f1f5f9; }
    .email-wrapper { background-color: #f1f5f9; }
    .email-body { background-color: #ffffff; }
    .card-bg { background-color: #f8fafc !important; }
    .section-card { background-color: #ffffff !important; border-color: #e5e7eb !important; }
    .section-divider { background: #f3f4f6 !important; }
    .section-title { color: #111827 !important; }
    .body-text { color: #4b5563 !important; }
    .muted-text { color: #6b7280 !important; }
    .strong-label { color: #111827 !important; }
    .mono-val { color: #111827 !important; }
    .footer-bg { background-color: #0f172a !important; }
    .contact-bg { background-color: #f8fafc !important; }
    .warning-bg { background-color: #fffbeb !important; }
    .warning-text { color: #78350f !important; }
    .warning-title { color: #92400e !important; }
    .legal-note { background-color: #fef2f2 !important; color: #7f1d1d !important; }
    .link-url { color: #dc2626 !important; }
    .copy-box { background-color: #f1f5f9 !important; color: #6b7280 !important; }
    .quotation-block { background-color: #f8fafc !important; border-color: #e2e8f0 !important; }

    /* ── Responsive ── */
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .stack-col { display: block !important; width: 100% !important; }
      .mob-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .mob-pad-sm { padding-left: 16px !important; padding-right: 16px !important; }
      .hero-title { font-size: 22px !important; }
      .cta-btn { padding: 14px 28px !important; font-size: 15px !important; }
      .section-card { border-radius: 8px !important; }
    }

    /* ── Dark mode ── */
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper { background-color: #0f172a !important; }
      .email-body { background-color: #1e293b !important; }
      .card-bg { background-color: #0f172a !important; }
      .section-card {
        background-color: #1e293b !important;
        border-color: #334155 !important;
      }
      .section-divider { background: #334155 !important; }
      .section-title { color: #f1f5f9 !important; }
      .body-text { color: #94a3b8 !important; }
      .muted-text { color: #64748b !important; }
      .strong-label { color: #e2e8f0 !important; }
      .mono-val { color: #e2e8f0 !important; }
      .contact-bg { background-color: #0f172a !important; border-color: #1e293b !important; }
      .warning-bg { background-color: #1c1a09 !important; }
      .warning-text { color: #fde68a !important; }
      .warning-title { color: #fbbf24 !important; }
      .legal-note { background-color: #1f0a0a !important; color: #fca5a5 !important; }
      .link-url { color: #f87171 !important; }
      .copy-box { background-color: #0f172a !important; color: #64748b !important; }
      .quotation-block { background-color: #0f172a !important; border-color: #334155 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">

<!-- Outer wrapper -->
<table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:28px 12px;">
<tr><td align="center">

<!-- Container -->
<table class="email-container" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:620px;">

  <!-- ══ HEADER ══════════════════════════════════════════════════════════ -->
  <tr>
    <td style="background:linear-gradient(140deg,#0f172a 0%,#1e293b 100%);border-radius:16px 16px 0 0;padding:36px 40px 30px;text-align:center;" class="mob-pad">
      <!-- Logo -->
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.3px;margin-bottom:4px;">
        <span style="color:#dc2626;">SHIVANSH</span>
        <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
      </div>
      <div style="font-size:10px;color:#64748b;letter-spacing:0.4px;margin-bottom:28px;">
        Authorized Tally Partner &nbsp;·&nbsp; Quick Response – Quick Support
      </div>
      <!-- Badge -->
      <div style="display:inline-block;background:rgba(220,38,38,0.18);border:1px solid rgba(220,38,38,0.35);border-radius:20px;padding:5px 16px;margin-bottom:18px;">
        <span style="font-size:11px;font-weight:700;color:#fca5a5;letter-spacing:0.5px;">
          ${isReminder ? "⏰ REMINDER &nbsp;·&nbsp; " : ""}📋 TERMS &amp; CONDITIONS
        </span>
      </div>
      <!-- Hero -->
      <div class="hero-title" style="font-size:26px;font-weight:800;color:#FFF7CD;letter-spacing:-0.4px;line-height:1.25;">
        Digital Acceptance<br/>Required
      </div>
      <div style="font-size:12px;color:#475569;margin-top:10px;">
        Version&nbsp;<strong style="color:#94a3b8;">${tncVersion}</strong>
        &nbsp;·&nbsp;
        Link valid for&nbsp;<strong style="color:#94a3b8;">${expiresInDays}&nbsp;days</strong>
      </div>
    </td>
  </tr>

  <!-- ══ GREETING ════════════════════════════════════════════════════════ -->
  <tr>
    <td class="email-body mob-pad" style="background-color:#ffffff;padding:32px 40px 24px;">
      <p style="font-size:15px;font-weight:600;color:#111827;margin:0 0 10px;" class="section-title">
        Dear ${displayName},
      </p>
      <p class="body-text" style="font-size:14px;color:#4b5563;line-height:1.8;margin:0;">
        ${
          isReminder
            ? `This is a friendly reminder to review and accept our <strong>Terms &amp; Conditions</strong>. Your acceptance is required to proceed with our services.`
            : `To complete our agreement and proceed with the services, kindly review and digitally accept our <strong>Terms &amp; Conditions</strong> by clicking the button below.`
        }
      </p>
      ${quotationBlock}
    </td>
  </tr>

  <!-- ══ T&C SECTIONS ═════════════════════════════════════════════════════ -->
  <tr>
    <td class="email-body mob-pad" style="background-color:#ffffff;padding:0 40px 8px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">
        Terms &amp; Conditions Summary
      </div>
      ${sectionsHtml}
    </td>
  </tr>

  <!-- ══ LEGAL NOTE ════════════════════════════════════════════════════════ -->
  <tr>
    <td class="email-body mob-pad" style="background-color:#ffffff;padding:8px 40px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="legal-note" style="background:#fef2f2;border-radius:8px;">
        <tr>
          <td style="padding:14px 18px;">
            <p class="legal-note" style="font-size:12px;color:#7f1d1d;line-height:1.7;margin:0;">
              📄 The full Terms &amp; Conditions document is available at
              <a href="https://shivanshinfosys.in/terms" class="link-url" style="color:#dc2626;font-weight:600;text-decoration:none;">shivanshinfosys.in/terms</a>.
              By clicking the accept button below, you confirm you have read and agree to all terms.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ IMPORTANT NOTICE ══════════════════════════════════════════════════ -->
  <tr>
    <td class="email-body mob-pad" style="background-color:#ffffff;padding:0 40px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="warning-bg" style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;">
        <tr>
          <td style="padding:16px 20px;">
            <div class="warning-title" style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px;">⚠️ Important Notice</div>
            <p class="warning-text" style="font-size:12px;color:#78350f;line-height:1.7;margin:0;">
              By clicking "Accept Terms &amp; Conditions", you are providing your <strong>digital signature</strong> confirming that you accept all terms on behalf of <strong>${displayName}</strong>.
              This acceptance is legally binding and will be recorded with a timestamp.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ CTA ════════════════════════════════════════════════════════════════ -->
  <tr>
    <td class="email-body mob-pad" style="background-color:#ffffff;padding:0 40px 36px;text-align:center;">
      <!-- Button -->
      <a href="${acceptUrl}" class="cta-btn"
         style="display:inline-block;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#ffffff !important;text-decoration:none;padding:16px 44px;border-radius:10px;font-weight:700;font-size:16px;letter-spacing:0.3px;box-shadow:0 4px 16px rgba(220,38,38,0.35);mso-padding-alt:0;text-align:center;">
        <!--[if mso]><i style="letter-spacing:44px;mso-font-width:-100%;mso-text-raise:30pt;">&nbsp;</i><![endif]-->
        ✅ &nbsp;Accept Terms &amp; Conditions
        <!--[if mso]><i style="letter-spacing:44px;mso-font-width:-100%;">&nbsp;</i><![endif]-->
      </a>

      <!-- Fallback URL -->
      <p class="muted-text" style="margin:18px 0 12px;font-size:12px;color:#94a3b8;line-height:1.6;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="copy-box" style="background:#f1f5f9;border-radius:6px;">
        <tr>
          <td style="padding:10px 14px;">
            <a href="${acceptUrl}" class="link-url" style="font-size:11px;color:#dc2626;text-decoration:none;word-break:break-all;font-family:'Courier New',Courier,monospace;">${acceptUrl}</a>
          </td>
        </tr>
      </table>

      <!-- Expiry pill -->
      <p class="muted-text" style="margin:16px 0 0;font-size:11px;color:#6b7280;">
        🔒 This link expires in ${expiresInDays} days &nbsp;·&nbsp; One-time use only
      </p>
    </td>
  </tr>

  <!-- ══ CONTACT ════════════════════════════════════════════════════════════ -->
  <tr>
    <td class="contact-bg mob-pad" style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:22px 40px;text-align:center;">
      <p class="muted-text" style="font-size:12px;color:#6b7280;line-height:2;margin:0;">
        Questions about our terms?<br/>
        📞 <strong style="color:#374151;">8141 703007</strong>
        &nbsp;/&nbsp;
        <strong style="color:#374151;">9484843007</strong><br/>
        ✉️ <a href="mailto:info@shivanshinfosys.com" class="link-url" style="color:#dc2626;text-decoration:none;">info@shivanshinfosys.com</a>
        &nbsp;·&nbsp;
        <a href="https://shivanshinfosys.in" class="link-url" style="color:#dc2626;text-decoration:none;">shivanshinfosys.in</a>
      </p>
    </td>
  </tr>

  <!-- ══ FOOTER ═════════════════════════════════════════════════════════════ -->
  <tr>
    <td class="footer-bg mob-pad" style="background-color:#0f172a;border-radius:0 0 16px 16px;padding:22px 40px;text-align:center;">
      <div style="font-size:15px;font-weight:800;margin-bottom:6px;">
        <span style="color:#dc2626;">SHIVANSH</span>
        <span style="color:#fca5a5;margin-left:3px;">INFOSYS</span>
      </div>
      <p style="font-size:10px;color:#E36A6A;margin:0 0 8px;line-height:1.6;">
        214–215 Soham Arcade, Adajan, Surat 395009
        &nbsp;·&nbsp;
        105 Ajit Plaza, Vapi 396191
      </p>
      <p style="font-size:10px;color:#FFB2B2;margin:0;">
        © ${year} ${companyName}. All rights reserved.
      </p>
    </td>
  </tr>

  <!-- Bottom spacer -->
  <tr><td style="height:28px;"></td></tr>

</table><!-- /container -->
</td></tr>
</table><!-- /wrapper -->

</body>
</html>`;
}

export function tncEmailText(data: TncEmailData): string {
  const {
    customerName,
    customerCompanyName,
    acceptUrl,
    tncVersion,
    quotationNumber,
    quotationGrandTotal,
    expiresInDays = 7,
    isReminder = false,
  } = data;

  const displayName = customerCompanyName || customerName;

  return `${isReminder ? "REMINDER: " : ""}Terms & Conditions Acceptance Required
${companyName()} · Version ${tncVersion}
${"─".repeat(55)}

Dear ${displayName},

${
  isReminder
    ? "This is a friendly reminder to review and accept our Terms & Conditions. Your acceptance is required to proceed."
    : "To complete our agreement and proceed with the services, kindly review and accept our Terms & Conditions."
}
${
  quotationNumber && quotationGrandTotal
    ? `\nLinked Quotation : ${quotationNumber}\nGrand Total      : ₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(quotationGrandTotal)}\n`
    : ""
}
TERMS & CONDITIONS SUMMARY
${"─".repeat(55)}

1. Scope of Responsibility
   We act as a bridge between the Product Manufacturer/Provider and the
   End User. Our responsibility covers timely technical support, facilitating
   communication for updates, and assisting with operational queries.

2. "Try Before You Buy" Policy
   We recommend evaluating all Cloud Services, Tally Products, and TDL
   Customizations before purchase. Completing a purchase confirms you have
   reviewed and accepted the product's functionality.

3. Limitation of Liability
   • Product Performance: We are not liable for inherent bugs or outages
     from the principal provider.
   • Legal Indemnity: We are not liable for data loss or indirect damages
     arising from use of these products after purchase.
   • Maximum Liability: In the event of a critical failure, our liability
     is limited strictly to a refund of the purchase amount.

${"─".repeat(55)}
ACCEPT YOUR TERMS & CONDITIONS
${"─".repeat(55)}

Click the link below to accept (one-time use, expires in ${expiresInDays} days):

  ${acceptUrl}

By accepting, you confirm you have read and agree to all terms on behalf
of ${displayName}. This is legally binding and will be timestamped.

Full T&C: https://shivanshinfosys.in/terms

${"─".repeat(55)}
Questions? Contact us:
  📞 8141 703007 / 9484843007
  ✉  info@shivanshinfosys.com
  🌐 https://shivanshinfosys.in

— Shivansh Infosys
214–215 Soham Arcade, Adajan, Surat 395009`;

  function companyName() {
    return data.companyName ?? "Shivansh Infosys";
  }
}