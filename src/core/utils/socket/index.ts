// src/core/utils/socket/index.ts
import http from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../../../config/database.config";
import { validatedEnv } from "../../../config/validate-env";
import { env } from "../../../config/database.config";

const JWT_SECRET = env.JWT_ACCESS_TOKEN_SECRET!;

let io: Server | null = null;

export function initIo(server: http.Server) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: ["https://team.shivanshinfosys.in", "http://localhost:5173"],
      credentials: true,
    },
  });

  /**
   * AUTH MIDDLEWARE
   */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      // console.log("\n\n\nTOKEN-->\n", token);

      if (!token) return next(new Error("Unauthorized"));

      const decoded: any = jwt.verify(token, JWT_SECRET);

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          accountId: true,
          roles: {
            include: {
              role: true, // 👈 this is the important part
            },
          },
          username: true,
        },
      });

      // console.log("\n\n\nuser-->\n", user);

      if (!user) return next(new Error("Unauthorized"));

      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user;

    console.log("🔌 socket connected:", socket.id, user.username);

    /**
     * AUTO JOIN CORE ROOMS
     */

    // user lead room
    socket.join(`leads:user:${user.accountId}`);

    // Tasks
    socket.join(`tasks:user:${user.accountId}`);

    if (user.roles?.some((r) => r.role.name === "ADMIN")) {
      socket.join("leads:admin");
      socket.join("tasks:admin");

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
