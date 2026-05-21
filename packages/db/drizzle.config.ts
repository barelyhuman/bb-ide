import { defineConfig } from "drizzle-kit";
import { DEFAULTS } from "@bb/config/defaults";
import {
  resolveConfiguredDataDir,
  resolveDataDirDatabasePath,
} from "@bb/config/data-dir";
import { resolve } from "node:path";

const defaultDataDirName =
  process.env.NODE_ENV === "production"
    ? DEFAULTS.dataDir.prod
    : DEFAULTS.dataDir.dev;
const dataDir = resolveConfiguredDataDir({
  defaultDirName: defaultDataDirName,
  env: process.env,
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
