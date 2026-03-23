import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCliConfig } from "../src/cli.js";
import { readCommonConfig } from "../src/common.js";
import { readHostDaemonConfig } from "../src/host-daemon.js";
import { readServerConfig } from "../src/server.js";

describe("readCommonConfig", () => {
  it("defaults BB_DATA_DIR to ~/.bb and derives log paths from it", () => {
    const config = readCommonConfig({});

    expect(config.dataDir).toBe(path.join(os.homedir(), ".bb"));
    expect(config.logsDir).toBe(path.join(os.homedir(), ".bb", "logs"));
    expect(config.logLevel).toBe("debug");
    expect(config.secretToken).toBe("bb-dev-secret-token");
  });

  it("requires BB_SECRET_TOKEN in production", () => {
    expect(() => readCommonConfig({ BB_RUNTIME_MODE: "production" })).toThrow(
      /BB_SECRET_TOKEN/u,
    );
  });

  it("accepts the legacy BB_ROOT override during migration", () => {
    const config = readCommonConfig({ BB_ROOT: "/tmp/bb-root" });

    expect(config.dataDir).toBe("/tmp/bb-root");
    expect(config.logsDir).toBe("/tmp/bb-root/logs");
  });
});

describe("consumer-specific config", () => {
  it("builds server defaults from the shared data directory", () => {
    const config = readServerConfig({ BB_DATA_DIR: "/tmp/bb-data" });

    expect(config.port).toBe(3334);
    expect(config.databaseUrl).toBe("/tmp/bb-data/server.sqlite");
    expect(config.e2bApiKey).toBeUndefined();
  });

  it("requires a valid server URL for the daemon and CLI", () => {
    expect(readHostDaemonConfig({ BB_SERVER_URL: "http://localhost:9999" }).serverUrl).toBe(
      "http://localhost:9999",
    );
    expect(readCliConfig({ BB_SERVER_URL: "http://localhost:9999" }).serverUrl).toBe(
      "http://localhost:9999",
    );
    expect(() => readCliConfig({ BB_SERVER_URL: "not-a-url" })).toThrow(
      /BB_SERVER_URL/u,
    );
  });
});
