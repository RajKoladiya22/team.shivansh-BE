export const CUSTOMER_PORTAL_BASE =
  process.env.CUSTOMER_PORTAL_URL || "https://customer.shivanshinfosys.in";

export const TEAM_PORTAL_BASE =
  process.env.TEAM_PORTAL_URL || "https://team.shivanshinfosys.in";

export function getCustomerTrackingUrl(leadId: string): string {
  return `${CUSTOMER_PORTAL_BASE.replace(/\/$/, "")}/leads/${leadId}`;
}

export function getTeamMemberLeadUrl(leadId: string): string {
  return `${TEAM_PORTAL_BASE.replace(/\/$/, "")}/leads/user/${leadId}`;
}

export function getAdminLeadUrl(leadId: string): string {
  return `${TEAM_PORTAL_BASE.replace(/\/$/, "")}/leads/admin/${leadId}`;
}

export interface LeadCustomerTemplateVariables {
  customer_name?: string;
  product_title?: string;
  member_name?: string;
  member_phone?: string;
  // Legacy & campaign mapping aliases
  lead_id?: string;
  customer_url?: string;
  product_demo_url?: string;
  website_url?: string;
  team_member_name?: string;
  team_member_phone?: string;
  customer_tracking_url?: string;
}

export interface LeadTeamMemberTemplateVariables {
  lead_id?: string;
  team_member_name?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  product_title?: string;
  is_important?: boolean;
  remark?: string;
  team_member_url?: string;
  assigned_by_name?: string;
}

export interface LeadAdminPublicLeadTemplateVariables {
  source?: string;
  customer_name?: string;
  customer_phone?: string;
  product_title?: string;
  remark?: string;
  lead_id?: string;
}

export interface LeadAdminTemplateVariables {
  lead_id: string;
  customer_name: string;
  team_member_name: string;
  admin_url: string;
  status?: string;
}

/**
 * Builds the admin notification message for public inquiry leads adhering
 * strictly to Meta's Utility/Operational guidelines.
 */
export function renderAdminPublicLead(variables: LeadAdminPublicLeadTemplateVariables): string {
  const source = variables.source || "Website";
  const customerName = variables.customer_name || "Customer";
  const customerPhone = variables.customer_phone || "N/A";
  const productTitle = variables.product_title || "General Inquiry";
  const remark = variables.remark || "No additional remarks";
  const rawLeadId = variables.lead_id || "";
  const leadUrl = rawLeadId.startsWith("http") ? rawLeadId : (rawLeadId ? getAdminLeadUrl(rawLeadId) : "");

  const lines: string[] = [];
  lines.push(`New lead received from ${source}.`);
  lines.push("");
  lines.push("Customer Name:");
  lines.push(customerName.startsWith("*") ? customerName : `*${customerName}*`);
  lines.push("");
  lines.push("Mobile Number:");
  lines.push(customerPhone);
  lines.push("");
  lines.push("Product Details:");
  lines.push(productTitle.startsWith("*") ? productTitle : `*${productTitle}*`);
  lines.push("");
  lines.push("Lead Details:");
  lines.push(remark.startsWith("*") ? remark : `*${remark}*`);
  lines.push("");
  lines.push("Lead ID:");
  lines.push(leadUrl);
  lines.push("");
  lines.push("Please review the lead in CRM.");
  lines.push("Thank You.");

  return lines.join("\n");
}

/**
 * Builds the customer confirmation message adhering strictly to Meta's
 * Utility category guidelines (transactional, factual, non-promotional).
 */
