import { config } from "dotenv";
config();

import { OnbitsProvider } from "../services/notifications/providers/onbits.provider";

async function testOnbitsLive() {
  console.log("=== Testing OnBItS Live Integration ===");
  console.log("Reading configuration from process.env...");
  
  const token = process.env.ONBITS_TOKEN;
  console.log("ONBITS_TOKEN present:", Boolean(token));
  console.log("ONBITS_API_URL:", process.env.ONBITS_API_URL || "https://api.onbbits.io/api/campaigns/send");

  if (!token) {
    console.error("❌ ONBITS_TOKEN is missing in environment variables!");
    process.exit(1);
  }

  const provider = new OnbitsProvider();

  console.log("\n1. Testing 'New Customer Lead' (Customer Notification) to: +91 9913423994...");
  const customerResult = await provider.sendMessage({
    to: "+91 9913423994",
    message: "Customer Test Message",
    campaignName: "New Customer Lead",
    templateVariables: {
      customer_name: "*Mehul Patel*",
      product_title: "*Tally On Cloud* (Demo: https://youtu.be/2-sW6heDolQ)",
      member_name: "*Raj Koladiya*",
      member_phone: "9909911011",
    },
  });
  console.log("Customer Result:", JSON.stringify(customerResult, null, 2));

  console.log("\n2. Testing 'New Member Lead' (Team Member Assignment) to: +91 9913423994...");
  const memberResult = await provider.sendMessage({
    to: "+91 9913423994",
    message: "Member Test Message",
    campaignName: "New Member Lead",
    templateVariables: {
      team_member_name: "Raj Koladiya",
      customer_name: "*Amit Shah*",
      customer_phone: "9909944044",
      product_title: "*GST Reconciliation Demo*",
      remark: "*Urgent client demo required*",
      team_member_url: "https://team.shivanshinfosys.in/leads/user/10ab1975-d33b-4cc9-8abe-ca7cb3b34fd2",
    },
  });
  console.log("\n3. Testing 'New Admin Lead' (Public Lead Admin Notification) to: +91 9913423994...");
  const adminResult = await provider.sendMessage({
    to: "+91 9913423994",
    message: "Admin Test Message",
    campaignName: "New Admin Lead",
    templateVariables: {
      source: "Website",
      customer_name: "Raj Koladiya",
      customer_phone: "9913423994",
      product_title: "product of website",
      remark: "develop new website",
      lead_id: "link",
    },
  });
  console.log("Admin Result:", JSON.stringify(adminResult, null, 2));

  if (customerResult.success && memberResult.success && adminResult.success) {
    console.log("\n✅ All 3 OnBItS WhatsApp campaigns dispatched successfully!");
  } else {
    console.error("\n❌ One or more tests failed.");
  }
}

testOnbitsLive().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
