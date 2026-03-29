import { Sandbox } from "e2b";
import type { Sandbox as E2BSandbox, SandboxOpts } from "e2b";
import pRetry from "p-retry";
import {
  DEFAULT_SANDBOX_CREATE_RETRIES,
  DEFAULT_SANDBOX_TEMPLATE,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  SANDBOX_DAEMON_HEALTH_PATH,
  SANDBOX_DAEMON_HEALTH_PORT,
  SANDBOX_DAEMON_HEALTH_RETRIES,
  SANDBOX_DAEMON_HEALTH_RETRY_MS,
  SANDBOX_DAEMON_PATH,
  SANDBOX_DATA_DIR,
} from "./constants.js";
import { buildFakeDaemonPayload } from "./fake-daemon.js";
import { createSandboxHost, resumeSandbox } from "./lifecycle.js";
import type {
  CreateSandboxOptions,
  ProvisionHostOptions,
  ResumeHostOptions,
  RunSandboxCommandOptions,
  SandboxBackgroundProcess,
  SandboxCommandResult,
  SandboxFileOptions,
  SandboxHost,
  StartBackgroundProcessOptions,
} from "./types.js";

interface DaemonEnvOptions {
  authToken: string;
  hostId: string;
  hostName: string;
  serverUrl: string;
}

function buildSandboxOptions(options: CreateSandboxOptions): SandboxOpts {
  return {
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.envs !== undefined ? { envs: options.envs } : {}),
    ...(options.lifecycle !== undefined ? { lifecycle: options.lifecycle } : {}),
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {}),
    timeoutMs: options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
  };
}

export async function createSandbox(
  options: CreateSandboxOptions = {},
): Promise<E2BSandbox> {
  const sandboxOptions = buildSandboxOptions(options);
  const template = options.template ?? DEFAULT_SANDBOX_TEMPLATE;

  return pRetry(
    async () =>
      template === DEFAULT_SANDBOX_TEMPLATE
        ? Sandbox.create(sandboxOptions)
        : Sandbox.create(template, sandboxOptions),
    { retries: DEFAULT_SANDBOX_CREATE_RETRIES },
  );
}

export async function writeSandboxFile(
  sandbox: E2BSandbox,
  path: string,
  content: string,
  options: SandboxFileOptions = {},
): Promise<void> {
  await sandbox.files.write(path, content, options);
}

export async function runSandboxCommand(
  sandbox: E2BSandbox,
  command: string,
  options: RunSandboxCommandOptions = {},
): Promise<SandboxCommandResult> {
  const result = await sandbox.commands.run(command, options);
  return result;
}

export async function startBackgroundProcess(
  sandbox: E2BSandbox,
  command: string,
  options: StartBackgroundProcessOptions = {},
): Promise<SandboxBackgroundProcess> {
  const result = await sandbox.commands.run(command, {
    ...options,
    background: true,
  });
  return result;
}

function buildDaemonEnv(options: DaemonEnvOptions): Record<string, string> {
  return {
    BB_DATA_DIR: SANDBOX_DATA_DIR,
    BB_HOST_ID: options.hostId,
    BB_HOST_NAME: options.hostName,
    BB_SECRET_TOKEN: options.authToken,
    BB_SERVER_URL: options.serverUrl,
  };
}

function buildDaemonHealthCommand(): string {
  return `curl -sf http://127.0.0.1:${SANDBOX_DAEMON_HEALTH_PORT}${SANDBOX_DAEMON_HEALTH_PATH}`;
}

async function assertDaemonHealth(sandbox: E2BSandbox): Promise<void> {
  const result = await runSandboxCommand(sandbox, buildDaemonHealthCommand());
  if (result.stdout.trim() !== "ok") {
    throw new Error(`Unexpected daemon health response: ${result.stdout}`);
  }
}

async function waitForDaemonHealth(sandbox: E2BSandbox): Promise<void> {
  await pRetry(
    async () => assertDaemonHealth(sandbox),
    {
      factor: 1,
      maxTimeout: SANDBOX_DAEMON_HEALTH_RETRY_MS,
      minTimeout: SANDBOX_DAEMON_HEALTH_RETRY_MS,
      retries: SANDBOX_DAEMON_HEALTH_RETRIES,
    },
  );
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/$/u, "");
}

async function startDaemonProcess(
  sandbox: E2BSandbox,
  daemonPayload: string,
  daemonEnv: Record<string, string>,
): Promise<void> {
  await writeSandboxFile(sandbox, SANDBOX_DAEMON_PATH, daemonPayload);
  await startBackgroundProcess(sandbox, `node ${SANDBOX_DAEMON_PATH}`, {
    envs: daemonEnv,
  });
}

function requireE2BSandboxType(sandboxType: string): void {
  if (sandboxType !== "e2b") {
    throw new Error(`Unsupported sandbox type: ${sandboxType}`);
  }
}

export async function provisionHost(
  options: ProvisionHostOptions,
): Promise<SandboxHost> {
  requireE2BSandboxType(options.sandboxType);
  const daemonEnv = buildDaemonEnv({
    authToken: options.authToken,
    hostId: options.hostId,
    hostName: options.hostName,
    serverUrl: normalizeServerUrl(options.serverUrl),
  });

  const sandbox = await createSandbox({
    apiKey: options.apiKey,
    envs: daemonEnv,
    lifecycle: { onTimeout: "pause" },
    template: options.template,
    timeoutMs: options.timeoutMs,
  });
  const daemonPayload = options.daemonPayload ?? buildFakeDaemonPayload();

  try {
    await startDaemonProcess(sandbox, daemonPayload, daemonEnv);
    await waitForDaemonHealth(sandbox);
    return createSandboxHost(sandbox, options.hostId);
  } catch (error) {
    try {
      await sandbox.kill();
    } catch {}
    throw error;
  }
}

export async function resumeHost(
  options: ResumeHostOptions,
): Promise<SandboxHost> {
  const daemonEnv = buildDaemonEnv({
    authToken: options.authToken,
    hostId: options.hostId,
    hostName: options.hostName,
    serverUrl: normalizeServerUrl(options.serverUrl),
  });
  const sandbox = await resumeSandbox(options.externalId, {
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
  });

  try {
    await writeSandboxFile(sandbox, SANDBOX_DAEMON_PATH, buildFakeDaemonPayload());
    try {
      await assertDaemonHealth(sandbox);
    } catch {
      await startBackgroundProcess(sandbox, `node ${SANDBOX_DAEMON_PATH}`, {
        envs: daemonEnv,
      });
      await waitForDaemonHealth(sandbox);
    }
    return createSandboxHost(sandbox, options.hostId);
  } catch (error) {
    try {
      await sandbox.kill();
    } catch {}
    throw error;
  }
}
