import { startHostDaemon } from "./start-host-daemon.js";

interface SandboxHealthConfig {
  path: string;
  port: number;
  value: string;
}

const DEFAULT_HEALTH_PATH = "/health";
const DEFAULT_HEALTH_PORT = 9111;
const DEFAULT_HEALTH_VALUE = "bb-host-daemon";

function parseHealthPort(rawPort: string | undefined): number {
  const parsed = Number.parseInt(rawPort ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_HEALTH_PORT;
}

function resolveSandboxHealthConfig(): SandboxHealthConfig {
  return {
    path: process.env.BB_DAEMON_HEALTH_PATH?.trim() || DEFAULT_HEALTH_PATH,
    port: parseHealthPort(process.env.BB_DAEMON_HEALTH_PORT),
    value: process.env.BB_DAEMON_HEALTH_VALUE?.trim() || DEFAULT_HEALTH_VALUE,
  };
}

async function main(): Promise<void> {
  const healthConfig = resolveSandboxHealthConfig();
  let daemon = null;
  try {
    daemon = await startHostDaemon({
      enableLocalApi: true,
      hostType: "ephemeral",
      localApiBindHost: "127.0.0.1",
      localApiHealthPath: healthConfig.path,
      localApiHealthValue: healthConfig.value,
      localApiMode: "health-only",
      localApiPort: healthConfig.port,
    });
    await daemon.waitUntilStopped();
  } catch (error) {
    await daemon?.shutdown("sandbox-entry-error").catch(() => undefined);
    throw error;
  }
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
