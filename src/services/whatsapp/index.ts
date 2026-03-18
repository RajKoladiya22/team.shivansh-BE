// import axios from "axios";

// import { env } from "../../config/database.config";

// const WA_PHONE_NUMBER_ID = env.WA_PHONE_NUMBER_ID!;
// const WA_ACCESS_TOKEN = env.WA_ACCESS_TOKEN!;

// export async function sendWhatsAppNotification({
//   phoneNumber,
//   templateName,
//   variables,
// }: {
//   phoneNumber: string;
//   templateName: string;
//   variables: string[];
// }) {
//   try {
//     const response = await axios.post(
//       "https://dash.bizzriser.com/api/v1/whatsapp/send",
//       new URLSearchParams({
//         apiToken: WA_ACCESS_TOKEN,
//         phone_number_id: WA_PHONE_NUMBER_ID,
//         template_name: templateName,
//         variables: JSON.stringify(variables),
//         phone_number: phoneNumber.replace("+", ""),
//       }).toString(),
//       {
//         headers: {
//           "Content-Type": "application/x-www-form-urlencoded",
//         },
//       },
//     );

//     console.log(
//       "\n\n\n\n\nWhatsApp API response:",
//       response.data,
//       "\n\n\n\n\n",
//     );

//     return response.data;
//   } catch (error: any) {
//     console.error(
//       "WhatsApp send failed:",
//       error.response?.data || error.message,
//     );
//   }
// }



import axios from "axios";
import { env } from "../../config/database.config";

const WA_PHONE_NUMBER_ID = env.WA_PHONE_NUMBER_ID!;
const WA_ACCESS_TOKEN = env.WA_ACCESS_TOKEN!;

function normalizePhone(phone: string) {
  return phone.replace("+", "").trim();
}

// ✅ SESSION MESSAGE (24h window)
export async function sendWhatsAppText({
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
        phone_number: normalizePhone(phoneNumber),
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("\n\n\n\n\nWhatsApp TEXT response:", response.data);
    return response.data;
  } catch (error: any) {
    console.error("WhatsApp TEXT failed:", error.response?.data || error.message);
    return null;
  }
}

// ✅ TEMPLATE MESSAGE (outside 24h)
export async function sendWhatsAppTemplate({
  phoneNumber,
  templateName,
  variables,
}: {
  phoneNumber: string;
  templateName: string;
  variables?: string[];
}) {
  try {
    const response = await axios.post(
      "https://dash.bizzriser.com/api/v1/whatsapp/trigger-bot",
      new URLSearchParams({
        apiToken: WA_ACCESS_TOKEN,
        phone_number_id: WA_PHONE_NUMBER_ID,
        phone_number: normalizePhone(phoneNumber),
        bot_flow_unique_id: "336761",
        template_name: templateName,
        ...(variables && {
          variables: JSON.stringify(variables),
        }),
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("\n\n\n\nWhatsApp TEMPLATE response:", response.data);
    return response.data;
  } catch (error: any) {
    console.error("WhatsApp TEMPLATE failed:", error.response?.data || error.message);
    return null;
  }
}

// ✅ SMART HANDLER
export async function sendWhatsAppSmart({
  phoneNumber,
  message,
  templateName,
}: {
  phoneNumber: string;
  message: string;
  templateName: string;
}) {
  const normalized = phoneNumber.replace("+", "");

  // 🔥 STEP 1: Ensure subscriber exists
  await createWhatsAppSubscriber({
    phoneNumber: normalized,
    name: "Lead User",
  });

  // 🔹 STEP 2: Try normal message
  const resp = await sendWhatsAppText({
    phoneNumber: normalized,
    message,
  });

  if (resp?.status === "1") return resp;

  // 🔹 STEP 3: Fallback to template
  if (
    resp?.status === "0" &&
    resp?.message?.toLowerCase().includes("24 hour")
  ) {
    console.log("\n\n⚠️ Outside 24h → using TEMPLATE");

    return await sendWhatsAppTemplate({
      phoneNumber: normalized,
      templateName,
    });
  }

  return resp;
}


export async function createWhatsAppSubscriber({
  phoneNumber,
  name,
}: {
  phoneNumber: string;
  name: string;
}) {
  try {
    const response = await axios.post(
      "https://dash.bizzriser.com/api/v1/whatsapp/subscriber/create",
      new URLSearchParams({
        apiToken: WA_ACCESS_TOKEN,
        phoneNumberID: WA_PHONE_NUMBER_ID,
        name,
        phoneNumber: phoneNumber.replace("+", ""),
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("\n\nSubscriber create response:", response.data);

    return response.data;
  } catch (error: any) {
    console.error(
      "Subscriber create failed:",
      error.response?.data || error.message
    );
    return null;
  }
}