import { envsafe, str } from "envsafe";
import { join } from "node:path";
import { commonConfig } from "./common.js";

export const databaseConfig = envsafe({
  BB_DATABASE_URL: str({
    desc: "SQLite database path. Defaults to $BB_DATA_DIR/bb.db",
    default: join(commonConfig.BB_DATA_DIR, "bb.db"),
  }),
});
