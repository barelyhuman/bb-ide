import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { resolve } from "node:path";

function expandHomeDirectory(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

function resolveBeanbagRoot(): string {
  const configuredRoot = (process.env.BB_ROOT ?? process.env.BEANBAG_ROOT)?.trim();
  if (!configuredRoot) {
    return resolve(homedir(), ".beanbag");
  }
  return resolve(expandHomeDirectory(configuredRoot));
}

const defaultDbPath = resolve(resolveBeanbagRoot(), "beanbag.db");
const dbPath = process.env.BEANBAG_DB_PATH
  ? resolve(process.env.BEANBAG_DB_PATH)
  : defaultDbPath;

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
