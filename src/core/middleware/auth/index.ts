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
    let roles = req.user?.roles ?? [];

    // Normalize to string[]
    if (!Array.isArray(roles)) {
      roles = [roles];
    }

    roles = roles.map((r: any) =>
      typeof r === "string" ? r.toUpperCase() : String(r).toUpperCase(),
    );

    const normalizedAllowed = allowedRoles.map((r) => r.toUpperCase());

    const hasRole = roles.some((role) => normalizedAllowed.includes(role));

    console.log("\n\nROLES →", roles);
    console.log("allowedRoles from perams→", allowedRoles);
    console.log("ALLOWED →", normalizedAllowed);
    console.log("HAS ROLE →", hasRole);

    if (!hasRole) {
      return res.status(403).json({
        message: "Forbidden: role denied",
      });
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    const userPermissions: string[] = req.user?.permissions ?? [];

    if (!userPermissions.length) {
      return res
        .status(403)
        .json({ message: "Forbidden: no permissions assigned" });
    }

    const hasPermission = requiredPermissions.some((permission) =>
      userPermissions.includes(permission),
    );

    if (!hasPermission) {
      return res.status(403).json({ message: "Forbidden: permission denied" });
    }

    next();
  };
}

// export function requireRole(...allowedRoles: string[]) {
//   return (req: any, res: Response, next: NextFunction) => {
//     const roles = req.user?.roles || [];

//     if (!roles.length) {
//       return res.status(403).json({ message: "Forbidden: no roles assigned" });
//     }

//     const hasRole = roles.some((r: string) => allowedRoles.includes(r));

//     console.log("\n[ROLES]---------------->\N", roles);
//     console.log("\n[allowedRoles]---------------->\N", allowedRoles);
//     console.log("\n[hasRole]---------------->\N", hasRole);

//     if (!hasRole) {
//       return res.status(403).json({ message: "Forbidden: role denied" });
//     }
//     next();
//   };
// }

// export function requirePermission(permission: string) {
//   return async (req: any, res: Response, next: NextFunction) => {
//     const permissions = req.user?.permissions || [];
//     if (!permissions.includes(permission)) {
//       return res.status(403).json({ message: "Forbidden: permission denied" });
//     }
//     next();
//   };
// }
