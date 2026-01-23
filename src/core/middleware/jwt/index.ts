// src/core/middleware/jwt/index.ts
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../../../config/database.config";

const JWT_SECRET = env.JWT_ACCESS_TOKEN_SECRET!;
const JWT_EXPIRES_IN = env.JWT_ACCESS_EXPIRES_IN as `${number}${string}`;
// console.log("\n\nJWT_EXPIRES_IN\n--> ", JWT_EXPIRES_IN);

export interface AccessTokenPayload {
  id?: string;
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
    email: decoded.email as string,
    roles: decoded.roles as string[],
    permissions: decoded.permissions as string[],
  };
}

// import ms from "ms";

// // export function signJwtA(payload: Record<string, any>, expiresIn: ms.StringValue = JWT_EXPIRES_IN as ms.StringValue) {
// //   return jwt.sign(payload, JWT_SECRET, { expiresIn });
// // }

// export function signJwt(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
//   return jwt.sign(payload, JWT_SECRET, {
//     expiresIn: JWT_EXPIRES_IN as ms.StringValue,
//     issuer: 'shivansh-admin',
//   });
// }

// export function verifyJwt(token: string): JWTPayload {
//   try {

//     if (!JWT_SECRET) {
//       throw new Error("JWT_SECRET is required in env");
//     }
//     // console.log("\nToken-->",token);

//     return jwt.verify(token, JWT_SECRET) as unknown as JWTPayload;
//   } catch (error) {
//     if (error instanceof jwt.TokenExpiredError) {
//       throw new Error('Token expired');
//     }
//     if (error instanceof jwt.JsonWebTokenError) {
//       throw new Error('Invalid token');
//     }
//     throw error;
//   }
// }

// // export function verifyJwt<T = any>(token: string): T {
// //   return jwt.verify(token, JWT_SECRET) as T;
// // }
