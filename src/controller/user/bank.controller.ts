import { Request, Response } from "express";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { encrypt, maskAccount, decrypt } from "../../core/utils/crypto.util";

export async function upsertMyBank(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { bankName, accountHolder, accountNumber, ifscCode, branch } =
      req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendErrorResponse(res, 404, "User not found");

    const existing = await prisma.bankDetail.findUnique({
      where: { accountId: user.accountId },
    });

    /* =======================
       CREATE
    ======================= */
    if (!existing) {
      if (!bankName || !accountNumber || !ifscCode) {
        return sendErrorResponse(
          res,
          400,
          "bankName, accountNumber and ifscCode are required"
        );
      }

      const bank = await prisma.bankDetail.create({
        data: {
          accountId: user.accountId,
          bankName,
          accountHolder,
          accountNumber: encrypt(accountNumber),
          ifscCode,
          branch,
        },
      });

      return sendSuccessResponse(res, 200, "Bank details saved", {
        ...bank,
        accountNumber: maskAccount(accountNumber),
      });
    }

    /* =======================
       UPDATE (diff-based)
    ======================= */
    const data: any = {};

    if (bankName !== undefined) data.bankName = bankName;
    if (accountHolder !== undefined) data.accountHolder = accountHolder;
    if (ifscCode !== undefined) data.ifscCode = ifscCode;
    if (branch !== undefined) data.branch = branch;

    if (accountNumber) {
      data.accountNumber = encrypt(accountNumber);
    }

    // nothing to update
    if (Object.keys(data).length === 0) {
      return sendSuccessResponse(res, 200, "No changes", {
        ...existing,
        accountNumber: maskAccount("XXXX"),
      });
    }

    const updated = await prisma.bankDetail.update({
      where: { accountId: user.accountId },
      data,
    });

    sendSuccessResponse(res, 200, "Bank details updated", {
      ...updated,
      accountNumber: maskAccount(accountNumber || "XXXX"),
    });
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to save bank details");
  }
}

export async function getMyBank(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    const { AcShow } = req.query; // ?AcShow=true

    if (!userId) {
      return sendErrorResponse(res, 401, "Unauthorized");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return sendErrorResponse(res, 404, "User not found");
    }

    const bank = await prisma.bankDetail.findUnique({
      where: { accountId: user.accountId },
    });

    if (!bank) {
      return sendErrorResponse(res, 404, "Bank details not found");
    }

    // 🔐 Decrypt once
    const fullAccountNumber = decrypt(bank.accountNumber);

    // ✅ Default: show last 4 digits only
    const accountNumber =
      AcShow === "true"
        ? fullAccountNumber
        : `XXXXXXX${fullAccountNumber.slice(-4)}`;

    sendSuccessResponse(res, 200, "Bank fetched", {
      id: bank.id,
      bankName: bank.bankName,
      accountHolder: bank.accountHolder,
      accountNumber,
      ifscCode: bank.ifscCode,
      branch: bank.branch,
      createdAt: bank.createdAt,
      updatedAt: bank.updatedAt,
    });
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to fetch bank details");
  }
}

export async function revealMyBankAccount(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    const { otp } = req.body;

    if (!otp) {
      return sendErrorResponse(res, 400, "OTP required");
    }

    // 1️⃣ Verify OTP (example – adjust to your OTP logic)
    const validOtp = await prisma.passwordOTP.findFirst({
      where: {
        userId,
        otpCode: otp,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!validOtp) {
      return sendErrorResponse(res, 401, "Invalid or expired OTP");
    }

    await prisma.passwordOTP.update({
      where: { id: validOtp.id },
      data: { used: true },
    });

    // 2️⃣ Fetch bank details
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const bank = await prisma.bankDetail.findUnique({
      where: { accountId: user!.accountId },
    });

    if (!bank) {
      return sendErrorResponse(res, 404, "Bank details not found");
    }

    // 3️⃣ Decrypt safely
    const accountNumber = decrypt(bank.accountNumber);

    sendSuccessResponse(res, 200, "Bank account revealed", {
      ...bank,
      accountNumber,
    });
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Failed to reveal bank account");
  }
}
