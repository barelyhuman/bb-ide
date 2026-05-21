import { createConnection, migrate } from "@bb/db";
import type {
  DbConnection,
  MigrationWarningLogger,
  SlowDbQueryLogger,
} from "@bb/db";

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
  return db;
}
