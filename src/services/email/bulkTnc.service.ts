// src/services/bulkTnc.service.ts
//
// Production-grade bulk T&C emailer.
//
// Responsibilities:
//   • Fetch only customers who qualify (valid email, not yet sent OR not yet accepted)
//   • Validate each customer record before queueing
//   • Process in configurable batches (default 10) with inter-batch delay
//   • Per-email retry (up to 3 attempts, exponential back-off)
//   • Return a structured BulkTncResult report (sent / skipped / failed breakdown)
//   • No data mutation on dry-run mode

import { prisma } from "../../config/database.config";
import { generateTncToken } from "../../core/middleware/jwt";
import { tncEmailHtml, tncEmailText } from "../../core/mailer/tncEmail";
import { sendMail } from "../../core/mailer";

// ─── Constants ────────────────────────────────────────────────────────────────
const TNC_VERSION = "1.0";
const FRONTEND_URL = "https://shivanshinfosys.in";
const BACKEND_URL = "https://teamapi.shivanshinfosys.in";

/** Reasonable batch size for a shared SMTP (Gmail = 500 msg/day, ~14/min). */
const DEFAULT_BATCH_SIZE = 10;
/** ms between batches — gives SMTP breathing room. */
const DEFAULT_BATCH_DELAY_MS = 3_000;
/** Per-email retry attempts (including first try). */
const MAX_RETRIES = 3;

// Simple email format guard — catches obvious junk before hitting SMTP.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ─── Types ────────────────────────────────────────────────────────────────────
export type BulkTncMode =
  | "UNSENT"    // never received any T&C mail (tncToken IS NULL and not accepted)
  | "PENDING"   // received mail but not yet accepted
  | "ALL";      // UNSENT + PENDING combined

export interface BulkTncOptions {
  mode?: BulkTncMode;
  batchSize?: number;
  batchDelayMs?: number;
  dryRun?: boolean;
  /** If supplied, only process these customer IDs. */
  customerIds?: string[];
}

export interface CustomerResult {
  customerId: string;
  name: string;
  email: string;
  status: "SENT" | "SKIPPED" | "FAILED";
  skipReason?: string;
  failReason?: string;
  attempts?: number;
}

