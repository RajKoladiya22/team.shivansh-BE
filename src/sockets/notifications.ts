import { Socket, Server } from "socket.io";

export default function notificationHandler(socket: Socket, io: Server) {
  socket.on("subscribe:notifications", (userId: string) => {
    socket.join(`notif:${userId}`);
  });
}
