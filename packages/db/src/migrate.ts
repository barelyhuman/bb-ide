import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbConnection } from "./connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run Drizzle migrations from the drizzle/ folder.
 * Resolves the migrations directory relative to this file so it works
 * from both src/ (via tsx) and dist/ (compiled).
 */
export function migrate(db: DbConnection): void {
  // From src/ or dist/, go up to packages/db/, then into drizzle/
  const migrationsFolder = resolve(__dirname, "..", "drizzle");
  drizzleMigrate(db, { migrationsFolder });
}
