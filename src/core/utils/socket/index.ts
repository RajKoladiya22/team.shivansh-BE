// src/core/utils/socket/index.ts
import http from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "../../../config/database.config";
import { validatedEnv } from "../../../config/validate-env";
import { env } from "../../../config/database.config";

const JWT_SECRET = env.JWT_ACCESS_TOKEN_SECRET!;

let io: Server | null = null;

const allowedOrigins = [
  "https://team.shivanshinfosys.in",
  "https://customer.shivanshinfosys.in",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
];

export function initIo(server: http.Server) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          allowedOrigins.includes(origin) ||
          origin.endsWith(".shivanshinfosys.in") ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:")
        ) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    },
  });

  /**
   * DUAL AUTH MIDDLEWARE: Supports both Team Users (JWT) and Customers (Portal Token)
   */
  io.use(async (socket, next) => {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.token ||
        socket.handshake.query?.token;

      if (!rawToken || typeof rawToken !== "string") {
        return next(new Error("Unauthorized: Token missing"));
      }

      const token = rawToken.trim();

      // 1. Try Customer Portal Token (SHA-256 hash lookup in database)
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const portalToken = await prisma.customerPortalToken.findUnique({
        where: { tokenHash },
        include: {
          customer: true,
        },
      });

      if (portalToken && portalToken.isActive && portalToken.customer?.isActive) {
        if (portalToken.expiresAt && new Date(portalToken.expiresAt) < new Date()) {
          return next(new Error("Unauthorized: Portal link expired"));
        }
        socket.data.isCustomer = true;
        socket.data.customer = portalToken.customer;
        socket.data.portalToken = portalToken;
        return next();
      }

      // 2. Try Team Member JWT Token
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded?.id) {
          const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
              id: true,
              accountId: true,
              roles: {
                include: {
                  role: true,
                },
              },
              username: true,
            },
          });

          if (user) {
            socket.data.isCustomer = false;
            socket.data.user = user;
            return next();
          }
        }
      } catch (jwtErr) {
        // Not a valid team JWT
      }

      return next(new Error("Unauthorized: Invalid token"));
    } catch (err) {
      console.error("[SocketAuth] Error:", err);
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    // ── CUSTOMER CONNECTION ──────────────────────────────────
    if (socket.data.isCustomer && socket.data.customer) {
      const customer = socket.data.customer;
      console.log("🔌 Customer socket connected:", socket.id, customer.name);

      // Join core customer rooms
      socket.join(`customer:${customer.id}`);
      socket.join(`customer:notif:${customer.id}`);
      socket.join(`customer:support:${customer.id}`);
      socket.join("discovery:feed");

      socket.on("support:join", (supportId: string) => {
        if (!supportId) return;
        socket.join(`support:${supportId}`);
        console.log(`📡 Customer socket ${socket.id} joined support:${supportId}`);
      });

      socket.on("support:leave", (supportId: string) => {
        if (!supportId) return;
        socket.leave(`support:${supportId}`);
      });

      socket.on("discovery:join", (discoveryId: string) => {
        if (!discoveryId) return;
        socket.join(`discovery:comments:${discoveryId}`);
      });

      socket.on("discovery:leave", (discoveryId: string) => {
        if (!discoveryId) return;
        socket.leave(`discovery:comments:${discoveryId}`);
      });

      socket.on("disconnect", (reason) => {
        console.log("❌ Customer socket disconnected:", socket.id, customer.name, reason);
      });

      return;
    }

    // ── TEAM MEMBER CONNECTION ──────────────────────────────
    const user = socket.data.user;
    if (!user) return;

    console.log("🔌 Team socket connected:", socket.id, user.username);

    /**
     * AUTO JOIN CORE ROOMS
     */

    // user lead room
    socket.join(`leads:user:${user.accountId}`);

    // Tasks
    socket.join(`tasks:user:${user.accountId}`);

    // Supports
    socket.join(`supports:user:${user.accountId}`);

    if (user.roles?.some((r) => r.role.name === "ADMIN")) {
      socket.join("leads:admin");
      socket.join("tasks:admin");
      socket.join("supports:admin");

      console.log(
        `\n📡 ${user.username} -> is an admin, joining leads:admin room\n`,
      );
    }

    // notifications room
    socket.join(`notif:${user.accountId}`);

    console.log(
      `\n📡 ${user.username} -> joined leads:user room\n`
    );

    /**
     * JOIN SPECIFIC LEAD ROOM (for detail page)
     */
    socket.on("lead:join", (leadId: string) => {
      if (!leadId) return;
      socket.join(`lead:${leadId}`);
      console.log(`📡 ${socket.id} joined lead:${leadId}`);
    });

    socket.on("lead:leave", (leadId: string) => {
      socket.leave(`lead:${leadId}`);
    });

    /* ── TASK ROOM  (detail drawer / task page) ──────────────── */
    socket.on("task:join", (taskId: string) => {
      if (!taskId) return;
      socket.join(`task:${taskId}`);
      console.log(`📡 ${socket.id} joined task:${taskId}`);
    });

    socket.on("task:leave", (taskId: string) => {
      if (!taskId) return;
      socket.leave(`task:${taskId}`);
    });

    /* ── PROJECT ROOM (project detail page) ───────────────────── */
    socket.on("project:join", (projectId: string) => {
      if (!projectId) return;
      socket.join(`project:${projectId}`);
      console.log(`📡 ${socket.id} joined project:${projectId}`);
    });

    socket.on("project:leave", (projectId: string) => {
      if (!projectId) return;
      socket.leave(`project:${projectId}`);
      console.log(`📡 ${socket.id} left project:${projectId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log("❌ socket disconnected:", socket.id, reason);
    });
  });

  return io;
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
}
