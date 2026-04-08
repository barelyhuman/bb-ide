import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  HOST_AUTH_FILE_NAME,
  hostAuthStateSchema,
  normalizeServerUrl,
} from "../../packages/host-daemon-contract/src/index.ts";
import {
  createSandbox,
  resumeSandbox,
  runSandboxCommand,
  writeSandboxFile,
} from "../../packages/sandbox-host/src/index.ts";
import { loadSandboxDaemonArtifacts } from "../../packages/sandbox-host/src/daemon-artifacts.ts";
import {
  SANDBOX_BB_EXECUTABLE_PATH,
  SANDBOX_DATA_DIR,
  SANDBOX_DAEMON_HEALTH_PATH,
  SANDBOX_DAEMON_HEALTH_PORT,
  SANDBOX_DAEMON_HEALTH_RESPONSE,
} from "../../packages/sandbox-host/src/constants.ts";
import {
  buildSandboxDaemonEnv,
  startSandboxDaemon,
} from "../../packages/sandbox-host/src/provision.ts";
import { resolveSandboxImageTemplate } from "../../packages/sandbox-image/src/index.ts";
import {
  createHostJoin,
  killProcess,
  loadDotEnv,
  reservePort,
  startQuickTunnel,
  startQaServer,
  waitFor,
} from "./shared.mjs";

const SMOKE_TIMEOUT_MS = 5 * 60 * 1000;
const SANDBOX_HOST_AUTH_PATH = `${SANDBOX_DATA_DIR}/${HOST_AUTH_FILE_NAME}`;

type SmokeSandbox = Awaited<ReturnType<typeof createSandbox>>;

interface SmokeHostIdentity {
  hostId: string;
  hostName: string;
}

interface SmokeHostJoin {
  hostId: string;
  joinCode: string;
}

interface PersistedHostAuthExpectation {
  hostId: string;
  serverUrl: string;
}

interface StartRealDaemonOptions {
  enrollKey?: string;
  hostId: string;
  hostName: string;
  serverUrl: string;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function createSmokeHostIdentity(): SmokeHostIdentity {
  return {
    hostId: "host_e2b_smoke",
    hostName: "e2b-smoke",
  };
}

async function waitForCommandSuccess(
  runCommand: () => Promise<void>,
  label: string,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runCommand();
      return;
    } catch (error) {
      lastError = error;
      await delay(2_000);
    }
  }

  throw new Error(`${label} never became ready: ${formatError(lastError)}`);
}

async function waitForPublicServerHealth(
  sandbox: SmokeSandbox,
  publicUrl: string,
): Promise<void> {
  const healthUrl = new URL("/health", publicUrl).toString();
  await waitForCommandSuccess(
    async () => {
      const result = await runSandboxCommand(
        sandbox,
        `curl -sf ${shellQuote(healthUrl)}`,
      );
      if (!result.stdout.includes('"ok"')) {
        throw new Error(`Unexpected public server health response: ${result.stdout}`);
      }
    },
    "sandbox to real server connectivity",
  );
}

async function waitForDaemonHealth(
  sandbox: SmokeSandbox,
): Promise<void> {
  await waitForCommandSuccess(
    async () => {
      const result = await runSandboxCommand(
        sandbox,
        `curl -sf http://127.0.0.1:${SANDBOX_DAEMON_HEALTH_PORT}${SANDBOX_DAEMON_HEALTH_PATH}`,
      );
      if (result.stdout.trim() !== SANDBOX_DAEMON_HEALTH_RESPONSE) {
        throw new Error(`Unexpected daemon health response: ${result.stdout}`);
      }
    },
    "bundled daemon health check",
  );
}

