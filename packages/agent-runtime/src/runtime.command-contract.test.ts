import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createCodexProviderAdapter } from "./codex/adapter.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import { fakeProviderScriptPath } from "./test/index.js";
import {
  createFakeAdapter,
  fullRuntimeOptions,
  waitForThreadTurnStarted,
} from "./test/runtime-test-harness.js";
import type { AgentRuntimeExecutionOptions } from "./types.js";

interface RuntimeLinkedWorktreeFixture {
  expectedWritableRoots: string[];
  workspacePath: string;
}

interface CreateRuntimeLinkedWorktreeFixtureArgs {
  rootPath: string;
}

function createRuntimeLinkedWorktreeFixture(
  args: CreateRuntimeLinkedWorktreeFixtureArgs,
): RuntimeLinkedWorktreeFixture {
  const rootPath = realpathSync.native(args.rootPath);
  const workspacePath = join(rootPath, "worktree");
  const commonDir = join(rootPath, "repo.git");
  const gitDir = join(commonDir, "worktrees", "bb1");
  const headRef = "refs/heads/bb/probe";
  const headRefParent = join(commonDir, "refs", "heads", "bb");
  const headLogParent = join(commonDir, "logs", "refs", "heads", "bb");

  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(join(commonDir, "objects"), { recursive: true });
  mkdirSync(headRefParent, { recursive: true });
  mkdirSync(headLogParent, { recursive: true });
  writeFileSync(join(workspacePath, ".git"), `gitdir: ${gitDir}\n`);
  writeFileSync(join(gitDir, "gitdir"), `${join(workspacePath, ".git")}\n`);
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  writeFileSync(join(gitDir, "HEAD"), `ref: ${headRef}\n`);

  return {
    expectedWritableRoots: [
      gitDir,
      join(commonDir, "objects"),
      headRefParent,
      headLogParent,
    ],
    workspacePath,
  };
}

describe("createAgentRuntime command contracts", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
    scriptPath = fakeProviderScriptPath;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes runtime workspace-write roots to adapter construction", async () => {
    let capturedAdditionalWorkspaceWriteRoots: readonly string[] | undefined;
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      additionalWorkspaceWriteRoots: [
        "/repo/.git/worktrees/bb13",
        "/repo/.git/objects",
      ],
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: (_providerId, options) => {
        capturedAdditionalWorkspaceWriteRoots =
          options.additionalWorkspaceWriteRoots;
        return createFakeAdapter(scriptPath);
      },
    });

    try {
      await runtime.ensureProvider({ providerId: "fake" });
      expect(capturedAdditionalWorkspaceWriteRoots).toEqual([
        "/repo/.git/worktrees/bb13",
        "/repo/.git/objects",
      ]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("preserves Codex captured linked-worktree git roots from start to turn/start", async () => {
    const fixture = createRuntimeLinkedWorktreeFixture({ rootPath: tmpDir });
    const providerScriptPath = join(tmpDir, "codex-runtime-provider.cjs");
    const turnStartLogPath = join(tmpDir, "turn-start.json");
    const workspaceWriteOptions = {
      ...fullRuntimeOptions,
      permissionEscalation: "ask",
      permissionMode: "workspace-write",
    } satisfies AgentRuntimeExecutionOptions;

    writeFileSync(
      providerScriptPath,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const turnStartLogPath = ${JSON.stringify(turnStartLogPath)};

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  if (message.method === "thread/start") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { thread: { id: "codex-thread-runtime" } },
    });
    return;
  }

  if (message.method === "turn/start") {
    fs.writeFileSync(turnStartLogPath, JSON.stringify(message.params), "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
`,
      "utf8",
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: fixture.workspacePath,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: (_providerId, options) =>
        createCodexProviderAdapter({
          additionalWorkspaceWriteRoots: options.additionalWorkspaceWriteRoots,
          processArgs: [providerScriptPath],
          processCommand: "node",
        }),
    });

    try {
      const { providerThreadId } = await runtime.startThread({
        environmentId: "env-1",
        options: workspaceWriteOptions,
        projectId: "p1",
        providerId: "codex",
        threadId: "t1",
      });

      expect(providerThreadId).toBe("codex-thread-runtime");

      await runtime.runTurn({
        input: [{ type: "text", text: "commit" }],
        options: workspaceWriteOptions,
        threadId: "t1",
      });

      expect(JSON.parse(readFileSync(turnStartLogPath, "utf8"))).toMatchObject({
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: fixture.expectedWritableRoots,
        },
        threadId: "codex-thread-runtime",
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects required adapter commands that return no-op plans", async () => {
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        buildCommandPlan(command) {
          if (command.type === "turn/start") {
            return { kind: "noop", reason: "turn start unsupported" };
          }
          return baseAdapter.buildCommandPlan(command);
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await expect(
      runtime.runTurn({
        threadId: "t1",
        input: [{ type: "text", text: "hello" }],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/returned no provider request for turn\/start/);
    await runtime.shutdown();
  });

  it("rejects no-op steer commands instead of silently dropping them", async () => {
    const events: ThreadEvent[] = [];
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        buildCommandPlan(command) {
          if (command.type === "turn/steer") {
            return { kind: "noop", reason: "steer unsupported" };
          }
          return baseAdapter.buildCommandPlan(command);
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      threadId: "t1",
      input: [{ type: "text", text: "delay:500" }],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
      turnId: "turn-1",
    });
    await expect(
      runtime.steerTurn({
        threadId: "t1",
        expectedTurnId: "turn-1",
        input: [{ type: "text", text: "steer" }],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/returned no provider request for turn\/steer/);
    await runtime.shutdown();
  });

  it("rejects unsupported thread rename instead of silently succeeding", async () => {
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        capabilities: {
          ...baseAdapter.capabilities,
          supportsRename: false,
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await expect(
      runtime.renameThread({ threadId: "t1", title: "New Title" }),
    ).rejects.toThrow(/does not support thread rename/);
    await runtime.shutdown();
  });

  it("rejects unsupported execution options before they reach adapters", async () => {
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await expect(
      runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "fake",
        options: {
          ...fullRuntimeOptions,
          serviceTier: "fast",
        },
      }),
    ).rejects.toThrow(/does not support service tiers/);
    await runtime.shutdown();
  });

  it("rejects no-op stop commands for active turns but allows explicit idle no-ops", async () => {
    const events: ThreadEvent[] = [];
    const baseAdapter = createFakeAdapter(scriptPath);
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => ({
        ...baseAdapter,
        buildCommandPlan(command) {
          if (command.type === "thread/stop") {
            return { kind: "noop", reason: "no active turn to stop" };
          }
          return baseAdapter.buildCommandPlan(command);
        },
      }),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.stopThread({ threadId: "t1" });

    await runtime.runTurn({
      threadId: "t1",
      input: [{ type: "text", text: "delay:500" }],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
      turnId: "turn-1",
    });
    await expect(runtime.stopThread({ threadId: "t1" })).rejects.toThrow(
      /returned no provider request for thread\/stop with active turn/,
    );

    await runtime.shutdown();
  });
});
