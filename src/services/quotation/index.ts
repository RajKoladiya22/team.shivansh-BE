// src/services/quotation/index.ts
import {
  QuotationEmailData,
  quotationEmailHtml,
  quotationEmailText,
} from "../../core/mailer/quotationEmail";
import { prisma } from "../../config/database.config";
import { sendMail } from "../../core/mailer";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */

export interface LineItemInput {
  position?: number;
  productId?: string | null;
  productSlug?: string | null;
  name: string;
  description?: string | null;
  hsn?: string | null;
  qty: number;
  unit?: string;
  basePrice: number;
  discountType?: "PERCENTAGE" | "FLAT" | null;
  discountValue?: number | null;
  taxType?: "GST" | "IGST" | "NONE";
  taxPercent?: number;
  notes?: string | null;
}

export interface LineItemComputed extends LineItemInput {
  position: number;
  discountedPrice: number; // per unit after discount
  taxAmount: number; // tax on discounted * qty
  totalPrice: number; // final per line
}

export interface QuotationFinancials {
  subtotal: number; // sum of (discountedPrice * qty)
  totalDiscount: number; // sum of all discounts
  totalTax: number; // sum of all tax
  grandTotal: number; // after extra discount
}

/* ─────────────────────────────────────────────
   Auto-increment quotation number
   Format: QT-YYYY-MM-NNNN  e.g. QT-2024-03-0042
───────────────────────────────────────────── */

export async function generateQuotationNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const seq = await prisma.$transaction(async (tx) => {
    return tx.quotationSequence.upsert({
      where: { year_month: { year, month } },
      update: { counter: { increment: 1 } },
      create: { year, month, counter: 1 },
    });
  });

  const counter = String(seq.counter).padStart(4, "0");
  return `QT-${year}-${String(month).padStart(2, "0")}-${counter}`;
}

/* ─────────────────────────────────────────────
   Compute line items + financials
───────────────────────────────────────────── */

export function computeLineItems(raw: LineItemInput[]): LineItemComputed[] {
  return raw.map((item, idx) => {
    const qty = Math.max(Number(item.qty) || 1, 1);
    const basePrice = Math.max(Number(item.basePrice) || 0, 0);
    const discountValue = Number(item.discountValue) || 0;
    const taxPercent = Number(item.taxPercent) || 0;

    // per-unit discount
    let discountedPrice = basePrice;
    if (item.discountType === "PERCENTAGE") {
      discountedPrice = basePrice - (basePrice * discountValue) / 100;
    } else if (item.discountType === "FLAT") {
      discountedPrice = Math.max(basePrice - discountValue, 0);
    }

    // tax on (discountedPrice * qty)
    const taxable = discountedPrice * qty;
    const taxAmount =
      item.taxType === "NONE" ? 0 : (taxable * taxPercent) / 100;

    const totalPrice = taxable + taxAmount;

    return {
      ...item,
      position: item.position ?? idx + 1,
      qty,
      basePrice,
      discountedPrice: parseFloat(discountedPrice.toFixed(2)),
      taxPercent,
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      totalPrice: parseFloat(totalPrice.toFixed(2)),
    };
  });
}

export function computeFinancials(
  lineItems: LineItemComputed[],
  extraDiscountType?: "PERCENTAGE" | "FLAT" | null,
  extraDiscountValue?: number | null,
): QuotationFinancials {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  for (const item of lineItems) {
    const qty = item.qty;
    const lineDiscount = (item.basePrice - item.discountedPrice) * qty;
    subtotal += item.discountedPrice * qty;
    totalDiscount += lineDiscount;
    totalTax += item.taxAmount;
  }

  let grandTotal = subtotal + totalTax;

  // apply extra discount after line-item discounts
  if (extraDiscountValue && extraDiscountValue > 0) {
    if (extraDiscountType === "PERCENTAGE") {
      const extra = (grandTotal * extraDiscountValue) / 100;
      totalDiscount += extra;
      grandTotal -= extra;
    } else if (extraDiscountType === "FLAT") {
      totalDiscount += extraDiscountValue;
      grandTotal = Math.max(grandTotal - extraDiscountValue, 0);
    }
  }

  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    totalDiscount: parseFloat(totalDiscount.toFixed(2)),
    totalTax: parseFloat(totalTax.toFixed(2)),
    grandTotal: parseFloat(grandTotal.toFixed(2)),
  };
}

