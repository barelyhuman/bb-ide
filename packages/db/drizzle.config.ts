import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { resolve } from "node:path";

const defaultDbPath = resolve(homedir(), ".beanbag", "beanbag.db");
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
