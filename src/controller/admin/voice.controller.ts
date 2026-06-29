import { Request, Response } from "express";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { prisma } from "../../config/database.config";
import { env } from "../../config/database.config";

export async function adminParseVoiceLead(req: Request, res: Response) {
  try {

    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return sendErrorResponse(res, 400, "Voice text is required");
    }

    const apiKey = env.GEMINI_API_KEY ;
    // console.log("GEMINI_API_KEY:", apiKey ? "Present" : "Missing");
    if (!apiKey) {
      return sendErrorResponse(
        res,
        500,
        "GEMINI_API_KEY is missing in backend environment variables.",
      );
    }

    // Fetch active products and employees
    const [products, employees] = await Promise.all([
      prisma.productCatalog.findMany({
        where: { isActive: true },
        select: { id: true, title: true, slug: true },
      }),
      prisma.account.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, designation: true },
      }),
    ]);

    const productList = products
      .map((p) => `ID: ${p.id} | Name: ${p.title} | Slug: ${p.slug}`)
      .join("\n");
      
    const employeeList = employees
      .map(
        (e) =>
          `ID: ${e.id} | Name: ${e.firstName} ${e.lastName} | Designation: ${
            e.designation || "None"
          }`
      )
      .join("\n");

    const prompt = `You are an AI assistant helping to parse voice commands into a Lead structure.
The user spoke the following text to create a new lead:
"${text}"

Your goal is to extract the product they mentioned, the employee they want to assign the lead to, and any additional remark.

Available Products:
${productList}

Available Employees:
${employeeList}

Rules:
1. Match the spoken product name to the closest product in the Available Products list. Return the exact "ID" of that product as productCatalogId, and the exact "Name" as productTitle. If no product matches, leave them as null.
2. Match the spoken employee name to the closest employee in the Available Employees list. Return the exact "ID" of that employee as employeeId, and their full name as employeeName. If no employee matches, leave them as null.
3. Extract any spoken remark or description into the "remark" field. If none, leave it as null.
4. Extract the spoken customer's name into the "spokenCustomerName" field. If none, leave it as null.
5. Extract the spoken customer's mobile number into the "spokenCustomerNumber" field. If none, leave it as null. Extract only digits if possible.
6. Output your response STRICTLY as a valid JSON object with no markdown wrappers like \`\`\`json. Do not include any extra text.

Required JSON structure:
{
  "productCatalogId": "string or null",
  "productTitle": "string or null",
  "employeeId": "string or null",
  "employeeName": "string or null",
  "remark": "string or null",
  "spokenCustomerName": "string or null",
  "spokenCustomerNumber": "string or null"
}
`;

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const outputText = response.text || "{}";
    
    // Clean up potential markdown wrapper
    const jsonStr = outputText.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    
    let parsedData: any = {};
    try {
      parsedData = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse Gemini output:", jsonStr);
      return sendErrorResponse(res, 500, "Failed to parse AI response");
    }

    let matchedCustomer: any = null;
    if (parsedData.spokenCustomerNumber) {
      const cleanNumber = parsedData.spokenCustomerNumber.replace(/\D/g, "");
      if (cleanNumber.length >= 10) {
        matchedCustomer = await prisma.customer.findFirst({
          where: { mobile: { contains: cleanNumber } },
          select: { id: true, name: true, mobile: true, customerCompanyName: true }
        });
      }
    }
    
    if (!matchedCustomer && parsedData.spokenCustomerName) {
      matchedCustomer = await prisma.customer.findFirst({
        where: {
          name: { contains: parsedData.spokenCustomerName, mode: "insensitive" }
        },
        select: { id: true, name: true, mobile: true, customerCompanyName: true }
      });
      
      if (!matchedCustomer) {
        matchedCustomer = await prisma.customer.findFirst({
          where: {
            customerCompanyName: { contains: parsedData.spokenCustomerName, mode: "insensitive" }
          },
          select: { id: true, name: true, mobile: true, customerCompanyName: true }
        });
      }
    }

    return sendSuccessResponse(res, 200, "Voice parsed successfully", {
      ...parsedData,
      matchedCustomer,
      metadata: { products, employees }
    });
  } catch (err: any) {
    console.error("adminParseVoiceLead error:", err);
    return sendErrorResponse(
      res,
      500,
      err.message || "Failed to process voice command",
    );
  }
}
