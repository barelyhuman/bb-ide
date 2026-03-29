import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import { commonConfig } from "@bb/config/common";

export type { Logger };

const LOG_DIR = join(commonConfig.BB_DATA_DIR, "logs");
mkdirSync(LOG_DIR, { recursive: true });

const LOG_FORMAT = commonConfig.BB_LOG_FORMAT;

export type LoggerTransportMode = "stream" | "worker";

export interface CreateLoggerOptions {
  component: string;
  base?: Record<string, unknown>;
  transportMode?: LoggerTransportMode;
}

function sanitizeComponentName(component: string): string {
  const trimmed = component.trim();
  if (!trimmed) {
    throw new Error("Logger component is required");
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/gu, "-");
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const component = sanitizeComponentName(options.component);
  const loggerOptions = {
    level: commonConfig.BB_LOG_LEVEL,
    base: {
      component,
      ...(options.base ?? {}),
    },
    serializers: {
      err: pino.stdSerializers.errWithCause,
      error: pino.stdSerializers.errWithCause,
    },
  } satisfies pino.LoggerOptions;
  const transportMode = options.transportMode ?? "worker";

  if (transportMode === "stream") {
    // Sandboxed single-file bundles cannot resolve pino worker transports
    // from disk, so use a direct file destination instead.
    const destination = pino.destination(join(LOG_DIR, `${component}.log`));
    return pino(loggerOptions, destination);
  }

  const targets: pino.TransportTargetOptions[] = [
    {
      target: "pino-roll",
      options: {
        file: join(LOG_DIR, `${component}.log`),
        frequency: "daily",
        limit: { count: 5 },
        size: "10m",
      },
      level: commonConfig.BB_LOG_LEVEL,
    },
  ];

  if (LOG_FORMAT === "pretty") {
    targets.push({
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname",
        translateTime: "HH:MM:ss.l",
      },
      level: commonConfig.BB_LOG_LEVEL,
    });
  }

  const transport = pino.transport({ targets });

  return pino(loggerOptions, transport);
}
