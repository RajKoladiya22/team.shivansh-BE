import { Socket, Server } from "socket.io";

export default function chatHandler(socket: Socket, io: Server) {
  socket.on("join:chat", (roomId: string) => {
    socket.join(roomId);
  });

  socket.on("chat:message", ({ roomId, message }) => {
    io.to(roomId).emit("chat:message", {
      sender: socket.id,
      message,
      timestamp: new Date(),
    });
  });

  socket.on("typing", (roomId: string) => {
    socket.to(roomId).emit("typing", socket.id);
  });
}
