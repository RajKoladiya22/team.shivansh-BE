/**
 * Normalizes a phone number to standard E.164 format without '+' symbol for WhatsApp APIs.
 * Supports:
 * - 10-digit Indian numbers: '9876543210' -> '919876543210'
 * - 11-digit numbers with leading 0: '09876543210' -> '919876543210'
 * - Already prefixed numbers: '+919876543210' -> '919876543210'
 * - International numbers: '+1 415 555 2671' -> '14155552671'
 */
export function normalizePhoneNumber(rawPhone: string | null | undefined): string | null {
  if (!rawPhone || typeof rawPhone !== "string") return null;

  // Remove any non-digit character except nothing (strip +, spaces, hyphens, parentheses, etc.)
  const digitsOnly = rawPhone.replace(/\D/g, "");

  if (!digitsOnly) return null;

  // Standard Indian 10-digit mobile number
  if (digitsOnly.length === 10) {
    return `91${digitsOnly}`;
  }

  // 11-digit starting with 0 (e.g. 09876543210)
  if (digitsOnly.length === 11 && digitsOnly.startsWith("0")) {
    return `91${digitsOnly.substring(1)}`;
  }

  // 12-digit starting with 91
  if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
    return digitsOnly;
  }

  // International numbers (between 10 and 15 digits standard E.164)
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
    return digitsOnly;
  }

  return null;
}

/**
 * Validates if the given phone number is valid for WhatsApp delivery.
 */
export function isValidPhoneNumber(rawPhone: string | null | undefined): boolean {
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized) return false;
  // Ensure digits only and between 10 and 15 digits
  return /^[1-9]\d{9,14}$/.test(normalized);
}
