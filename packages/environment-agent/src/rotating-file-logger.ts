import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

export interface RotatingJsonLineFileWriterOptions {
  filePath: string;
  maxBytes: number;
  maxFiles: number;
}

export interface RotatingJsonLineFileWriter {
  readonly filePath: string;
  write(entry: Record<string, unknown>): void;
}

function normalizeMaxBytes(value: number): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(value));
}

function normalizeMaxFiles(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function archivePath(filePath: string, index: number): string {
  return `${filePath}.${index}`;
}

function readFileSizeBytes(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function rotateFiles(filePath: string, maxFiles: number): void {
  if (!existsSync(filePath)) return;

  if (maxFiles <= 1) {
    rmSync(filePath, { force: true });
    return;
  }

  const oldestArchivePath = archivePath(filePath, maxFiles - 1);
  rmSync(oldestArchivePath, { force: true });

  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    const sourcePath = archivePath(filePath, index);
    if (!existsSync(sourcePath)) continue;
    const destinationPath = archivePath(filePath, index + 1);
    rmSync(destinationPath, { force: true });
    renameSync(sourcePath, destinationPath);
  }

  const firstArchivePath = archivePath(filePath, 1);
  rmSync(firstArchivePath, { force: true });
  renameSync(filePath, firstArchivePath);
}

export function createRotatingJsonLineFileWriter(
  options: RotatingJsonLineFileWriterOptions,
): RotatingJsonLineFileWriter {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  const maxFiles = normalizeMaxFiles(options.maxFiles);
  let currentSizeBytes = readFileSizeBytes(options.filePath);

  try {
    mkdirSync(dirname(options.filePath), { recursive: true });
  } catch {
    // Best-effort logging only.
  }

  return {
    filePath: options.filePath,
    write(entry) {
      const line = `${JSON.stringify(entry)}\n`;
      const lineBytes = Buffer.byteLength(line, "utf8");

      try {
        if (!existsSync(options.filePath) && currentSizeBytes !== 0) {
          currentSizeBytes = 0;
        }
        if (
          currentSizeBytes > 0 &&
          currentSizeBytes + lineBytes > maxBytes
        ) {
          rotateFiles(options.filePath, maxFiles);
          currentSizeBytes = 0;
        }
        appendFileSync(options.filePath, line, "utf8");
        currentSizeBytes += lineBytes;
      } catch {
        // Best-effort logging only.
      }
    },
  };
}
