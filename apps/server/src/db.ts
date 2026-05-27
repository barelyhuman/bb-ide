import { createConnection, migrate } from "@bb/db";
import type {
  DbConnection,
  MigrationWarningLogger,
  SlowDbQueryLogger,
} from "@bb/db";
import { ensurePersonalProjectBootstrap } from "./services/projects/personal-project.js";

export type InitDbLogger = MigrationWarningLogger & SlowDbQueryLogger;

export interface InitDbOptions {
  logger?: InitDbLogger;
}

export function initDb(
  databasePath: string,
  options: InitDbOptions = {},
): DbConnection {
  const db = createConnection(databasePath, {
    slowQueryLogger: options.logger,
  });
  migrate(db, { logger: options.logger });
  ensurePersonalProjectBootstrap(db);
  return db;
}
