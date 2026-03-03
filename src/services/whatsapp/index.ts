import axios from "axios";

import { env } from "../../config/database.config";

const WA_PHONE_NUMBER_ID = env.WA_PHONE_NUMBER_ID!;
const WA_ACCESS_TOKEN = env.WA_ACCESS_TOKEN!;

export async function sendWhatsAppNotification({
  phoneNumber,
  message,
}: {
  phoneNumber: string;
  message: string;
}) {
  try {
    const response = await axios.post(
      "https://dash.bizzriser.com/api/v1/whatsapp/send",
      new URLSearchParams({
        apiToken: WA_ACCESS_TOKEN,
        phone_number_id: WA_PHONE_NUMBER_ID,
        message,
        phone_number: phoneNumber.replace("+", ""), // must remove +
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("\n\n\n\n\nWhatsApp API response:", response.data, "\n\n\n\n\n");

    return response.data;
  } catch (error: any) {
    console.error("WhatsApp send failed:", error.response?.data || error.message);
  }
}