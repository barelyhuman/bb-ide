import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commonConfig, serverConfig } from "@bb/config/server";
import { createLogger } from "@bb/logger";
import {
  sweepDestroyingEnvironments,
  sweepExpiredCommands,
  sweepExpiredLeases,
  sweepManagedEnvironments,
} from "@bb/db";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { maybeCleanupEnvironment } from "./services/environment-cleanup.js";
import { NotificationHub } from "./ws/hub.js";

const logger = createLogger({ component: "server" });
const db = initDb(serverConfig.BB_DATABASE_URL);
const hub = new NotificationHub();

const selfDir = dirname(fileURLToPath(import.meta.url));
const appDistDir = resolve(selfDir, "../../app/dist");
const staticDir =
  process.env.NODE_ENV === "production" && existsSync(appDistDir) ? appDistDir : undefined;

const { app, injectWebSocket } = createApp(
  {
    config: {
      authToken: commonConfig.BB_SECRET_TOKEN,
      dataDir: commonConfig.BB_DATA_DIR,
      hostDaemonPort: serverConfig.BB_HOST_DAEMON_PORT,
      inferenceModel: serverConfig.BB_INFERENCE_MODEL,
      openAiApiKey: serverConfig.OPENAI_API_KEY,
    },
    db,
    hub,
    logger,
  },
  { staticDir },
);

setInterval(() => {
  sweepExpiredCommands(db, hub);
  sweepExpiredLeases(db, hub);
  sweepDestroyingEnvironments(db, hub);
  for (const environment of sweepManagedEnvironments(db)) {
    void maybeCleanupEnvironment({ db, hub }, environment.id);
  }
}, 10_000).unref();

const server = serve({
  port: serverConfig.BB_SERVER_PORT,
  fetch: app.fetch,
});
injectWebSocket(server);

logger.info({ port: serverConfig.BB_SERVER_PORT }, "Server listening");
