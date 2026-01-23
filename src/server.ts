// // src/server.ts
// import { envConfiguration } from "./config/env.config";
// import { validatedEnv } from "./config/validate-env";
// import app from "./app";
// import { shutdownDb } from "./config/database.config";
// import { logger } from "./core/help/logs/logger";
// import { sendSuccessResponse } from "./core/utils/httpResponse";
// require('module-alias/register');

// envConfiguration();
// const env = validatedEnv;

// app.get("/", (req, res) => {
//   sendSuccessResponse(res, 200, "Base route is working", {
//     timestamp: new Date(),
//   });
// });

// const server = app.listen(env.PORT, () => {
//   logger.info(
//     `🚀 Server listening on http://localhost:${env.PORT} - [${env.NODE_ENV}]`
//   );
// });

// // Graceful shutdown
// process.on("SIGINT", async () => {
//   logger.info("SIGINT received: closing HTTP server");
//   server.close(async () => {
//     await shutdownDb();
//     logger.info("Database disconnected, exiting.");
//     process.exit(0);
//   });
// });
// process.on("SIGTERM", () => process.exit(0));

// src/server.ts
import http from "http";
import { envConfiguration } from "./config/env.config";
import { validatedEnv } from "./config/validate-env";
import app from "./app";
import { shutdownDb } from "./config/database.config";
import { logger } from "./core/help/logs/logger";
require("module-alias/register");

envConfiguration();
const env = validatedEnv;

// Create HTTP server from Express
const httpServer = http.createServer(app);

app.get("/", (req, res) => {
  sendSuccessResponse(res, 200, "Base route is working", {
    timestamp: new Date(),
  });
});

// Socket.IO setup
import { Server as SocketIOServer } from "socket.io";
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

// Load socket event handlers
import "./sockets";
import { sendSuccessResponse } from "./core/utils/httpResponse";

httpServer.listen(env.PORT, () => {
  logger.info(
    `🚀 Server listening on http://localhost:${env.PORT} - [${env.NODE_ENV}]`
  );
  logger.info(`🌐 Socket.io server is also running`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("SIGINT received: closing HTTP server");
  httpServer.close(async () => {
    await shutdownDb();
    logger.info("Database disconnected, exiting.");
    process.exit(0);
  });
});

process.on("SIGTERM", () => process.exit(0));