async function waitForPersistedHostAuth(
  sandbox: SmokeSandbox,
  expectation: PersistedHostAuthExpectation,
): Promise<void> {
  const expectedServerUrl = normalizeServerUrl(expectation.serverUrl);

  await waitForCommandSuccess(
    async () => {
      const result = await runSandboxCommand(
        sandbox,
        `cat ${shellQuote(SANDBOX_HOST_AUTH_PATH)}`,
      );
      const persistedAuth = hostAuthStateSchema.parse(JSON.parse(result.stdout));
      if (persistedAuth.hostId !== expectation.hostId) {
        throw new Error(`Unexpected persisted host ID: ${persistedAuth.hostId}`);
      }
      if (persistedAuth.hostType !== "ephemeral") {
        throw new Error(`Unexpected persisted host type: ${persistedAuth.hostType}`);
      }
      if (persistedAuth.serverUrl !== expectedServerUrl) {
        throw new Error(`Unexpected persisted server URL: ${persistedAuth.serverUrl}`);
      }
    },
    "persisted host auth",
  );
}

async function assertBundledBbCli(
  sandbox: SmokeSandbox,
): Promise<void> {
  const result = await runSandboxCommand(
    sandbox,
    `${shellQuote(SANDBOX_BB_EXECUTABLE_PATH)} --version`,
  );
  if (!/^\d+\.\d+\.\d+$/u.test(result.stdout.trim())) {
    throw new Error(`Unexpected bb version output: ${result.stdout}`);
  }
}

async function createEphemeralHostJoin(
  localServerUrl: string,
  hostId: string,
): Promise<SmokeHostJoin> {
  const response = await createHostJoin(localServerUrl, {
    hostId,
    hostType: "ephemeral",
  });

  if (response == null || typeof response !== "object") {
    throw new Error("Host join response was not an object");
  }

  const joinCode = Reflect.get(response, "joinCode");
  const responseHostId = Reflect.get(response, "hostId");
  if (typeof joinCode !== "string" || joinCode.trim().length === 0) {
    throw new Error("Host join response was missing joinCode");
  }
  if (responseHostId !== hostId) {
    throw new Error(`Host join response host ID did not match ${hostId}`);
  }

  return {
    hostId,
    joinCode,
  };
}

async function waitForConnectedSmokeHost(
  localServerUrl: string,
  hostId: string,
): Promise<void> {
  await waitFor(
    async () => {
      try {
        const response = await fetch(`${localServerUrl}/api/v1/hosts/${hostId}`);
        if (!response.ok) {
          return null;
        }

        const host = await response.json();
        return host?.status === "connected" ? host : null;
      } catch {
        return null;
      }
    },
    {
      timeoutMs: 15_000,
      description: `host ${hostId} connection`,
    },
  );
}

async function startRealDaemon(
  sandbox: SmokeSandbox,
  options: StartRealDaemonOptions,
): Promise<void> {
  const daemonArtifacts = await loadSandboxDaemonArtifacts();
  const daemonEnv = buildSandboxDaemonEnv({
    daemonEnv: {},
    ...(options.enrollKey ? { enrollKey: options.enrollKey } : {}),
    hostId: options.hostId,
    hostName: options.hostName,
    serverUrl: normalizeServerUrl(options.serverUrl),
  });

  await startSandboxDaemon({
    sandbox,
    daemonArtifacts,
    daemonEnv,
  });
}

