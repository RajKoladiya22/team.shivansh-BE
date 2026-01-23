import { Socket, Server } from "socket.io";

export default function callHandler(socket: Socket, io: Server) {
  socket.on("call:join", (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit("call:joined", socket.id);
  });

  socket.on("call:offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("call:offer", { sender: socket.id, offer });
  });

  socket.on("call:answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("call:answer", { sender: socket.id, answer });
  });

  socket.on("call:ice", ({ roomId, candidate }) => {
    socket.to(roomId).emit("call:ice", { sender: socket.id, candidate });
  });
}
