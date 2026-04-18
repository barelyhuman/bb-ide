import { describe, expect, it } from "vitest";
import { buildDaemonRestartCommand } from "../src/shared.js";

describe("standalone restart command", () => {
  it("reloads the env file without embedding provider secrets", () => {
    const command = buildDaemonRestartCommand({
      daemonPid: 123,
      daemonPort: 456,
      dataDir: "/tmp/bb root",
      entrypoint: "/repo/apps/host-daemon/dist/index.js",
      envFilePath: "/repo/.env",
      hostId: "host_123",
      logPath: "/tmp/bb logs/host-daemon.log",
      parentPid: 789,
      serverUrl: "http://127.0.0.1:3334",
    });

    expect(command).toContain("(kill '123' >/dev/null 2>&1 || true)");
    expect(command).toContain("[ ! -f '/repo/.env' ] || . '/repo/.env'");
    expect(command).toContain("BB_DATA_DIR='/tmp/bb root'");
    expect(command).toContain(
      "exec node '/repo/apps/host-daemon/dist/index.js'",
    );
    expect(command).toContain(">> '/tmp/bb logs/host-daemon.log' 2>&1) &");
    expect(command).toContain("'http://127.0.0.1:3334/api/v1/hosts'");
    expect(command).toContain(
      "'any(.[]; .id == \"host_123\" and .status == \"connected\")'",
    );
    expect(command).toContain('[ "$connected" = 1 ]');
    expect(command).not.toContain("&;");
    expect(command).not.toContain("do; if");
    expect(command).not.toContain("OPENAI_API_KEY");
    expect(command).not.toContain("ANTHROPIC_API_KEY");
  });

  it("uses a no-op env loader when no env file exists", () => {
    const command = buildDaemonRestartCommand({
      daemonPid: null,
      daemonPort: 456,
      dataDir: "/tmp/bb-root",
      entrypoint: "/repo/apps/host-daemon/dist/index.js",
      envFilePath: null,
      hostId: "host_123",
      logPath: "/tmp/host-daemon.log",
      parentPid: 789,
      serverUrl: "http://127.0.0.1:3334",
    });

    expect(command).toContain("(set -a; :; set +a;");
    expect(command).not.toContain("kill");
  });
});
