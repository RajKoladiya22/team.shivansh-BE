// src/server.ts
import http from "http";
import { envConfiguration } from "./config/env.config";
import { validatedEnv } from "./config/validate-env";
import app from "./app";
import { shutdownDb } from "./config/database.config";
import { logger } from "./core/help/logs/logger";
import { initWebPush } from "./config/webpush.config";
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
initWebPush();
import { initIo } from "./core/utils/socket";

initIo(httpServer);

import { sendSuccessResponse } from "./core/utils/httpResponse";

httpServer.listen(env.PORT, () => {
  logger.info(
    `🚀 Server listening on http://localhost:${env.PORT} - [${env.NODE_ENV}]`,
  );
  logger.info(`🌐 Socket.io server is also running`);
});

// Graceful shutdown helper
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn(`Already shutting down - ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;
  logger.info(`${signal} received: closing HTTP server`);
  // stop accepting new connections
  httpServer.close(async (err?: Error) => {
    if (err) {
      logger.error("Error closing HTTP server:", err);
      process.exit(1);
    }
    try {
      await shutdownDb();
      logger.info("Database disconnected, exiting.");
      process.exit(0);
    } catch (e) {
      logger.error("Error during DB shutdown:", e);
      process.exit(1);
    }
  });

  // force exit after timeout
  setTimeout(() => {
    logger.warn("Forcing shutdown after timeout");
    process.exit(1);
  }, 30_000).unref();
}

// Signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Uncaught/unhandled
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err);
  // attempt graceful shutdown then exit
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
  // optional: gracefulShutdown("unhandledRejection");
});
