export enum NotificationModule {
  LEAD = "LEAD",
  QUOTATION = "QUOTATION",
  SUPPORT = "SUPPORT",
  CUSTOMER = "CUSTOMER",
  PROJECT = "PROJECT",
  OTHER = "OTHER",
}

export enum NotificationEvent {
  // Lead Events
  LEAD_CREATED = "LEAD_CREATED",
  LEAD_ASSIGNED = "LEAD_ASSIGNED",
  LEAD_STATUS_CHANGED = "LEAD_STATUS_CHANGED",

  // Quotation Events (Future)
  QUOTATION_CREATED = "QUOTATION_CREATED",
  QUOTATION_SENT = "QUOTATION_SENT",

  // Support Events (Future)
  SUPPORT_CREATED = "SUPPORT_CREATED",
  SUPPORT_ASSIGNED = "SUPPORT_ASSIGNED",

  // Customer Events (Future)
  CUSTOMER_ONBOARDED = "CUSTOMER_ONBOARDED",

  // Project Events (Future)
  PROJECT_STATUS_CHANGED = "PROJECT_STATUS_CHANGED",
}

export enum RecipientType {
  CUSTOMER = "CUSTOMER",
  TEAM_MEMBER = "TEAM_MEMBER",
  ADMIN = "ADMIN",
}

export interface NotificationRecipient {
  type: RecipientType;
  name?: string;
  phone: string;
  email?: string;
  accountId?: string;
  customerId?: string;
}

export enum NotificationDeliveryStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

export interface NotificationContext<TData = Record<string, any>> {
  module: NotificationModule;
  event: NotificationEvent;
  entityId: string;
  recipient: NotificationRecipient;
  data: TData;
  dedupeKey?: string;
  templateName?: string;
}

export * from "./provider.interface";
