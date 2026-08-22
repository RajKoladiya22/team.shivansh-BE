import { INotificationProvider, NotificationSendResult, SendMessageOptions } from "../types/provider.interface";
import { normalizePhoneNumber } from "../utils/phone.util";

export class MockProvider implements INotificationProvider {
  public readonly name = "MOCK";
  public sentMessages: Array<SendMessageOptions & { timestamp: string }> = [];

  public isConfigured(): boolean {
    return true;
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

    const messageRecord = {
      ...options,
      to: normalizedPhone,
      timestamp,
    };

    this.sentMessages.push(messageRecord);

    if (process.env.NODE_ENV !== "test") {
      console.log(`\n🔔 [MOCK WHATSAPP NOTIFICATION] to: ${normalizedPhone}`);
      console.log(`----------------------------------------`);
      console.log(options.message);
      console.log(`----------------------------------------\n`);
    }

    return {
      success: true,
      messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      provider: this.name,
      rawResponse: { status: "mock_delivered", recipient: normalizedPhone },
      timestamp,
    };
  }

  public clear(): void {
    this.sentMessages = [];
  }
}
