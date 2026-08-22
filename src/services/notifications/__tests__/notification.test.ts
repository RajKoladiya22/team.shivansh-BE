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
import { MockProvider } from "../providers/mock.provider";
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
  assert(adminPublicMsg.startsWith("New lead received from *Website*.") && adminPublicMsg.includes("Customer Name:\n*Mehul Patel*") && adminPublicMsg.includes("Product Details:\n*Tally on Cloud*") && adminPublicMsg.includes("Lead ID:\nlead-abc-123") && adminPublicMsg.includes("Thank You."), "Renders Meta-compliant admin public lead notification with asterisks");

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