export interface BulkTncResult {
  mode: BulkTncMode;
  dryRun: boolean;
  totalEligible: number;
  sent: number;
  skipped: number;
  failed: number;
  details: CustomerResult[];
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseProductNames(products: unknown): string[] {
  if (!products || !Array.isArray(products)) return [];
  return products
    .map((p: any) => p?.name ?? p?.productName ?? String(p))
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(
  to: string,
  subject: string,
  html: string,
  text: string,
  maxAttempts: number,
): Promise<{ attempts: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendMail(to, subject, html, text);
      return { attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        // Exponential back-off: 2s, 4s, 8s …
        await sleep(1_000 * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

// ─── Core eligibility query ───────────────────────────────────────────────────
async function fetchEligibleCustomers(
  mode: BulkTncMode,
  customerIds?: string[],
) {
  // Base filter: must have an email field populated
  const baseWhere: Record<string, unknown> = {
    email: { not: null },
    ...(customerIds?.length ? { id: { in: customerIds } } : {}),
  };

  if (mode === "UNSENT") {
    // Never had a token generated AND not accepted
    baseWhere["isTncAccepted"] = false;
    baseWhere["tncToken"] = null;
  } else if (mode === "PENDING") {
    // Got a token (mail was sent) but still not accepted
    baseWhere["isTncAccepted"] = false;
    baseWhere["tncToken"] = { not: null };
  } else {
    // ALL = not yet accepted (regardless of whether mail was sent)
    baseWhere["isTncAccepted"] = false;
  }

  return prisma.customer.findMany({
    where: baseWhere as any,
    select: {
      id: true,
      name: true,
      customerCompanyName: true,
      contactPerson: true,
      email: true,
      mobile: true,
      city: true,
      state: true,
      joiningDate: true,
      customerCategory: true,
      businessCategory: true,
      products: true,
      isTncAccepted: true,
      tncToken: true,
    },
    orderBy: { name: "asc" },
  });
}

// ─── Validate a single customer before emailing ───────────────────────────────
function validate(
  customer: Awaited<ReturnType<typeof fetchEligibleCustomers>>[number],
): string | null {
  if (!customer.email) return "No email address";
  if (!EMAIL_RE.test(customer.email)) return `Invalid email format: ${customer.email}`;
  if (!customer.name?.trim()) return "Customer name is blank";
  return null; // valid
}

// ─── Main exported function ───────────────────────────────────────────────────
export async function runBulkTncEmail(
  options: BulkTncOptions = {},
): Promise<BulkTncResult> {
  const {
    mode = "ALL",
    batchSize = DEFAULT_BATCH_SIZE,
    batchDelayMs = DEFAULT_BATCH_DELAY_MS,
    dryRun = false,
    customerIds,
  } = options;

  const startedAt = Date.now();
  const details: CustomerResult[] = [];

  // 1. Pull eligible customers
  const customers = await fetchEligibleCustomers(mode, customerIds);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // 2. Split into batches
  for (let batchStart = 0; batchStart < customers.length; batchStart += batchSize) {
    const batch = customers.slice(batchStart, batchStart + batchSize);

    // Process each customer in the batch concurrently within the batch
    await Promise.all(
      batch.map(async (customer) => {
        // ── Validate ──────────────────────────────────────────────────────────
        const validationError = validate(customer);
        if (validationError) {
          details.push({
            customerId: customer.id,
            name: customer.name,
            email: customer.email ?? "(none)",
            status: "SKIPPED",
            skipReason: validationError,
          });
          skipped++;
          return;
        }

        const isReminder = customer.isTncAccepted === false && customer.tncToken !== null;

        // ── Dry-run short-circuit ──────────────────────────────────────────────
        if (dryRun) {
          details.push({
            customerId: customer.id,
            name: customer.name,
            email: customer.email!,
            status: "SENT",
            skipReason: "[DRY RUN — no mail sent, no DB write]",
          });
          sent++;
          return;
        }

        // ── Generate fresh one-time token ──────────────────────────────────────
        const token = generateTncToken();

        try {
          // Persist token first — if mail fails we can retry with same token
          await prisma.customer.update({
            where: { id: customer.id },
            data: { tncToken: token },
          });
        } catch (dbErr: any) {
          details.push({
            customerId: customer.id,
            name: customer.name,
            email: customer.email!,
            status: "FAILED",
            failReason: `DB token write failed: ${dbErr?.message ?? String(dbErr)}`,
            attempts: 0,
          });
          failed++;
          return;
        }

        // ── Build email payload ────────────────────────────────────────────────
        const acceptUrl = `${FRONTEND_URL}/tnc/${token}`;
        const directAcceptUrl = `${BACKEND_URL}/api/v1/public/tnc/${token}/accept-redirect`;
        const productNames = parseProductNames(customer.products);

        const emailData = {
          customerName: customer.name,
          customerCompanyName: customer.customerCompanyName,
          contactPerson: customer.contactPerson,
          mobile: customer.mobile,
          city: customer.city,
          state: customer.state,
          joiningDate: customer.joiningDate?.toISOString() ?? null,
          customerCategory: customer.customerCategory,
          businessCategory: customer.businessCategory,
          products: productNames.length ? productNames : null,
          acceptUrl,
          directAcceptUrl,
          tncVersion: TNC_VERSION,
          isReminder,
        };

        const html = tncEmailHtml(emailData);
        const text = tncEmailText(emailData);
        const subject = isReminder
          ? "Reminder: Action Required — Accept T&C to Activate Your Account"
          : "Welcome to Shivansh Infosys — Activate Your Account";

        // ── Send with retry ────────────────────────────────────────────────────
        try {
          const { attempts } = await sendWithRetry(
            customer.email!,
            subject,
            html,
            text,
            MAX_RETRIES,
          );
          details.push({
            customerId: customer.id,
            name: customer.name,
            email: customer.email!,
            status: "SENT",
            attempts,
          });
          sent++;
        } catch (mailErr: any) {
          // Roll back the token so admin can retry this customer cleanly
          try {
            await prisma.customer.update({
              where: { id: customer.id },
              data: { tncToken: null },
            });
          } catch {
            // Non-fatal — log and move on
            console.error(`[bulkTnc] Token rollback failed for customer ${customer.id}`);
          }

          details.push({
            customerId: customer.id,
            name: customer.name,
            email: customer.email!,
            status: "FAILED",
            failReason: mailErr?.message ?? String(mailErr),
            attempts: MAX_RETRIES,
          });
          failed++;
        }
      }),
    );

    // ── Inter-batch delay (skip after last batch) ─────────────────────────────
    const isLastBatch = batchStart + batchSize >= customers.length;
    if (!isLastBatch) {
      await sleep(batchDelayMs);
    }
  }

  return {
    mode,
    dryRun,
    totalEligible: customers.length,
    sent,
    skipped,
    failed,
    details,
    durationMs: Date.now() - startedAt,
  };
}