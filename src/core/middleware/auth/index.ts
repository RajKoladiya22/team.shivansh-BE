// src/core/middleware/auth/index.ts

import { Request, Response, NextFunction } from "express";
import { AccessTokenPayload, verifyAccessToken } from "../jwt";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token = req.cookies["access_token"];

    if (!token) {
      const authHeader =
        req.headers["authorization"] || req.headers["Authorization"];
      if (
        authHeader &&
        typeof authHeader === "string" &&
        authHeader.startsWith("Bearer ")
      ) {
        token = authHeader.split(" ")[1];
      }
    }

    // console.log("\n[TOKEN]---------------->\N", token);
    if (!token) {
      return res.status(401).json({ message: "Unauthorized: token missing" });
    }

    const payload = verifyAccessToken(token);
    req.user = payload;
    return next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ message: "Unauthorized: invalid token" });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    const roles = req.user?.roles || [];
    const hasRole = roles.some((r: string) => allowedRoles.includes(r));

    if (!hasRole) {
      return res.status(403).json({ message: "Forbidden: role denied" });
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return async (req: any, res: Response, next: NextFunction) => {
    const permissions = req.user?.permissions || [];
    if (!permissions.includes(permission)) {
      return res.status(403).json({ message: "Forbidden: permission denied" });
    }
    next();
  };
}
