// // // src/core/utils/socket/index.ts
// import { Server } from "socket.io";

// let io: Server | null = null;

// export function initIo(server: any) {
//   io = new Server(server, {
//     cors: {
//       origin: "http://localhost:5173",
//       credentials: true,
//     },
//   });

//   io.on("connection", (socket) => {
//     console.log("🔌 socket connected:", socket.id);

//     socket.on("subscribe:notifications", (userId: string) => {
//       if (!userId) return;

//       const room = `notif:${userId}`;
//       socket.join(room);

//       console.log(`📡 socket ${socket.id} joined ${room}`);
//     });

//     socket.on("disconnect", () => {
//       console.log("❌ socket disconnected:", socket.id);
//     });
//   });

//   return io;
// }

// export function getIo() {
//   if (!io) throw new Error("Socket.io not initialized");
//   return io;
// }

// src/core/utils/socket/index.ts
import http from "http";
import { Server, Socket } from "socket.io";
import { prisma } from "../../../config/database.config";
import { validatedEnv } from "../../../config/validate-env";

const env = validatedEnv; // object or function result

let io: Server | null = null;

export function initIo(server: http.Server) {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: ["https://team.shivanshinfosys.in","http://localhost:5173"], // env.CLIENT_URL ?? "http://localhost:5173"
      credentials: true,
    },
  });

  io.on("connection", (socket: Socket) => {
    console.log("🔌 socket connected:", socket.id);

    /**
     * Client sends USER.id
     * Server resolves ACCOUNT.id and joins account-scoped room
     */
    socket.on("subscribe:notifications", async (userId: string) => {
      try {
        if (!userId) return;

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { accountId: true },
        });

        if (!user?.accountId) return;

        const room = `notif:${user.accountId}`;
        socket.join(room);

        // console.log("\n\n\nuser found for unsubscribe:", user);

        console.log(`📡 socket ${socket.id} joined ${room}`);

        socket.emit("subscription:ack", {
          accountId: user.accountId,
          socketId: socket.id,
        });
      } catch (err) {
        console.error("subscribe:notifications error:", err);
      }
    });

    socket.on("unsubscribe:notifications", async (userId: string) => {
      try {
        if (!userId) return;

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { accountId: true },
        });

        
        

        if (!user?.accountId) return;

        const room = `notif:${user.accountId}`;
        socket.leave(room);

        console.log(`📡 socket ${socket.id} left ${room}`);
      } catch (err) {
        console.error("unsubscribe:notifications error:", err);
      }
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
