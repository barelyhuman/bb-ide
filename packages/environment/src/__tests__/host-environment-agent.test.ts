import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __testOnly__resolveManagedHostEnvironmentAgentStateFilePath,
  ensureManagedHostEnvironmentAgent,
  resolveManagedHostEnvironmentAgentLaunchCommand,
  resolveManagedHostEnvironmentAgentTarget,
} from "../host-environment-agent.js";

const tempDirs: string[] = [];
const cleanupPaths: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-host-env-agent-"));
  tempDirs.push(dir);
  return dir;
}

function createDeferred() {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveManagedHostEnvironmentAgentTarget", () => {
  it("launches the standalone environment-agent artifact directly", () => {
    const artifactEntry = fileURLToPath(
      new URL("../../../environment-agent/dist/environment-agent.bundle.mjs", import.meta.url),
    );
    mkdirSync(dirname(artifactEntry), { recursive: true });
    if (!existsSync(artifactEntry)) {
      writeFileSync(artifactEntry, "console.log('agent')\n", "utf8");
    }

    expect(resolveManagedHostEnvironmentAgentLaunchCommand()).toEqual({
      command: process.execPath,
      args: [artifactEntry],
    });
  });

  it("returns an http target when a managed agent record exists", () => {
    vi.spyOn(process, "kill").mockImplementation((_pid: number, _signal?: string | number) => {
      return true;
    });

    const projectId = `project-${Date.now()}`;
    const workspaceRoot = makeTempDir();
    const stateDir = join(homedir(), ".beanbag", "environment-agents", projectId);
    cleanupPaths.push(stateDir);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      __testOnly__resolveManagedHostEnvironmentAgentStateFilePath({
        projectId,
        threadId: "thread-1",
        environmentId: "worktree",
        workspaceRootPath: workspaceRoot,
      }),
      JSON.stringify({
        version: 1,
        pid: 4321,
        port: 4123,
        baseUrl: "http://127.0.0.1:4123",
        authToken: "auth-token",
        threadId: "thread-1",
        projectId: "project-1",
        environmentId: "worktree",
        workspaceRoot,
      }),
      "utf8",
    );

    expect(
      resolveManagedHostEnvironmentAgentTarget({
        projectId,
        threadId: "thread-1",
        environmentId: "worktree",
        workspaceRootPath: workspaceRoot,
        runtimeEnv: {},
      }),
    ).toEqual({
      transport: "http",
      baseUrl: "http://127.0.0.1:4123",
      headers: {
        authorization: "Bearer auth-token",
      },
    });
  });

  it("coalesces concurrent managed agent startup for the same thread", async () => {
    const projectId = `project-${Date.now()}`;
    const workspaceRoot = makeTempDir();
    const statePath = __testOnly__resolveManagedHostEnvironmentAgentStateFilePath({
      projectId,
      threadId: "thread-1",
      environmentId: "worktree",
      workspaceRootPath: workspaceRoot,
    });
    cleanupPaths.push(join(homedir(), ".beanbag", "environment-agents", projectId));

    const waitGate = createDeferred();
    const spawnProcess = vi.fn(() => ({
      pid: 4321,
      unref: vi.fn(),
    })) as unknown as typeof import("node:child_process").spawn;

    const ensureArgs = {
      workspaceRootPath: workspaceRoot,
      threadId: "thread-1",
      projectId,
      environmentId: "worktree",
      runtimeEnv: {},
    };
    const deps = {
      allocatePort: async () => 4123,
      generateAuthToken: () => "auth-token",
      resolveLaunchCommand: () => ({
        command: process.execPath,
        args: ["agent.mjs"],
      }),
      spawnProcess,
      waitForAgent: async () => {
        await waitGate.promise;
      },
    };

    const first = ensureManagedHostEnvironmentAgent(ensureArgs, deps);
    const second = ensureManagedHostEnvironmentAgent(ensureArgs, deps);

    await Promise.resolve();
    await Promise.resolve();

    expect(spawnProcess).toHaveBeenCalledTimes(1);

    waitGate.resolve();
    await Promise.all([first, second]);

    expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({
      pid: 4321,
      port: 4123,
      authToken: "auth-token",
      threadId: "thread-1",
      projectId,
      environmentId: "worktree",
      workspaceRoot,
    });
  });
});
