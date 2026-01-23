import nodemailer from "nodemailer";
import { env } from "../../config/database.config";

const host = env.SMTP_HOST || "smtp.gmail.com";
const port = Number(env.SMTP_PORT) || 465;
const user = env.SMTP_USER || "magicallydev@gmail.com";
const pass = env.SMTP_PASS || "azjkfwgqfqmdjfto";
const from = env.MAIL_FROM ?? user;

if (!user || !pass) {
  console.warn("[mailer] Gmail credentials not set. Emails will fail.");
}

export const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465, // true for 465 (SSL), false for 587 (TLS)
  auth: { user, pass },
});

export async function sendMail(to: string, subject: string, html: string, text?: string) {
  const msg = { from, to, subject, text: text ?? undefined, html };
  return transporter.sendMail(msg);
}
