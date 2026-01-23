import { validatedEnv } from "./validate-env";



interface JwtTokenConfig {
    secret: string;
    expiresIn: string;
}

export interface EnvConfig {
    nodeEnv: string;
    port: number;
    databaseUrl: string;
    jwtAccessExpiresIn?: string;
    apikey: string;
    saltRounds: number;
    jwt: {
        access: JwtTokenConfig;
        refresh: JwtTokenConfig;
    };
    secretKey?: string;
    Banksecret?: string;
    iv?: string;
    baseUrl?: string;
    cookieName: string; 
    smtp: {
        host: string;
        port: number;
        user: string;
        pass: string;
        mailFrom: string;
        resetOtpExpiresMin: number;
    };
}

const {
    NODE_ENV,
    PORT,
    DATABASE_URL,
    STATIC_TOKEN,
    SALT_ROUNDS,
    JWT_ACCESS_TOKEN_SECRET,
    JWT_REFRESH_TOKEN_SECRET,
    JWT_ACCESS_EXPIRES_IN,
    JWT_REFRESH_EXPIRES_IN,
    SECRET_KEY,
    BANK_SECRET,
    IV,
    BASE_URL,
    COOKIE_NAME,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    MAIL_FROM,
    RESET_OTP_EXPIRES_MIN,
} = validatedEnv;

export const envConfiguration = (): EnvConfig => ({
    nodeEnv: NODE_ENV,
    port: Number(PORT),
    databaseUrl: DATABASE_URL,
    apikey: STATIC_TOKEN,
    saltRounds: Number(SALT_ROUNDS),
    jwt: {
        access: {
            secret: JWT_ACCESS_TOKEN_SECRET,
            expiresIn: JWT_ACCESS_EXPIRES_IN,
        },
        refresh: {
            secret: JWT_REFRESH_TOKEN_SECRET,
            expiresIn: JWT_REFRESH_EXPIRES_IN,
        },
    },
    secretKey: SECRET_KEY,
    Banksecret: BANK_SECRET,
    iv: IV,
    baseUrl: BASE_URL,
    cookieName: COOKIE_NAME,
    smtp: {
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        user: SMTP_USER,
        pass: SMTP_PASS,
        mailFrom: MAIL_FROM,
        resetOtpExpiresMin: Number(RESET_OTP_EXPIRES_MIN),
    },
});
