import { INotificationProvider } from "../types/provider.interface";
import { OnbitsProvider } from "./onbits.provider";
import { MockProvider } from "./mock.provider";

let currentProvider: INotificationProvider | null = null;

export function getNotificationProvider(): INotificationProvider {
  if (currentProvider) {
    return currentProvider;
  }

  const isExplicitlyDisabled = process.env.ONBITS_ENABLED === "false" || process.env.WHATSAPP_ENABLED === "false";
  const hasCredentials = Boolean(
    process.env.ONBITS_TOKEN ||
    process.env.ONBITS_API_KEY ||
    process.env.WA_ACCESS_TOKEN ||
    process.env.WHATSAPP_ACCESS_TOKEN
  );

  if (!isExplicitlyDisabled && (hasCredentials || process.env.NODE_ENV === "production")) {
    currentProvider = new OnbitsProvider();
  } else {
    currentProvider = new MockProvider();
  }

  return currentProvider;
}

export function setNotificationProvider(provider: INotificationProvider): void {
  currentProvider = provider;
}

export function resetNotificationProvider(): void {
  currentProvider = null;
}