async function main(): Promise<void> {
  await loadDotEnv();

  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is required");
  }

  const smokeHost = createSmokeHostIdentity();
  const serverPort = await reservePort();
  const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "bb-e2b-smoke-"));
  const logsDir = path.join(tmpRoot, "logs");
  const serverDataDir = path.join(tmpRoot, "server-data");
  const serverLogPath = path.join(logsDir, "server.log");
  const tunnelLogPath = path.join(logsDir, "tunnel.log");

  await fs.mkdir(logsDir, { recursive: true });

  const tunnel = await startQuickTunnel({
    logPath: tunnelLogPath,
    port: serverPort,
  });
  const publicUrl = tunnel.publicUrl;
  const qaServer = await startQaServer({
    dataDir: serverDataDir,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test-openai-key",
    },
    logPath: serverLogPath,
    port: serverPort,
    publicUrl,
  });
  const localServerUrl = qaServer.serverUrl;
  let activeSandbox: SmokeSandbox | null = null;

  try {
    console.log(`Started quick tunnel at ${publicUrl}`);
    console.log(`Started real server at ${localServerUrl}`);

    console.log("Creating sandbox");
    const sandbox = await createSandbox({
      timeoutMs: SMOKE_TIMEOUT_MS,
    });
    activeSandbox = sandbox;

    console.log(`Created sandbox ${sandbox.sandboxId}`);

    console.log("Writing /tmp/hello.txt");
    await writeSandboxFile(sandbox, "/tmp/hello.txt", "hello from bb");

    console.log("Reading /tmp/hello.txt");
    const helloResult = await runSandboxCommand(sandbox, "cat /tmp/hello.txt");
    if (helloResult.stdout.trim() !== "hello from bb") {
      throw new Error(`Unexpected hello output: ${helloResult.stdout}`);
    }

    console.log("Checking Node.js availability");
    const nodeResult = await runSandboxCommand(sandbox, "node --version");
    if (!nodeResult.stdout.trim().startsWith("v")) {
      throw new Error(`Unexpected node version output: ${nodeResult.stdout}`);
    }

    const templateId = resolveSandboxImageTemplate();
    console.log(`Checking template tools for ${templateId}`);
    await runSandboxCommand(sandbox, "codex --version");
    await runSandboxCommand(sandbox, "git --version");
    await runSandboxCommand(sandbox, "gh --version");

    console.log(`Checking sandbox to server connectivity via ${publicUrl}`);
    await waitForPublicServerHealth(sandbox, publicUrl);

    console.log("Requesting real ephemeral host join material");
    const join = await createEphemeralHostJoin(localServerUrl, smokeHost.hostId);

    console.log("Starting real bundled daemon");
    await startRealDaemon(sandbox, {
      enrollKey: join.joinCode,
      hostId: smokeHost.hostId,
      hostName: smokeHost.hostName,
      serverUrl: publicUrl,
    });
    await waitForDaemonHealth(sandbox);

    console.log("Waiting for real server to mark the host connected");
    await waitForConnectedSmokeHost(localServerUrl, smokeHost.hostId);

    console.log("Checking persisted daemon auth");
    await waitForPersistedHostAuth(sandbox, {
      hostId: smokeHost.hostId,
      serverUrl: publicUrl,
    });

    console.log("Checking bundled bb CLI");
    await assertBundledBbCli(sandbox);

    console.log("Pausing sandbox");
    await sandbox.pause();

    console.log("Resuming sandbox");
    const resumedSandbox = await resumeSandbox(sandbox.sandboxId, {
      timeoutMs: SMOKE_TIMEOUT_MS,
    });
    activeSandbox = resumedSandbox;

    console.log("Checking real daemon after resume");
    try {
      await waitForDaemonHealth(resumedSandbox);
    } catch {
      console.log("Real daemon did not survive pause, restarting it");
      await startRealDaemon(resumedSandbox, {
        hostId: smokeHost.hostId,
        hostName: smokeHost.hostName,
        serverUrl: publicUrl,
      });
      await waitForDaemonHealth(resumedSandbox);
    }

    console.log("Checking bundled bb CLI after resume");
    await assertBundledBbCli(resumedSandbox);
  } finally {
    console.log("Destroying sandbox");
    await activeSandbox?.kill().catch((error) => {
      console.error(`Failed to destroy sandbox: ${formatError(error)}`);
    });

    await killProcess(tunnel.process?.pid).catch((error) => {
      console.error(`Failed to stop smoke tunnel: ${formatError(error)}`);
    });
    await killProcess(qaServer.process?.pid).catch((error) => {
      console.error(`Failed to stop QA server: ${formatError(error)}`);
    });
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch((error) => {
      console.error(`Failed to remove smoke temp dir: ${formatError(error)}`);
    });
  }
}

void main().then(
  () => {
    console.log("E2B smoke test passed");
  },
  (error) => {
    console.error("E2B smoke test failed");
    console.error(formatError(error));
    process.exitCode = 1;
  },
);
