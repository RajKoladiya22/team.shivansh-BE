import { normalizePhoneNumber, isValidPhoneNumber } from "../utils/phone.util";
import { TemplateEngine } from "../templates/template.engine";
import { idempotencyCache } from "../utils/idempotency.util";
import { executeWithRetry } from "../utils/retry.util";
import {
  LEAD_TEMPLATES,
  getCustomerTrackingUrl,
  getTeamMemberLeadUrl,
  getAdminLeadUrl,
  renderCustomerConfirmation,
  renderTeamMemberAssignment,
  renderAdminPublicLead,
} from "../templates/lead.templates";
import {
  getPublicQuotationUrl,
  renderQuotationSent,
  renderQuotationReminder,
  buildQuotationSummary,
  formatCurrency,
  formatQuotationDate,
  QUOTATION_TEMPLATES,
} from "../templates/quotation.templates";
import { MockProvider } from "../providers/mock.provider";
import { OnbitsProvider, sanitizeTemplateParam } from "../providers/onbits.provider";
import { getNotificationProvider, setNotificationProvider } from "../providers/provider.factory";

async function runTests() {
  console.log("🚀 Starting Notification System Unit Tests...\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Phone Normalization Tests
  console.log("1. Phone Number Normalization & Validation:");
  assert(normalizePhoneNumber("9876543210") === "919876543210", "Converts 10-digit to 91 prefix");
  assert(normalizePhoneNumber("09876543210") === "919876543210", "Strips leading 0 and adds 91 prefix");
  assert(normalizePhoneNumber("+91 98765 43210") === "919876543210", "Strips spaces and + symbol");
  assert(normalizePhoneNumber("+91-98765-43210") === "919876543210", "Strips hyphens and + symbol");
  assert(normalizePhoneNumber("919876543210") === "919876543210", "Preserves existing 91 prefix");
  assert(normalizePhoneNumber("+1 (415) 555-2671") === "14155552671", "Formats international US numbers");
  assert(normalizePhoneNumber("123") === null, "Rejects short invalid numbers");
  assert(normalizePhoneNumber("") === null, "Rejects empty phone number");
  assert(isValidPhoneNumber("9876543210") === true, "Validates 10-digit number");
  assert(isValidPhoneNumber("invalid") === false, "Rejects alphabetic strings");

  // 2. Template Engine Tests
  console.log("\n2. Dynamic Template Engine:");
  const template = "Hello {{name}}, your lead ID is {{lead_id}}!";
  const rendered = TemplateEngine.render(template, { name: "Raj", lead_id: "LD-101" });
  assert(rendered === "Hello Raj, your lead ID is LD-101!", "Renders variable interpolation correctly");

  const fallbackRender = TemplateEngine.render("Lead: {{lead_id}}, Assignee: {{assignee}}", { lead_id: "LD-102" }, { fallbackValue: "N/A" });
  assert(fallbackRender === "Lead: LD-102, Assignee: N/A", "Handles missing variables with fallback values");

  const extracted = TemplateEngine.extractVariables(template);
  assert(extracted.includes("name") && extracted.includes("lead_id") && extracted.length === 2, "Extracts all template variables");

  const validation = TemplateEngine.validateVariables(template, { name: "Raj" });
  assert(validation.valid === false && validation.missing.includes("lead_id"), "Detects missing required variables");

  // 3. Lead Templates & URL Builders
  console.log("\n3. Lead URL Builders & Template Output:");
  assert(getCustomerTrackingUrl("test-uuid-1").includes("/leads/test-uuid-1"), "Generates valid customer tracking URL");
  assert(getTeamMemberLeadUrl("test-uuid-1").includes("/leads/user/test-uuid-1"), "Generates valid team member direct URL");
  assert(getAdminLeadUrl("test-uuid-1").includes("/leads/admin/test-uuid-1"), "Generates valid admin direct URL");

  const customerMsg = renderCustomerConfirmation({
    customer_name: "Mehul Patel",
    product_title: "Tally On Cloud",
    member_name: "Mr. Mehul Patel",
    member_phone: "8141703007",
    website_url: "www.shivanshinfosys.in",
  });
  assert(customerMsg.includes("Hello Mehul Patel,") && customerMsg.includes("Thank you for contacting Shivansh Infosys.") && customerMsg.includes("• Item: Tally On Cloud") && customerMsg.includes("Assigned Executive:") && customerMsg.includes("Mr. Mehul Patel") && customerMsg.includes("Shivansh Infosys\nwww.shivanshinfosys.in"), "Renders utility-compliant customer confirmation with website URL without label");

  const customerMsgNoItem = renderCustomerConfirmation({
    customer_name: "Mehul Patel",
    member_name: "Mr. Mehul Patel",
    member_phone: "8141703007",
  });
  assert(customerMsgNoItem.includes("Hello Mehul Patel,") && !customerMsgNoItem.includes("Request Details:"), "Renders clean customer confirmation without item section when item is omitted");

  const teamMsg = renderTeamMemberAssignment({
    lead_id: "lead-1234",
    team_member_name: "Hinal Patel",
    customer_name: "Mehul Patel",
    customer_phone: "8141703007",
    product_title: "GST Reconciliation Demo",
    is_important: true,
    remark: "Interested in full TallyPrime license and cloud setup",
    team_member_url: getTeamMemberLeadUrl("lead-1234"),
  });
  assert(teamMsg.startsWith("New customer request received.\n*Hinal Patel* to you.") && teamMsg.includes("Customer Name:") && teamMsg.includes("Mehul Patel") && teamMsg.includes("Call Priority:") && teamMsg.includes("Urgent") && teamMsg.includes("Lead Details:") && teamMsg.includes("/leads/user/lead-1234"), "Renders complete operational team member assignment message with updated header phrasing");

  const teamMsgEmailOnly = renderTeamMemberAssignment({
    lead_id: "lead-5678",
    team_member_name: "Hinal Patel",
    customer_name: "John Doe",
    customer_email: "john@example.com",
    product_title: "Tally on Cloud",
  });
  assert(teamMsgEmailOnly.includes("Email:") && teamMsgEmailOnly.includes("john@example.com") && !teamMsgEmailOnly.includes("Call Priority:"), "Renders fallback customer email when phone is unavailable");

  const adminPublicMsg = renderAdminPublicLead({
    source: "Website",
    customer_name: "Mehul Patel",
    customer_phone: "9909944044",
    product_title: "Tally on Cloud",
    remark: "Needs quick quote",
    lead_id: "lead-abc-123",
  });
  assert(adminPublicMsg.startsWith("New lead received from Website.") && adminPublicMsg.includes("Customer Name:\n*Mehul Patel*") && adminPublicMsg.includes("Product Details:\n*Tally on Cloud*") && adminPublicMsg.includes("Lead ID:\nhttps://team.shivanshinfosys.in/leads/admin/lead-abc-123") && adminPublicMsg.includes("Thank You."), "Renders Meta-compliant admin public lead notification with full admin URL");

  // 4. Idempotency & Deduplication
  console.log("\n4. Idempotency & Deduplication Cache:");
  const dedupeKey = "test:lead:100:phone";
  assert(idempotencyCache.acquire(dedupeKey, 5000) === true, "Acquires lock on first attempt");
  assert(idempotencyCache.acquire(dedupeKey, 5000) === false, "Rejects duplicate acquisition while active");
  idempotencyCache.release(dedupeKey);
  assert(idempotencyCache.acquire(dedupeKey, 5000) === true, "Re-acquires lock after explicit release");

  // 5. Retry Mechanism Tests
  console.log("\n5. Retry Mechanism with Exponential Backoff:");
  let attempts = 0;
  try {
    await executeWithRetry(
      async (att) => {
        attempts = att;
        if (att < 3) {
          const err: any = new Error("Network timeout");
          err.code = "ETIMEDOUT";
          throw err;
        }
        return "Success";
      },
      { maxRetries: 3, initialDelayMs: 20, backoffFactor: 1.5 }
    );
    assert(attempts === 3, "Retries transient network errors up to maxRetries");
  } catch {
    assert(false, "Retry should have succeeded on attempt 3");
  }

  // Permanent failure should not retry
  let permAttempts = 0;
  try {
    await executeWithRetry(
      async (att) => {
        permAttempts = att;
        const err: any = new Error("Bad Request");
        err.response = { status: 400 };
        throw err;
      },
      { maxRetries: 3, initialDelayMs: 20 }
    );
  } catch {
    assert(permAttempts === 1, "Permanent 400 error fails immediately without retrying");
  }

  // 6. Mock Provider & Dispatch
  console.log("\n6. Provider Factory & Mock Provider Execution:");
  const mock = new MockProvider();
  setNotificationProvider(mock);
  const provider = getNotificationProvider();
  assert(provider.name === "MOCK", "Provider factory returns configured mock provider");

  const sendResult = await provider.sendMessage({
    to: "+91 98765 43210",
    message: "Test WhatsApp message",
    templateName: "test_template",
  });
  assert(sendResult.success === true, "Mock provider successfully dispatches message");
  assert(mock.sentMessages.length === 1, "Mock provider tracks dispatched message history");
  assert(mock.sentMessages[0].to === "919876543210", "Dispatches with normalized phone number");

  // 7. Quotation Templates, Formatting & WhatsApp Sending Tests
  console.log("\n7. Quotation Templates, URL Builders & Dispatch:");
  assert(getPublicQuotationUrl("qt-test-99").includes("/quotation/qt-test-99"), "Generates valid public quotation URL");
  assert(formatCurrency(25000) === "25,000.00", "Formats integer amount to currency string");
  assert(formatCurrency("18999.5") === "18,999.50", "Formats decimal amount correctly");
  assert(formatCurrency(null) === "0.00", "Handles null currency fallback");

  const singleItemSummary = buildQuotationSummary([{ name: "TallyPrime Gold", qty: 1 }]);
  assert(singleItemSummary === "TallyPrime Gold (Qty: 1)", "Builds summary for single line item");

  const multiItemSummary = buildQuotationSummary([
    { name: "TallyPrime Gold", qty: 1 },
    { name: "Cloud Server", qty: 1 },
    { name: "Annual Support", qty: 1 },
    { name: "Implementation", qty: 1 },
  ]);
  assert(multiItemSummary.includes("TallyPrime Gold (Qty: 1)") && multiItemSummary.includes("and 1 more item(s)"), "Truncates line items beyond 3 and adds remainder count");

  const fallbackSummary = buildQuotationSummary([], "Custom Software Development Proposal");
  assert(fallbackSummary === "Custom Software Development Proposal", "Falls back to quotation subject when line items are empty");

  const quoteMsg = renderQuotationSent({
    customer_name: "Amit Shah",
    quotation_number: "QT-2026-08-0042",
    grand_total: "25,000.00",
    quotation_summary: "TallyPrime Gold (Qty: 1)",
    valid_until: "31 Aug 2026",
    quotation_url: getPublicQuotationUrl("qt-uuid-42"),
    prepared_by_name: "Mehul Patel",
    prepared_by_phone: "8141703007",
  });
  assert(
    quoteMsg.includes("Hello Amit Shah,") &&
    quoteMsg.includes("Your quotation *#QT-2026-08-0042* is ready.") &&
    quoteMsg.includes("• Total Amount: ₹25,000.00") &&
    quoteMsg.includes("• Valid Until: 31 Aug 2026") &&
    quoteMsg.includes("/quotation/qt-uuid-42") &&
    quoteMsg.includes("Mehul Patel") &&
    quoteMsg.includes("8141703007") &&
    quoteMsg.includes("Shivansh Infosys\nwww.shivanshinfosys.in"),
    "Renders Meta-compliant quotation dispatch message with all dynamic fields"
  );

  const reminderMsg = renderQuotationReminder({
    customer_name: "Amit Shah",
    quotation_number: "QT-2026-08-0042",
    grand_total: "25,000.00",
    quotation_summary: "TallyPrime Gold (Qty: 1)",
    valid_until: "31 Aug 2026",
    quotation_url: getPublicQuotationUrl("qt-uuid-42"),
    prepared_by_name: "Mehul Patel",
    prepared_by_phone: "8141703007",
  });
  assert(
    reminderMsg.includes("Hello Amit Shah,") &&
    reminderMsg.includes("This is a gentle reminder regarding quotation *#QT-2026-08-0042*") &&
    reminderMsg.includes("• Total Amount: ₹25,000.00"),
    "Renders Meta-compliant quotation reminder message"
  );

  // Test WhatsApp message dispatch with Quotation variables via MockProvider
  const quoteSendResult = await provider.sendMessage({
    to: "+91 99134 23994",
    message: quoteMsg,
    campaignName: "Quotation",
    templateName: "quotation_share_customer",
    templateVariables: {
      customer_name: "Amit Shah",
      quotation_number: "QT-2026-08-0042",
      grand_total: "25,000.00",
      valid_until: "31 Aug 2026",
      quotation_summary: "TallyPrime Gold (Qty: 1)",
      quotation_url: getPublicQuotationUrl("qt-uuid-42"),
      prepared_by_name: "Mehul Patel",
      prepared_by_phone: "8141703007",
    },
  });
  assert(quoteSendResult.success === true, "Mock provider successfully dispatches Quotation WhatsApp message");
  assert(mock.sentMessages.length === 2, "Mock provider records quotation dispatch in history");
  assert(mock.sentMessages[1].to === "919913423994", "Dispatches quotation with normalized recipient phone");

  // 8. Meta / WhatsApp Parameter Sanitization Tests
  console.log("\n8. Meta WhatsApp Parameter Sanitization:");
  const multilineInput = "Email: salarindiacorp@gmail.com\nHi, I'm interested in FIFO.\r\nPlease share details.\t\tThanks!";
  const sanitized = sanitizeTemplateParam(multilineInput);
  assert(!sanitized.includes("\n") && !sanitized.includes("\r") && !sanitized.includes("\t"), "Strips all newlines, carriage returns, and tabs");
  assert(sanitized === "Email: salarindiacorp@gmail.com | Hi, I'm interested in FIFO. | Please share details. Thanks!", "Sanitizes multiline lead remark into single-line clean text with separators");
  
  const multiSpaceInput = "FIFO   Outstanding    Report     Demo";
  const spaceSanitized = sanitizeTemplateParam(multiSpaceInput);
  assert(spaceSanitized === "FIFO Outstanding Report Demo", "Collapses 4+ consecutive spaces into single space");
  assert(sanitizeTemplateParam(null) === "", "Handles null input safely");
  assert(sanitizeTemplateParam(undefined) === "", "Handles undefined input safely");

  console.log(`\n========================================`);
  console.log(`Test Summary: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
