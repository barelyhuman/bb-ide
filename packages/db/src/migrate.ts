import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbConnection } from "./connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SqliteClient = {
  pragma: (sql: string) => Array<Record<string, unknown>> | unknown;
  exec: (sql: string) => unknown;
};

function getSqliteClient(db: DbConnection): SqliteClient | null {
  const sqlite = (db as { $client?: SqliteClient }).$client;
  return sqlite ?? null;
}

/**
 * Run Drizzle migrations from the drizzle/ folder.
 * Resolves the migrations directory relative to this file so it works
 * from both src/ (via tsx) and dist/ (compiled).
 */
export function migrate(db: DbConnection): void {
  // From src/ or dist/, go up to packages/db/, then into drizzle/
  const migrationsFolder = resolve(__dirname, "..", "drizzle");
  const sqlite = getSqliteClient(db);

  // Drizzle runs SQLite migrations in a transaction; toggle FK checks before it
  // starts so table rebuild migrations can safely drop referenced tables.
  sqlite?.pragma?.("foreign_keys = OFF");
  try {
    drizzleMigrate(db, { migrationsFolder });
    repairCriticalSchema(sqlite);
  } finally {
    sqlite?.pragma?.("foreign_keys = ON");
  }
}

function repairCriticalSchema(sqlite: SqliteClient | null): void {
  if (!sqlite) return;

  ensureColumn(sqlite, "threads", "provider_id", [
    "ALTER TABLE `threads` ADD COLUMN `provider_id` text NOT NULL DEFAULT 'codex'",
  ]);
  ensureColumn(sqlite, "threads", "type", [
    "ALTER TABLE `threads` ADD COLUMN `type` text NOT NULL DEFAULT 'standard'",
  ]);
  ensureColumn(sqlite, "projects", "primary_manager_thread_id", [
    "ALTER TABLE `projects` ADD COLUMN `primary_manager_thread_id` text",
    "CREATE INDEX IF NOT EXISTS `projects_primary_manager_thread_idx` ON `projects` (`primary_manager_thread_id`)",
  ]);
}

function ensureColumn(
  sqlite: SqliteClient,
  tableName: "threads" | "projects",
  columnName: string,
  repairSql: string[],
): void {
  const columnRows = sqlite.pragma(`table_info(\`${tableName}\`)`);
  const columns = Array.isArray(columnRows) ? columnRows : [];
  const hasColumn = columns.some((row) => {
    const name = row?.name;
    return typeof name === "string" && name === columnName;
  });
  if (hasColumn) return;

  for (const statement of repairSql) {
    sqlite.exec(statement);
  }
}
