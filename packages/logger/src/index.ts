import path from "node:path";
import pino, { multistream, type Logger } from "pino";
import pinoPretty from "pino-pretty";
import { commonConfig, type LogLevel } from "@bb/config/common";
import {
  serializeErrorWithCauses,
  type SerializedError,
} from "./error-serializer.js";
import { RotatingFileStream } from "./rotating-file-stream.js";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

export interface CreateLoggerOptions {
  component: string;
  dataDir?: string;
  level?: LogLevel;
  pretty?: boolean;
  prettyDestination?: NodeJS.WritableStream;
  maxBytes?: number;
  maxFiles?: number;
  base?: Record<string, unknown>;
}

export type BBLogger = Logger;

function shouldPrettyPrint(pretty: boolean | undefined): boolean {
  if (typeof pretty === "boolean") {
    return pretty;
  }

  const runtimeMode = process.env.BB_RUNTIME_MODE ?? process.env.NODE_ENV;
  return runtimeMode !== "production";
}

function sanitizeComponentName(component: string): string {
  const trimmed = component.trim();
  if (!trimmed) {
    throw new Error("Logger component is required");
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/gu, "-");
}

export function getLogFilePath(args: {
  dataDir: string;
  component: string;
}): string {
  return path.join(
    args.dataDir,
    "logs",
    `${sanitizeComponentName(args.component)}.log`,
  );
}

export function createLogger(options: CreateLoggerOptions): BBLogger {
  const component = sanitizeComponentName(options.component);
  const fileStream = new RotatingFileStream({
    filePath: getLogFilePath({
      dataDir: options.dataDir ?? commonConfig.dataDir,
      component,
    }),
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
  });

  const streams: Array<{ stream: NodeJS.WritableStream }> = [
    { stream: fileStream },
  ];

  if (shouldPrettyPrint(options.pretty)) {
    streams.push({
      stream: pinoPretty({
        colorize: false,
        destination: options.prettyDestination ?? process.stdout,
        ignore: "pid,hostname",
        translateTime: "SYS:standard",
      }),
    });
  }

  return pino(
    {
      level: options.level ?? commonConfig.logLevel,
      base: {
        component,
        ...(options.base ?? {}),
      },
      serializers: {
        err: serializeErrorWithCauses,
        error: serializeErrorWithCauses,
      },
    },
    multistream(streams),
  );
}

export {
  RotatingFileStream,
  serializeErrorWithCauses,
};
export type { SerializedError };
