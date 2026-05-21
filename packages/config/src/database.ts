import { commonConfig } from "./common.js";
import { resolveDataDirDatabasePath } from "./data-dir.js";

export const databaseConfig = {
  databasePath: resolveDataDirDatabasePath({
    dataDir: commonConfig.BB_DATA_DIR,
  }),
};