export function renderCustomerConfirmation(variables: LeadCustomerTemplateVariables): string {
  const customerName = variables.customer_name || "Valued Customer";
  const memberName = variables.member_name || variables.team_member_name || "Mrs. Mehul Patel";
  const memberPhone = variables.member_phone || variables.team_member_phone || "8141703007";

  const lines: string[] = [];
  lines.push(`Hello ${customerName},`);
  lines.push("");
  lines.push("Thank you for contacting Shivansh Infosys.");
  lines.push("We have received your request successfully.");

  if (variables.product_title && variables.product_title.trim()) {
    lines.push("");
    lines.push("Request Details:");
    lines.push(`• Item: ${variables.product_title.trim()}`);
  }

  lines.push("");
  lines.push("Your request has been recorded and assigned to our team.");
  lines.push("");
  lines.push("Assigned Executive:");
  lines.push(memberName);
  lines.push(memberPhone);
  lines.push("");
  lines.push("Our team will contact you regarding your request.");
  lines.push("");
  lines.push("Regards,");
  lines.push("Shivansh Infosys");
  lines.push(variables.website_url?.trim() || "www.shivanshinfosys.in");

  return lines.join("\n");
}

/**
 * Builds the team member assignment message adhering strictly to Meta's
 * Utility/Operational guidelines (strictly factual and operational).
 */
export function renderTeamMemberAssignment(variables: LeadTeamMemberTemplateVariables): string {
  const teamMemberName = variables.team_member_name || "Team Member";
  const customerName = variables.customer_name || "Customer";
  const leadUrl = variables.team_member_url || getTeamMemberLeadUrl(variables.lead_id || "");

  const lines: string[] = [];
  lines.push("New customer request received.");
  lines.push(`*${teamMemberName}* to you.`);
  lines.push("");
  lines.push("Customer Name:");
  lines.push(customerName);

  if (variables.customer_phone && variables.customer_phone.trim()) {
    lines.push("");
    lines.push("Mobile Number:");
    lines.push(variables.customer_phone.trim());
  } else if (variables.customer_email && variables.customer_email.trim()) {
    lines.push("");
    lines.push("Email:");
    lines.push(variables.customer_email.trim());
  }

  if (variables.product_title && variables.product_title.trim()) {
    lines.push("");
    lines.push("Product Details:");
    lines.push(variables.product_title.trim());
  }

  if (variables.is_important) {
    lines.push("");
    lines.push("Call Priority:");
    lines.push("Urgent");
  }

  if (variables.remark && variables.remark.trim()) {
    lines.push("");
    lines.push("Lead Details:");
    lines.push(variables.remark.trim());
  }

  lines.push("");
  lines.push("Lead Link:");
  lines.push(leadUrl);
  lines.push("");
  lines.push("Please review the request and contact the customer accordingly.");
  lines.push("Thank You.");

  return lines.join("\n");
}

export const LEAD_TEMPLATES = {
  CUSTOMER_CONFIRMATION: `Hello {{customer_name}},

Thank you for contacting Shivansh Infosys.
We have received your request successfully.

Request Details:
• Item: {{product_title}}

Your request has been recorded and assigned to our team.

Assigned Executive:
{{member_name}}
{{member_phone}}

Our team will contact you regarding your request.

Regards,
Shivansh Infosys
www.shivanshinfosys.in`,

  TEAM_MEMBER_ASSIGNMENT: `New customer request received.
*{{team_member_name}}* to you.

Customer Name:
{{customer_name}}

Mobile Number:
{{customer_phone}}

Product Details:
{{product_title}}

Call Priority:
Urgent

Lead Details:
{{remark}}

Lead Link:
{{team_member_url}}

Please review the request and contact the customer accordingly.
Thank You.`,

  ADMIN_PUBLIC_LEAD: `New lead received from *{{source}}*.

Customer Name:
{{customer_name}}

Mobile Number:
{{customer_phone}}

Product Details:
{{product_title}}

Lead Details:
{{remark}}

Lead ID:
{{lead_id}}

Please review the lead in CRM.
Thank You.`,

  ADMIN_ASSIGNMENT: `*Lead Assignment Update*
Lead ID: {{lead_id}}
Customer: {{customer_name}}
Assigned To: {{team_member_name}}
View Lead: {{admin_url}}`,
};
