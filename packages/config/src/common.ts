import os from "node:os";
import path from "node:path";
import { envsafe, str } from "envsafe";

export const logLevelValues = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type LogLevel = (typeof logLevelValues)[number];

export interface CommonConfig {
  dataDir: string;
  logsDir: string;
  logLevel: LogLevel;
  secretToken: string;
}

function resolveHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function defaultDataDir(env: NodeJS.ProcessEnv): string {
  const legacyRoot = env.BB_ROOT?.trim();
  if (legacyRoot) {
    return legacyRoot;
  }

  return "~/.bb";
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  const runtimeMode = env.BB_RUNTIME_MODE?.trim().toLowerCase();
  if (runtimeMode) {
    return runtimeMode === "production";
  }

  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

export function readCommonConfig(env: NodeJS.ProcessEnv = process.env): CommonConfig {
  const production = isProduction(env);
  const parsed = envsafe(
    {
      BB_DATA_DIR: str({ default: defaultDataDir(env) }),
      BB_LOG_LEVEL: str({
        choices: [...logLevelValues],
        default: production ? "info" : "debug",
      }),
      BB_SECRET_TOKEN: production
        ? str()
        : str({ default: "bb-dev-secret-token" }),
    },
    { env },
  );

  const dataDir = path.resolve(resolveHomePath(parsed.BB_DATA_DIR));

  return {
    dataDir,
    logsDir: path.join(dataDir, "logs"),
    logLevel: parsed.BB_LOG_LEVEL as LogLevel,
    secretToken: parsed.BB_SECRET_TOKEN,
  };
}

export const commonConfig = readCommonConfig();
