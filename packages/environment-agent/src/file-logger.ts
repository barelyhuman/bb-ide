import { homedir } from "node:os";
import { join } from "node:path";
import { createRotatingJsonLineFileWriter } from "./rotating-file-logger.js";

const BEANBAG_ENVIRONMENT_AGENT_LOG_FILE = "BEANBAG_ENVIRONMENT_AGENT_LOG_FILE";
const DEFAULT_ENVIRONMENT_AGENT_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ENVIRONMENT_AGENT_LOG_MAX_FILES = 3;

function sanitizeSegment(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

export function resolveEnvironmentAgentLogFilePath(
  env: NodeJS.ProcessEnv,
): string {
  const configured = env[BEANBAG_ENVIRONMENT_AGENT_LOG_FILE]?.trim();
  if (configured) {
    return configured;
  }

  return join(
    homedir(),
    ".beanbag",
    "environment-agent-logs",
    sanitizeSegment(env.BB_PROJECT_ID),
    `${sanitizeSegment(env.BB_ENVIRONMENT_ID)}-${sanitizeSegment(env.BB_THREAD_ID)}.log`,
  );
}

export interface EnvironmentAgentFileLogger {
  readonly filePath: string;
  log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void;
}

export function createEnvironmentAgentFileLogger(
  filePath: string,
): EnvironmentAgentFileLogger {
  const writer = createRotatingJsonLineFileWriter({
    filePath,
    maxBytes: DEFAULT_ENVIRONMENT_AGENT_LOG_MAX_BYTES,
    maxFiles: DEFAULT_ENVIRONMENT_AGENT_LOG_MAX_FILES,
  });
  return {
    filePath: writer.filePath,
    log(level, message, meta) {
      writer.write({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(meta ? { meta } : {}),
      });
    },
  };
}