/* ─────────────────────────────────────────────
   Build customer snapshot from DB record
───────────────────────────────────────────── */

export function buildCustomerSnapshot(customer: any) {
  return {
    name: customer.name,
    mobile: customer.mobile,
    email: customer.email ?? null,
    companyName: customer.customerCompanyName ?? null,
    city: customer.city ?? null,
    state: customer.state ?? null,
    gstin: null, // populate if you add gstin to Customer model
  };
}

/* ─────────────────────────────────────────────
   Check if quotation is expired
───────────────────────────────────────────── */

export function isQuotationExpired(validUntil: Date | null): boolean {
  if (!validUntil) return false;
  return new Date() > validUntil;
}

/* ─────────────────────────────────────────────
   Quotation select (full detail)
───────────────────────────────────────────── */

export const quotationFullSelect = {
  id: true,
  quotationNumber: true,
  status: true,
  channel: true,
  customerId: true,
  customerSnapshot: true,
  createdBy: true,
  preparedBy: true,
  lineItems: true,
  subtotal: true,
  totalDiscount: true,
  totalTax: true,
  grandTotal: true,
  currency: true,
  extraDiscountType: true,
  extraDiscountValue: true,
  extraDiscountNote: true,
  taxType: true,
  gstin: true,
  customerGstin: true,
  placeOfSupply: true,
  quotationDate: true,
  validUntil: true,
  sentAt: true,
  viewedAt: true,
  respondedAt: true,
  convertedAt: true,
  reminderSentAt: true,
  leadId: true,
  subject: true,
  introNote: true,
  termsNote: true,
  footerNote: true,
  paymentTerms: true,
  paymentDueDays: true,
  deliveryScope: true,
  deliveryDays: true,
  sendHistory: true,
  version: true,
  parentId: true,
  internalNote: true,
  tags: true,
  acceptedBy: true,
  acceptanceNote: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      mobile: true,
      email: true,
      customerCompanyName: true,
      city: true,
      state: true,
    },
  },
  createdByAcc: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
      contactPhone: true,
    },
  },
  preparedByAcc: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      designation: true,
    },
  },
  lead: {
    select: {
      id: true,
      status: true,
      productTitle: true,
    },
  },
  revisions: {
    select: {
      id: true,
      quotationNumber: true,
      version: true,
      status: true,
      createdAt: true,
    },
    orderBy: { version: "desc" as const },
  },
};

export function toNullableNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}




const QUOTATION_BASE_URL = "https://shivanshinfosys.in/quotation";

function quotationUrl(id: string): string {
  return `${QUOTATION_BASE_URL}/${id}`;
}


function extractCustomerEmail(q: any): string | undefined {
  return (
    q?.customer?.email ??
    q?.customerSnapshot?.email ??
    undefined
  );
}
 
/**
 * Maps the full Prisma quotation record to QuotationEmailData.
 * All field names verified against logged DB output.
 */
