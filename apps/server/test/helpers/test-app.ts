import { createConnection, migrate } from "@bb/db";
import type { DbConnection } from "@bb/db";
import { createApp } from "../../src/server.js";
import { NotificationHub } from "../../src/ws/hub.js";
import type { ServerDeps } from "../../src/deps.js";
import type { Logger } from "@bb/logger";

export interface TestApp {
  app: ReturnType<typeof createApp>;
  db: DbConnection;
  hub: NotificationHub;
  deps: ServerDeps;
}

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLogger,
  level: "silent",
} as unknown as Logger;

export function createTestApp(overrides?: Partial<ServerDeps>): TestApp {
  const db = createConnection(":memory:");
  migrate(db);
  const hub = new NotificationHub();

  const deps: ServerDeps = {
    db,
    hub,
    logger: noopLogger,
    secretToken: "test-secret",
    dataDir: "/tmp/bb-test",
    hostDaemonPort: 3001,
    inferenceModel: "openai/gpt-4o-mini",
    openaiApiKey: "",
    ...overrides,
  };

  const app = createApp(deps);

  return { app, db, hub, deps };
}
