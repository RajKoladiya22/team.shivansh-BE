// src/core/middleware/jwt/index.ts
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../../../config/database.config";

const JWT_SECRET = env.JWT_ACCESS_TOKEN_SECRET!;
const JWT_EXPIRES_IN = env.JWT_ACCESS_EXPIRES_IN as `${number}${string}`;
// console.log("\n\nJWT_EXPIRES_IN\n--> ", JWT_EXPIRES_IN);

export interface AccessTokenPayload {
  id?: string;
  accountId?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS512",
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

  return {
    id: decoded.id as string,
    accountId: decoded.accountId as string,
    email: decoded.email as string,
    roles: decoded.roles as string[],
    permissions: decoded.permissions as string[],
  };
}
