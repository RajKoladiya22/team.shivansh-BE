// // src/sockets/index.ts

// import { io } from "../server";
// import chatHandler from "./chat";
// import notificationHandler from "./notifications";
// import callHandler from "./calls";

// io.on("connection", (socket) => {
//   console.log(`Socket connected: ${socket.id}`);

//   // Attach handlers
//   chatHandler(socket, io);
//   notificationHandler(socket, io);
//   callHandler(socket, io);

//   socket.on("disconnect", () => {
//     console.log(`Socket disconnected: ${socket.id}`);
//   });
// });
