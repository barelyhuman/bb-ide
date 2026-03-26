import { serve } from "@hono/node-server";
import { createLogger } from "@bb/logger";
import { commonConfig } from "@bb/config/common";
import { serverConfig } from "@bb/config/server";
import { sweepExpiredCommands, sweepExpiredLeases } from "@bb/db";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { NotificationHub } from "./ws/hub.js";
import type { ServerDeps } from "./deps.js";

const logger = createLogger({ component: "server" });

const db = initDb(serverConfig.BB_DATABASE_URL);
const hub = new NotificationHub();

const deps: ServerDeps = {
  db,
  hub,
  logger,
  secretToken: commonConfig.BB_SECRET_TOKEN,
  dataDir: commonConfig.BB_DATA_DIR,
  hostDaemonPort: serverConfig.BB_SERVER_PORT,
  inferenceModel: serverConfig.BB_INFERENCE_MODEL,
  openaiApiKey: serverConfig.OPENAI_API_KEY,
};

const app = createApp(deps);

// Periodic sweeps
const SWEEP_INTERVAL_MS = 15_000;
const sweepTimer = setInterval(() => {
  try {
    const commandResult = sweepExpiredCommands(db, hub);
    if (commandResult.requeued > 0 || commandResult.errored > 0) {
      logger.info(commandResult, "command sweep");
    }
    const leaseResult = sweepExpiredLeases(db, hub);
    if (leaseResult.sessionsClosed > 0 || leaseResult.threadsErrored > 0) {
      logger.info(leaseResult, "lease sweep");
    }
  } catch (err) {
    logger.error({ err }, "sweep failed");
  }
}, SWEEP_INTERVAL_MS);

const server = serve(
  { fetch: app.fetch, port: serverConfig.BB_SERVER_PORT },
  (info) => {
    logger.info({ port: info.port }, "server started");
  },
);

function shutdown() {
  logger.info("shutting down");
  clearInterval(sweepTimer);
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { createApp } from "./server.js";
export type { ServerDeps } from "./deps.js";
export { ApiError } from "./errors.js";
export { initDb } from "./db.js";
export { NotificationHub } from "./ws/hub.js";