function buildEmailData(q: any, isReminder: boolean): QuotationEmailData {
  // ── Preparer: prefer preparedByAcc, fall back to createdByAcc ──
  const preparer = q.preparedByAcc ?? q.createdByAcc ?? null;
  const preparedByName = preparer
    ? `${preparer.firstName ?? ""} ${preparer.lastName ?? ""}`.trim() || undefined
    : undefined;
  const preparedByDesignation = preparer?.designation ?? undefined;
  const preparedByPhone = preparer?.contactPhone ?? preparer?.mobile ?? undefined;
 
  // ── Line items ──
  const items = ((q.lineItems ?? []) as any[]).map((item: any) => ({
    title:         item.name ?? "—",
    type:          item.unit ?? undefined,
    qty:           Number(item.qty ?? 1),
    rate:          Number(item.discountedPrice ?? item.basePrice ?? 0),
    baseRate:      item.basePrice != null ? Number(item.basePrice) : undefined,
    discountType:  item.discountType ?? undefined,
    discountValue: item.discountValue != null ? Number(item.discountValue) : undefined,
    taxPercent:    item.taxPercent != null ? Number(item.taxPercent) : undefined,
    amount:        Number(item.totalPrice ?? 0),
  }));
 
  // ── Customer info ──
  const customerName =
    q.customer?.name ?? q.customerSnapshot?.name ?? "Valued Customer";
  const customerCompanyName =
    q.customer?.customerCompanyName ?? q.customerSnapshot?.companyName ?? undefined;
 
  return {
    quotationNumber:    q.quotationNumber,
    quotationUrl:       quotationUrl(q.id),
    subject:            q.subject ?? undefined,
    customerName,
    customerCompanyName,
    customerCity:       q.customer?.city ?? q.customerSnapshot?.city ?? undefined,
    customerState:      q.customer?.state ?? q.customerSnapshot?.state ?? undefined,
    customerGstin:      q.customerGstin ?? undefined,
    companyGstin:       q.gstin ?? undefined,
    companyName:        "Shivansh Infosys",
    preparedByName,
    preparedByDesignation,
    preparedByPhone,
    grandTotal:         Number(q.grandTotal ?? 0),
    subtotal:           Number(q.subtotal ?? 0),
    taxAmount:          Number(q.totalTax ?? 0),
    totalDiscount:      q.totalDiscount ? Number(q.totalDiscount) : undefined,
    extraDiscountType:  q.extraDiscountType ?? undefined,
    extraDiscountValue: q.extraDiscountValue != null ? Number(q.extraDiscountValue) : undefined,
    extraDiscountNote:  q.extraDiscountNote ?? undefined,
    taxLabel:           q.taxType ?? "GST",
    currency:           q.currency ?? "INR",
    createdAt:
      q.quotationDate?.toISOString?.() ??
      q.createdAt?.toISOString?.() ??
      new Date().toISOString(),
    validUntil:      q.validUntil?.toISOString?.() ?? undefined,
    isReminder,
    items,
    introNote:       q.introNote ?? undefined,
    termsNote:       q.termsNote ?? undefined,
    footerNote:      q.footerNote ?? undefined,
    paymentTerms:    q.paymentTerms ?? undefined,
    paymentDueDays:  q.paymentDueDays != null ? Number(q.paymentDueDays) : undefined,
    deliveryScope:   q.deliveryScope ?? undefined,
    deliveryDays:    q.deliveryDays != null ? Number(q.deliveryDays) : undefined,
  };
}
 
export async function trySendQuotationEmail(q: any, isReminder: boolean): Promise<void> {
  const email = extractCustomerEmail(q);
  if (!email) {
    console.info(`[quotation-email] No email for ${q.quotationNumber} — skipping`);
    return;
  }
 
  const data = buildEmailData(q, isReminder);
  const subject = isReminder
    ? `Reminder: Quotation ${data.quotationNumber} from Shivansh Infosys`
    : `Your Quotation ${data.quotationNumber} from Shivansh Infosys`;
 
  try {
    await sendMail(email, subject, quotationEmailHtml(data), quotationEmailText(data));
    console.info(`[quotation-email] ${isReminder ? "Reminder" : "Sent"} ${data.quotationNumber} → ${email} ✓`);
  } catch (err: any) {
    console.error(`[quotation-email] Failed → ${email}:`, err?.message ?? err);
  }
}
