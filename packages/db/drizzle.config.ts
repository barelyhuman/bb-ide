import { defineConfig } from "drizzle-kit";
import {
  resolveDataDirDatabasePath,
  resolveRuntimeDataDir,
  resolveRuntimeMode,
} from "@bb/config/runtime";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, "..", "..");
const runtimeMode = resolveRuntimeMode();
const dataDir = resolveRuntimeDataDir({
  env: process.env,
  homeDir: homedir(),
  mode: runtimeMode,
  repoRoot: runtimeMode === "dev" ? repoRoot : undefined,
});
const dbPath = resolve(resolveDataDirDatabasePath({ dataDir }));

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
