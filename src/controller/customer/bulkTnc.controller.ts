// src/controller/customer/bulkTnc.controller.ts
//
// POST /customers/bulk-send-tnc
//
// Body (all optional):
//   {
//     mode?        : "UNSENT" | "PENDING" | "ALL"   default "ALL"
//     batchSize?   : number                          default 10
//     batchDelayMs?: number                          default 3000
//     dryRun?      : boolean                         default false
//     customerIds? : string[]                        restrict to these IDs
//   }
//
// Mode semantics:
//   UNSENT  → customers who never received any T&C mail (no token, not accepted)
//   PENDING → customers who received mail but haven't accepted yet (have token)
//   ALL     → everyone not yet accepted (UNSENT + PENDING combined)
//
// Returns a structured report:  totalEligible / sent / skipped / failed / details[]

import { Request, Response } from "express";
import { sendErrorResponse, sendSuccessResponse } from "../../core/utils/httpResponse";
import { runBulkTncEmail, BulkTncMode } from "../../services/email/bulkTnc.service";

const VALID_MODES: BulkTncMode[] = ["UNSENT", "PENDING", "ALL"];

export const bulkSendTncEmail = async (req: Request, res: Response) => {
  try {
    // ── Auth guard ────────────────────────────────────────────────────────────
    if (!req.user?.accountId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    // ── Parse & validate body ─────────────────────────────────────────────────
    const {
      mode = "ALL",
      batchSize,
      batchDelayMs,
      dryRun = false,
      customerIds,
    } = req.body ?? {};

    if (!VALID_MODES.includes(mode)) {
      return sendErrorResponse(
        res,
        400,
        `Invalid mode "${mode}". Must be one of: ${VALID_MODES.join(", ")}`,
      );
    }

    if (batchSize !== undefined) {
      const n = Number(batchSize);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return sendErrorResponse(res, 400, "batchSize must be an integer between 1 and 50");
      }
    }

    if (batchDelayMs !== undefined) {
      const n = Number(batchDelayMs);
      if (!Number.isInteger(n) || n < 500 || n > 30_000) {
        return sendErrorResponse(res, 400, "batchDelayMs must be between 500 and 30000");
      }
    }

    if (customerIds !== undefined) {
      if (!Array.isArray(customerIds) || customerIds.some((id) => typeof id !== "string")) {
        return sendErrorResponse(res, 400, "customerIds must be an array of strings");
      }
    }

    // ── Run bulk processor ────────────────────────────────────────────────────
    // console.log(
    //   `[bulkTnc] Starting — mode=${mode} batchSize=${batchSize ?? 10} dryRun=${dryRun}`,
    // );

    const result = await runBulkTncEmail({
      mode,
      batchSize: batchSize ? Number(batchSize) : undefined,
      batchDelayMs: batchDelayMs ? Number(batchDelayMs) : undefined,
      dryRun: Boolean(dryRun),
      customerIds,
    });

    // console.log(
    //   `[bulkTnc] Done — sent=${result.sent} skipped=${result.skipped} failed=${result.failed} duration=${result.durationMs}ms`,
    // );

    // ── Respond ───────────────────────────────────────────────────────────────
    const message = result.dryRun
      ? `[DRY RUN] Would send ${result.sent} emails (${result.skipped} skipped, ${result.failed} failed)`
      : `Bulk T&C email complete — ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`;

    return sendSuccessResponse(res, 200, message, result);
  } catch (err: any) {
    console.error("[bulkTnc] Unhandled error:", err);
    return sendErrorResponse(
      res,
      500,
      err?.message ?? "Bulk T&C email job failed unexpectedly",
    );
  }
};