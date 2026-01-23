// src/controller/auth/password.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../config/database.config";
import {
  sendErrorResponse,
  sendSuccessResponse,
} from "../../core/utils/httpResponse";
import { sendMail } from "../../core/mailer";
import { forgotPasswordHtml } from "../../core/mailer/templates";
// import { sendMail } from "../../core/mailer/mailer";

const OTP_EXPIRY_MINUTES = 10;
const SALT_ROUNDS = 12;

/* ======================================================
   FORGOT PASSWORD → SEND OTP
====================================================== */
export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) return sendErrorResponse(res, 400, "Email is required");

    const account = await prisma.account.findUnique({
      where: { contactEmail: email },
      include: { user: true },
    });

    // console.log("\n\n account ", account);

    if (!account?.user) return sendErrorResponse(res, 404, "User not found");

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    await prisma.passwordOTP.create({
      data: {
        userId: account.user.id,
        otpCode: hashedOtp,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    });

    const HtmlText = forgotPasswordHtml(otp, OTP_EXPIRY_MINUTES);
    await sendMail(email, "Password Reset OTP", HtmlText);

    sendSuccessResponse(res, 200, "OTP sent to email");
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ======================================================
   VERIFY OTP + RESET PASSWORD
====================================================== */
export async function verifyOtpAndResetPassword(req: Request, res: Response) {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword)
      return sendErrorResponse(res, 400, "Missing required fields");

    const account = await prisma.account.findUnique({
      where: { contactEmail: email },
      include: { user: true },
    });

    if (!account?.user) return sendErrorResponse(res, 404, "User not found");

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const otpRecord = await prisma.passwordOTP.findFirst({
      where: {
        userId: account.user.id,
        otpCode: hashedOtp,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord)
      return sendErrorResponse(res, 400, "Invalid or expired OTP");

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: account.user.id },
        data: { passwordHash },
      }),
      prisma.passwordOTP.deleteMany({
        where: { userId: account.user.id },
      }),
    ]);

    sendSuccessResponse(res, 200, "Password reset successful");
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Internal server error");
  }
}

/* ======================================================
   CHANGE PASSWORD (OLD PASSWORD REQUIRED)
====================================================== */
export async function changePasswordWithOld(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return sendErrorResponse(res, 401, "Unauthorized");

    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return sendErrorResponse(res, 400, "Missing fields");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash)
      return sendErrorResponse(res, 400, "Password not set");

    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);

    if (!isValid)
      return sendErrorResponse(res, 400, "Old password is incorrect");

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { 
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });

    sendSuccessResponse(res, 200, "Password updated successfully");
  } catch (e) {
    console.error(e);
    sendErrorResponse(res, 500, "Internal server error");
  }
}
