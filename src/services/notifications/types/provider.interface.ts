export interface SendMessageOptions {
  to: string; // Normalized E.164 phone number
  message: string; // Formatted plain-text / markdown body
  templateName?: string;
  campaignName?: string;
  templateVariables?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface NotificationSendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
  rawResponse?: any;
  timestamp: string;
}

export interface INotificationProvider {
  readonly name: string;
  sendMessage(options: SendMessageOptions): Promise<NotificationSendResult>;
  isConfigured(): boolean;
}
