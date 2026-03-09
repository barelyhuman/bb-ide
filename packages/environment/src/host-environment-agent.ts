import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { EnvironmentAgentConnectionTarget } from "@beanbag/environment-agent";

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 500;
const STATE_VERSION = 1 as const;
const BEANBAG_DISABLE_MANAGED_ENVIRONMENT_AGENT =
  "BEANBAG_DISABLE_MANAGED_ENVIRONMENT_AGENT";

interface ManagedHostEnvironmentAgentRecord {
  version: typeof STATE_VERSION;
  pid: number;
  port: number;
  baseUrl: string;
  threadId: string;
  projectId: string;
  environmentId: string;
  workspaceRoot: string;
}

function sanitizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "environment";
}

function resolveStateFilePath(args: {
  projectId: string;
  threadId: string;
  environmentId: string;
}): string {
  return join(
    homedir(),
    ".beanbag",
    "environment-agents",
    sanitizeSegment(args.projectId),
    `${sanitizeSegment(args.environmentId)}-${sanitizeSegment(args.threadId)}.json`,
  );
}

function readRecord(args: {
  projectId: string;
  threadId: string;
  environmentId: string;
}): ManagedHostEnvironmentAgentRecord | undefined {
  const stateFilePath = resolveStateFilePath(args);
  if (!existsSync(stateFilePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<ManagedHostEnvironmentAgentRecord>;
    if (
      parsed.version !== STATE_VERSION ||
      typeof parsed.pid !== "number" ||
      typeof parsed.port !== "number" ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.threadId !== "string" ||
      typeof parsed.projectId !== "string" ||
      typeof parsed.environmentId !== "string" ||
      typeof parsed.workspaceRoot !== "string"
    ) {
      return undefined;
    }
    return parsed as ManagedHostEnvironmentAgentRecord;
  } catch {
    return undefined;
  }
}

function writeRecord(
  args: {
    projectId: string;
    threadId: string;
    environmentId: string;
  },
  record: ManagedHostEnvironmentAgentRecord,
): void {
  const stateFilePath = resolveStateFilePath(args);
  mkdirSync(dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, JSON.stringify(record, null, 2), "utf8");
}

function removeRecord(args: {
  projectId: string;
  threadId: string;
  environmentId: string;
}): void {
  rmSync(resolveStateFilePath(args), { force: true });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isManagedHostEnvironmentAgentDisabled(
  runtimeEnv: Record<string, string | undefined>,
): boolean {
  return runtimeEnv[BEANBAG_DISABLE_MANAGED_ENVIRONMENT_AGENT]?.trim().toLowerCase() === "true";
}

function pingEnvironmentAgent(baseUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const url = new URL("/control/status", baseUrl);
    const req = httpRequest(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
        },
      },
      (response) => {
        response.resume();
        resolvePromise(response.statusCode === 200);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolvePromise(false);
    });
    req.on("error", () => {
      resolvePromise(false);
    });
    req.end("{}");
  });
}

async function allocatePort(): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate environment-agent port")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(address.port);
      });
    });
  });
}

async function waitForEnvironmentAgent(baseUrl: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await pingEnvironmentAgent(baseUrl, HEALTH_TIMEOUT_MS)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for environment-agent at ${baseUrl}`);
}

function resolveEnvironmentAgentLaunchCommand(): {
  command: string;
  args: string[];
} {
  const localCliEntry = fileURLToPath(
    new URL("../../../apps/cli/dist/index.js", import.meta.url),
  );
  if (existsSync(localCliEntry)) {
    return {
      command: process.execPath,
      args: [localCliEntry],
    };
  }
  return {
    command: "bb",
    args: [],
  };
}

export async function ensureManagedHostEnvironmentAgent(args: {
  workspaceRootPath: string;
  threadId: string;
  projectId: string;
  environmentId: string;
  runtimeEnv: Record<string, string | undefined>;
}): Promise<void> {
  if (
    isManagedHostEnvironmentAgentDisabled(args.runtimeEnv) ||
    args.runtimeEnv.BEANBAG_ENVIRONMENT_AGENT_BASE_URL?.trim()
  ) {
    return;
  }

  const stateIdentity = {
    projectId: args.projectId,
    threadId: args.threadId,
    environmentId: args.environmentId,
  };
  const existing = readRecord(stateIdentity);
  if (existing) {
    if (
      isProcessAlive(existing.pid) &&
      existing.workspaceRoot === args.workspaceRootPath &&
      await pingEnvironmentAgent(existing.baseUrl, HEALTH_TIMEOUT_MS)
    ) {
      return;
    }
    if (isProcessAlive(existing.pid)) {
      try {
        process.kill(existing.pid, "SIGTERM");
      } catch {
        // Best-effort cleanup of stale managed agents.
      }
    }
    removeRecord(stateIdentity);
  }

  const port = await allocatePort();
  const { command, args: commandArgs } = resolveEnvironmentAgentLaunchCommand();
  const child = spawn(
    command,
    [
      ...commandArgs,
      "environment-agent",
      "--http-host",
      HOST,
      "--http-port",
      String(port),
    ],
    {
      cwd: args.workspaceRootPath,
      env: {
        ...process.env,
        ...args.runtimeEnv,
        BB_THREAD_ID: args.threadId,
        BB_PROJECT_ID: args.projectId,
        BB_ENVIRONMENT_ID: args.environmentId,
      },
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref?.();

  const baseUrl = `http://${HOST}:${port}`;
  await waitForEnvironmentAgent(baseUrl);
  writeRecord(stateIdentity, {
    version: STATE_VERSION,
    pid: child.pid!,
    port,
    baseUrl,
    threadId: args.threadId,
    projectId: args.projectId,
    environmentId: args.environmentId,
    workspaceRoot: args.workspaceRootPath,
  });
}

export function resolveManagedHostEnvironmentAgentTarget(args: {
  projectId: string;
  threadId: string;
  environmentId: string;
  runtimeEnv: Record<string, string | undefined>;
  providerLaunch?: EnvironmentAgentConnectionTarget["providerLaunch"];
}): EnvironmentAgentConnectionTarget | undefined {
  if (isManagedHostEnvironmentAgentDisabled(args.runtimeEnv)) {
    return undefined;
  }
  const record = readRecord(args);
  if (!record) {
    return undefined;
  }
  if (!isProcessAlive(record.pid)) {
    removeRecord(args);
    return undefined;
  }
  return {
    transport: "http",
    baseUrl: record.baseUrl,
    ...(args.providerLaunch ? { providerLaunch: args.providerLaunch } : {}),
  };
}

export async function disposeManagedHostEnvironmentAgent(args: {
  projectId: string;
  threadId: string;
  environmentId: string;
  runtimeEnv: Record<string, string | undefined>;
}): Promise<void> {
  if (
    isManagedHostEnvironmentAgentDisabled(args.runtimeEnv) ||
    args.runtimeEnv.BEANBAG_ENVIRONMENT_AGENT_BASE_URL?.trim()
  ) {
    return;
  }
  const stateIdentity = {
    projectId: args.projectId,
    threadId: args.threadId,
    environmentId: args.environmentId,
  };
  const existing = readRecord(stateIdentity);
  if (existing && isProcessAlive(existing.pid)) {
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      // Best-effort cleanup for already-exited processes.
    }
  }
  removeRecord(stateIdentity);
}
