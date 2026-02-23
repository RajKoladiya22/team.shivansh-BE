// // src/core/utils/socket/index.ts
// import http from "http";
// import { Server, Socket } from "socket.io";
// import { prisma } from "../../../config/database.config";
// import { validatedEnv } from "../../../config/validate-env";

// const env = validatedEnv; // object or function result

// let io: Server | null = null;

// export function initIo(server: http.Server) {
//   if (io) return io;

//   io = new Server(server, {
//     cors: {
//       origin: ["https://team.shivanshinfosys.in","http://localhost:5173"], // env.CLIENT_URL ?? "http://localhost:5173"
//       credentials: true,
//     },
//   });

//   io.on("connection", (socket: Socket) => {
//     console.log("🔌 socket connected:", socket.id);

//     /**
//      * Client sends USER.id
//      * Server resolves ACCOUNT.id and joins account-scoped room
//      */
//     socket.on("subscribe:notifications", async (userId: string) => {
//       try {
//         if (!userId) return;

//         const user = await prisma.user.findUnique({
//           where: { id: userId },
//           select: { accountId: true, username : true },
//         });

//         if (!user?.accountId) return;
//         // console.log("\n\n\nuser--->", user);

//         const room = `notif:${user.accountId}`;
//         socket.join(room);

//         // console.log("\n\n\nuser found for unsubscribe:", user);

//         console.log(`📡 socket ${socket.id} - User: ${user.username} - joined ${room}`);

//         socket.emit("subscription:ack", {
//           accountId: user.accountId,
//           socketId: socket.id,
//         });
//       } catch (err) {
//         console.error("subscribe:notifications error:", err);
//       }
//     });

//     socket.on("unsubscribe:notifications", async (userId: string) => {
//       try {
//         if (!userId) return;

//         const user = await prisma.user.findUnique({
//           where: { id: userId },
//           select: { accountId: true, username : true },
//         });

//         if (!user?.accountId) return;

//         const room = `notif:${user.accountId}`;
//         socket.leave(room);

//         console.log(`📡 socket ${socket.id}  - User: ${user.username} - left ${room}`);
//       } catch (err) {
//         console.error("unsubscribe:notifications error:", err);
//       }
//     });

//     socket.on("disconnect", (reason) => {
//       console.log("❌ socket disconnected:", socket.id, reason);
//     });
//   });

//   return io;
// }

// export function getIo(): Server {
//   if (!io) throw new Error("Socket.io not initialized");
//   return io;
// }

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

    // admin dashboard room
    // console.log(
    //   `📡 ${user.username} roles: ${
    //     user.roles?.map((r) => r.role.name).join(", ") || "No roles"
    //   }`,
    // );

    if (user.roles?.some((r) => r.role.name === "ADMIN")) {
      console.log(
        `\n📡 ${user.username} -> is an admin, joining leads:admin room\n`,
      );

      socket.join("leads:admin");
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
