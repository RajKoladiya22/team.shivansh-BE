import axios, { AxiosInstance } from "axios";
import { INotificationProvider, NotificationSendResult, SendMessageOptions } from "../types/provider.interface";
import { executeWithRetry } from "../utils/retry.util";
import { normalizePhoneNumber } from "../utils/phone.util";

export interface OnbitsConfig {
  token?: string;
  apiUrl?: string;
  userName?: string;
  defaultCampaignName?: string;
  timeoutMs?: number;
}

export class OnbitsProvider implements INotificationProvider {
  public readonly name = "ONBITS";
  private client: AxiosInstance;
  private config: OnbitsConfig;

  constructor(config?: OnbitsConfig) {
    const token = config?.token || process.env.ONBITS_TOKEN || process.env.ONBITS_API_KEY || process.env.WA_ACCESS_TOKEN;
    const apiUrl = config?.apiUrl || process.env.ONBITS_API_URL || "https://api.onbbits.io/api/campaigns/send";
    const userName = config?.userName || process.env.ONBITS_USER_NAME || "Shivansh CRM";
    const defaultCampaignName = config?.defaultCampaignName || process.env.ONBITS_CUSTOMER_LEAD_CAMPAIGN || "Customer Lead V3";
    const timeoutMs = config?.timeoutMs || Number(process.env.ONBITS_TIMEOUT_MS) || 10000;

    this.config = {
      token,
      apiUrl,
      userName,
      defaultCampaignName,
      timeoutMs,
    };

    this.client = axios.create({
      timeout: this.config.timeoutMs,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Shivansh-Notification-Service/1.0",
      },
    });
  }

  public isConfigured(): boolean {
    return Boolean(this.config.token);
  }

  public async sendMessage(options: SendMessageOptions): Promise<NotificationSendResult> {
    const timestamp = new Date().toISOString();
    const normalizedPhone = normalizePhoneNumber(options.to);

    if (!normalizedPhone) {
      return {
        success: false,
        provider: this.name,
        error: `Invalid recipient phone number: ${options.to}`,
        timestamp,
      };
    }

    if (!this.isConfigured()) {
      return {
        success: false,
        provider: this.name,
        error: "OnBItS provider is not configured. Missing ONBITS_TOKEN in environment.",
        timestamp,
      };
    }

    try {
      const responseData = await executeWithRetry(async (attempt) => {
        return await this.dispatchCampaignRequest(normalizedPhone, options);
      });

      return {
        success: true,
        messageId: responseData?.id || responseData?.message_id || responseData?.data?.id || `onbits-${Date.now()}`,
        provider: this.name,
        rawResponse: responseData,
        timestamp,
      };
    } catch (err: any) {
      const safeErrorMsg = this.sanitizeErrorMessage(err);
      return {
        success: false,
        provider: this.name,
        error: safeErrorMsg,
        rawResponse: err?.response?.data,
        timestamp,
      };
    }
  }

  private async dispatchCampaignRequest(phone: string, options: SendMessageOptions): Promise<any> {
    const { token, apiUrl, userName, defaultCampaignName } = this.config;

    const destination = phone.startsWith("+") ? phone : `+${phone}`;
    const campaignName = options.campaignName || defaultCampaignName || "Customer Lead V3";

    // Build parameters array from templateVariables
    const parameters: Array<{ type: string; parameter_name: string; text: string }> = [];

    if (options.templateVariables) {
      for (const [key, val] of Object.entries(options.templateVariables)) {
        if (val !== undefined && val !== null) {
          const textVal = String(val).trim();
          parameters.push({
            type: "text",
            parameter_name: key,
            text: textVal || "N/A",
          });
        }
      }
    }

    const payload = {
      token,
      campaignName,
      destination,
      userName,
      components: [
        {
          type: "body",
          parameters,
        },
      ],
    };

    const response = await this.client.post(apiUrl!, payload);
    return response.data;
  }

  private sanitizeErrorMessage(err: any): string {
    const raw =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      (typeof err?.response?.data === "string" ? err?.response?.data : null) ||
      err?.message ||
      "Unknown error";

    // Ensure token is never leaked in log strings
    if (this.config.token && typeof raw === "string") {
      return raw.split(this.config.token).join("***REDACTED***");
    }
    return String(raw);
  }
}
