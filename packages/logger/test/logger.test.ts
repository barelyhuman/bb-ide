import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, getLogFilePath } from "../src/index.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-logger-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function readLogLines(filePath: string): Array<Record<string, unknown>> {
  const contents = fs.readFileSync(filePath, "utf8").trim();
  if (!contents) {
    return [];
  }

  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

describe("createLogger", () => {
  it("writes structured JSON to the component log file", () => {
    const dataDir = createTempDir();
    const logger = createLogger({
      component: "server",
      dataDir,
      level: "info",
      pretty: false,
    });

    logger.info({ requestId: "req_1" }, "booted");

    const entries = readLogLines(getLogFilePath({ dataDir, component: "server" }));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      component: "server",
      level: 30,
      msg: "booted",
      requestId: "req_1",
    });
  });

  it("keeps parent context on child loggers", () => {
    const dataDir = createTempDir();
    const logger = createLogger({
      component: "host-daemon",
      dataDir,
      pretty: false,
    });

    logger.child({ threadId: "thr_123" }).info("turn started");

    const entries = readLogLines(
      getLogFilePath({ dataDir, component: "host-daemon" }),
    );
    expect(entries[0]).toMatchObject({
      component: "host-daemon",
      threadId: "thr_123",
      msg: "turn started",
    });
  });

  it("rotates files when the active log exceeds the configured size", () => {
    const dataDir = createTempDir();
    const logger = createLogger({
      component: "server",
      dataDir,
      pretty: false,
      maxBytes: 160,
      maxFiles: 2,
    });

    logger.info({ payload: "x".repeat(120) }, "first");
    logger.info({ payload: "y".repeat(120) }, "second");
    logger.info({ payload: "z".repeat(120) }, "third");

    const baseFile = getLogFilePath({ dataDir, component: "server" });
    expect(fs.existsSync(baseFile)).toBe(true);
    expect(fs.existsSync(`${baseFile}.1`)).toBe(true);
  });

  it("mirrors pretty output in development without losing JSON logs", () => {
    const dataDir = createTempDir();
    const output = new PassThrough();
    const prettyLines: string[] = [];
    output.setEncoding("utf8");
    output.on("data", (chunk) => {
      prettyLines.push(chunk);
    });

    const logger = createLogger({
      component: "server",
      dataDir,
      pretty: true,
      prettyDestination: output,
    });

    logger.info("hello from dev");
    output.end();

    const entries = readLogLines(getLogFilePath({ dataDir, component: "server" }));
    expect(entries[0]?.msg).toBe("hello from dev");
    expect(prettyLines.join("")).toContain("hello from dev");
  });

  it("serializes nested error causes", () => {
    const dataDir = createTempDir();
    const logger = createLogger({
      component: "server",
      dataDir,
      pretty: false,
    });

    const error = new Error("outer", {
      cause: new Error("inner"),
    });

    logger.error({ err: error }, "request failed");

    const entries = readLogLines(getLogFilePath({ dataDir, component: "server" }));
    expect(entries[0]).toMatchObject({
      msg: "request failed",
      err: {
        message: "outer",
        cause: {
          message: "inner",
        },
      },
    });
  });
});
