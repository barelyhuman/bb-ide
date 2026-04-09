import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";
import { databaseConfig } from "../config/src/database.js";

const dbPath = resolve(databaseConfig.BB_DATABASE_URL);

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
