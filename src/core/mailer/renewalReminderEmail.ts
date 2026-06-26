// src/core/mailer/renewalReminderEmail.ts

export interface RenewalReminderData {
  customerName: string;
  customerCompanyName?: string;
  serviceType: string;
  expiryDate: string;
  daysRemaining: number;
  cost: number;
  supportPhone1?: string;
  supportPhone2?: string;
  supportEmail?: string;
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

export function generateRenewalReminderEmailHtml(data: RenewalReminderData): string {
  const {
    customerName,
    customerCompanyName,
    serviceType,
    expiryDate,
    daysRemaining,
    cost,
    supportPhone1 = "8141 703007",
    supportPhone2 = "9484843007",
    supportEmail = "info@shivanshinfosys.com",
  } = data;

  const isExpired = daysRemaining < 0;
  const daysText = isExpired
    ? `expired ${Math.abs(daysRemaining)} days ago`
    : `will expire in ${daysRemaining} days`;

  const urgencyColor = isExpired ? "#b91c1c" : daysRemaining <= 7 ? "#dc2626" : daysRemaining <= 15 ? "#ea580c" : "#0284c7";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Service Renewal Reminder</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;line-height:1.6;">

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:16px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.01);overflow:hidden;">

  <!-- ══ HEADER ══ -->
  <tr>
    <td style="background:#0f172a;padding:32px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td>
            <div style="font-family:Georgia,serif;margin-bottom:8px;">
              <span style="font-size:24px;font-weight:800;color:#f8fafc;letter-spacing:-0.5px;">SHIVANSH</span>
              <span style="font-size:24px;font-weight:800;color:#fca5a5;margin-left:4px;letter-spacing:-0.5px;">INFOSYS</span>
            </div>
          </td>
          <td align="right" style="vertical-align:bottom;">
            <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Reminder</div>
            <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Service Renewal</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ GREETING & INTRO ══ -->
  <tr>
    <td style="padding:40px 36px 12px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">
        Dear ${customerName},
      </h1>
      ${customerCompanyName ? `<div style="font-size:14px;color:#64748b;margin-bottom:20px;font-weight:500;">${customerCompanyName}</div>` : ""}
      
      <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
        This is a friendly reminder that your <strong>${serviceType}</strong> service <span style="color:${urgencyColor};font-weight:600;">${daysText}</span> on <strong>${fmtDate(expiryDate)}</strong>.
      </p>
    </td>
  </tr>

  <!-- ══ DETAILS BOX ══ -->
  <tr>
    <td style="padding:0 36px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:20px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding-bottom:12px;border-bottom:1px solid #e2e8f0;">
                  <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600;">Service</div>
                  <div style="font-size:16px;color:#0f172a;font-weight:500;">${serviceType}</div>
                </td>
                <td style="padding-bottom:12px;border-bottom:1px solid #e2e8f0;text-align:right;">
                  <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600;">Expiry Date</div>
                  <div style="font-size:16px;color:${urgencyColor};font-weight:600;">${fmtDate(expiryDate)}</div>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding-top:16px;text-align:center;">
                  <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600;">Renewal Cost (Est.)</div>
                  <div style="font-size:24px;color:#0f172a;font-weight:800;">₹${fmt(cost)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ CTA SECTION ══ -->
  <tr>
    <td style="background:#ffffff;padding:12px 36px 32px;text-align:center;">
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;">
        To ensure uninterrupted service, please arrange for renewal at your earliest convenience.
      </p>
    </td>
  </tr>

  <!-- ══ CONTACT HELP ══ -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="text-align:center;">
            <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.8;">
              Ready to renew or have questions? Contact us directly<br/>
              📞 <strong style="color:#0f172a;">${supportPhone1}</strong> &nbsp;/&nbsp; <strong style="color:#0f172a;">${supportPhone2}</strong><br/>
              ✉️ <a href="mailto:${supportEmail}" style="color:#dc2626;text-decoration:none;font-weight:600;">${supportEmail}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ FOOTER ══ -->
  <tr>
    <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:24px 36px;text-align:center;">
      <div style="height:2px;background:linear-gradient(90deg,#dc2626 0%,#ef4444 50%,#fca5a5 100%);border-radius:2px;margin-bottom:18px;"></div>
      <div style="font-family:Georgia,serif;">
        <span style="font-size:18px;font-weight:800;color:#910D20;letter-spacing:-0.3px;">SHIVANSH</span>
        <span style="font-size:18px;font-weight:800;color:#fca5a5;margin-left:4px;letter-spacing:-0.3px;">INFOSYS</span>
      </div>
      <div style="font-size:10px;color:#A4B8DB;margin-top:3px;letter-spacing:0.5px;">Quick Response – Quick Support</div>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

export function generateRenewalReminderEmailText(data: RenewalReminderData): string {
  const {
    customerName,
    serviceType,
    expiryDate,
    daysRemaining,
    cost,
    supportPhone1 = "8141 703007",
    supportPhone2 = "9484843007",
    supportEmail = "info@shivanshinfosys.com",
  } = data;

  const isExpired = daysRemaining < 0;
  const daysText = isExpired
    ? `expired ${Math.abs(daysRemaining)} days ago`
    : `will expire in ${daysRemaining} days`;

  return `Dear ${customerName},\n\nThis is a friendly reminder that your ${serviceType} service ${daysText} on ${fmtDate(expiryDate)}.\n\nRenewal Cost (Est.): ₹${fmt(cost)}\n\nTo ensure uninterrupted service, please arrange for renewal at your earliest convenience.\n\nReady to renew or have questions? Contact us directly:\n📞 ${supportPhone1} / ${supportPhone2}\n✉️ ${supportEmail}\n\n— Shivansh Infosys`;
}
