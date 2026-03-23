import { envsafe, str } from "envsafe";
import { homedir } from "node:os";
import { join } from "node:path";

export const commonConfig = envsafe({
  BB_DATA_DIR: str({
    desc: "Root directory for all bb data (db, logs, host-id, etc.)",
    default: join(homedir(), ".bb"),
    devDefault: join(homedir(), ".bb"),
  }),
  BB_LOG_LEVEL: str({
    desc: "Log level: trace, debug, info, warn, error, fatal",
    default: "info",
    devDefault: "debug",
    choices: ["trace", "debug", "info", "warn", "error", "fatal"],
  }),
  BB_SECRET_TOKEN: str({
    desc: "Shared secret for daemon-server auth",
    default: "",
    devDefault: "dev-secret",
    allowEmpty: true,
  }),
});
