import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BEANBAG_ENVIRONMENT_AGENT_LOG_FILE = "BEANBAG_ENVIRONMENT_AGENT_LOG_FILE";

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
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // Best-effort logging only.
  }
  return {
    filePath,
    log(level, message, meta) {
      try {
        const entry = JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          message,
          ...(meta ? { meta } : {}),
        });
        appendFileSync(filePath, `${entry}\n`, "utf8");
      } catch {
        // Best-effort logging only.
      }
    },
  };
}
