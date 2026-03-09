import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { formatWithOptions } from "node:util";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

interface ConsoleMethodEntry {
  (...args: unknown[]): void;
}

function serializeArgs(args: unknown[]): string {
  return formatWithOptions(
    {
      colors: false,
      depth: 6,
      breakLength: Infinity,
      compact: true,
    },
    ...args,
  );
}

function writeLogLine(filePath: string, level: ConsoleMethod, args: unknown[]): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message: serializeArgs(args),
  });
  appendFileSync(filePath, `${entry}\n`, "utf8");
}

export function installConsoleFileLogger(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console) as ConsoleMethodEntry;
    console[level] = ((...args: unknown[]) => {
      try {
        writeLogLine(filePath, level, args);
      } catch {
        // Logging must never break daemon startup or request handling.
      }
      original(...args);
    }) as ConsoleMethodEntry;
  }
}
