import { z } from 'zod';

const toNumber = (val: unknown) =>
  typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))
    ? Number(val)
    : undefined;

export const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'development', 'production']),
  PORT: z.preprocess(toNumber, z.number().default(3000)),

  // Database
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_ACCESS_TOKEN_SECRET: z.string(),
  JWT_REFRESH_TOKEN_SECRET: z.string(),
  JWT_ACCESS_EXPIRES_IN: z.string(),
  JWT_REFRESH_EXPIRES_IN: z.string(),

  STATIC_TOKEN: z.string(),
  SALT_ROUNDS: z.string(),
  COOKIE_NAME: z.string(),
  COOKIE_MAX_AGE: z.string(),

  SECRET_KEY: z.string(),
  IV: z.string(),

  BASE_URL: z.string().url().optional(),

  SMTP_HOST: z.string(),
  SMTP_PORT: z.string(),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  MAIL_FROM: z.string(),
  RESET_OTP_EXPIRES_MIN: z.string(),

  BANK_SECRET: z.string(),

  VAPID_PUBLIC_KEY: z.string(),
  VAPID_PRIVATE_KEY: z.string(),
});

export type EnvVars = z.infer<typeof envSchema>;
