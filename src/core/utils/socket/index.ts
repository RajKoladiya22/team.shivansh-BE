// // src/core/utils/socket/index.ts
import { Server } from "socket.io";

let io: Server | null = null;

export function initIo(server: any) {
  io = new Server(server, {
    cors: {
      origin: "http://localhost:5173",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("🔌 socket connected:", socket.id);

    socket.on("subscribe:notifications", (accountId: string) => {
      if (!accountId) return;

      const room = `notif:${accountId}`;
      socket.join(room);

      console.log(`📡 socket ${socket.id} joined ${room}`);
    });

    socket.on("disconnect", () => {
      console.log("❌ socket disconnected:", socket.id);
    });
  });

  return io;
}

export function getIo() {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
}
