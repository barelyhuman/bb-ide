import type { Logger } from "@bb/logger";
import type { DbConnection } from "@bb/db";
import type { NotificationHub } from "./ws/hub.js";

export interface ServerDeps {
  db: DbConnection;
  hub: NotificationHub;
  logger: Logger;
  secretToken: string;
  dataDir: string;
  hostDaemonPort: number;
  inferenceModel: string;
  openaiApiKey: string;
}
