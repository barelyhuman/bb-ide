import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

export interface RotatingFileStreamOptions {
  filePath: string;
  maxBytes: number;
  maxFiles: number;
}

function rotatedPath(filePath: string, index: number): string {
  return `${filePath}.${index}`;
}

export class RotatingFileStream extends Writable {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;

  private currentSize: number;

  constructor(options: RotatingFileStreamOptions) {
    super();

    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles;

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.currentSize = fs.existsSync(this.filePath)
      ? fs.statSync(this.filePath).size
      : 0;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (this.currentSize + buffer.byteLength > this.maxBytes) {
        this.rotate();
      }

      fs.appendFileSync(this.filePath, buffer);
      this.currentSize += buffer.byteLength;
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  private rotate(): void {
    const lastArchive = rotatedPath(this.filePath, this.maxFiles);
    if (fs.existsSync(lastArchive)) {
      fs.rmSync(lastArchive, { force: true });
    }

    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source = rotatedPath(this.filePath, index);
      if (!fs.existsSync(source)) {
        continue;
      }

      fs.renameSync(source, rotatedPath(this.filePath, index + 1));
    }

    if (fs.existsSync(this.filePath)) {
      fs.renameSync(this.filePath, rotatedPath(this.filePath, 1));
    }

    this.currentSize = 0;
  }
}
