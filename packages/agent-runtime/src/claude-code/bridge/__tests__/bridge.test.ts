import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanUseTool, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionEscalation } from "@bb/domain";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import { buildSessionOptions, handleLine } from "../bridge.js";
import type { ClaudePermissionMode } from "../../interactive-contract.js";
import { listClaudeCodeBridgeModels } from "../model-list.js";
import { createBridgeJsonRpcTestHarness } from "../../../test/bridge-json-rpc-test-helpers.js";

type BridgeSessionOptions = ReturnType<typeof buildSessionOptions>;
type BridgeSessionHooks = NonNullable<BridgeSessionOptions["hooks"]>;
type BridgePreToolUseHooks = NonNullable<BridgeSessionHooks["PreToolUse"]>;
type BridgePreToolUseHook = BridgePreToolUseHooks[number]["hooks"][number];

interface ReadonlyBashHookArgs {
  command: string;
  hook: BridgePreToolUseHook;
}

interface AllowedReadonlyBashCase {
  command: string;
  expectedCommand: string;
}

interface DeniedReadonlyBashCase {
  command: string;
}

interface CanUseToolPolicyAllowExpectation {
  behavior: "allow";
  updatedInput: Record<string, unknown>;
}

interface CanUseToolPolicyDenyExpectation {
  behavior: "deny";
  messageIncludes: string;
}

type CanUseToolPolicyExpectation =
  | CanUseToolPolicyAllowExpectation
  | CanUseToolPolicyDenyExpectation;

interface CanUseToolPolicyCase {
  blockedPath?: string;
  decisionReason?: string;
  expected: CanUseToolPolicyExpectation;
  id: string;
  input: Record<string, unknown>;
  name: string;
  permissionEscalation: PermissionEscalation | null;
  permissionMode: ClaudePermissionMode;
  toolName: string;
}

interface ControlledClaudeQuery {
  close: ReturnType<typeof vi.fn>;
  finish(): void;
  initializationResult: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
}

interface ClaudeQueryCallOptions {
  canUseTool?: CanUseTool;
}

interface ClaudeQueryCall {
  options: ClaudeQueryCallOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClaudeQueryCall(value: unknown): value is ClaudeQueryCall {
  if (!isRecord(value) || !isRecord(value.options)) {
    return false;
  }
  return (
    value.options.canUseTool === undefined ||
    typeof value.options.canUseTool === "function"
  );
}

function getLastCanUseTool(): CanUseTool {
  const latestCall = queryMock.mock.calls.at(-1)?.[0];
  if (!isClaudeQueryCall(latestCall) || !latestCall.options.canUseTool) {
    throw new Error("Expected Claude SDK query to receive canUseTool");
  }
  return latestCall.options.canUseTool;
}

function invokeReadonlyBashHook(args: ReadonlyBashHookArgs) {
  return args.hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: args.command,
        description: "Permission boundary test",
      },
      tool_use_id: "tool-1",
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/tmp/worktree",
    },
    "tool-1",
    { signal: new AbortController().signal },
  );
}

function createControlledClaudeQuery(): ControlledClaudeQuery {
  let finishNext: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  const iterator: AsyncIterator<SDKMessage> = {
    next: () =>
      new Promise<IteratorResult<SDKMessage>>((resolve) => {
        finishNext = resolve;
      }),
    return: async () => ({ value: undefined, done: true }),
  };
  return {
    close: vi.fn(),
    finish() {
      if (!finishNext) {
        throw new Error("Expected Claude query iterator to be waiting");
      }
      finishNext({ value: undefined, done: true });
      finishNext = undefined;
    },
    initializationResult: vi.fn(),
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

describe("bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReturnValue({
      initializationResult: vi.fn().mockResolvedValue({
        account: {},
        models: [
          {
            value: "default",
            displayName: "Default (recommended)",
            description:
              "Opus 4.7 with 1M context [NEW] · Most capable for complex work",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "claude-haiku-4-5",
            displayName: "Haiku",
            description: "Haiku 4.5",
          },
          {
            value: "claude-sonnet-4-6",
            displayName: "Sonnet",
            description: "Sonnet 4.6 · Best for everyday tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
          {
            value: "claude-sonnet-4-6[1m]",
            displayName: "Sonnet (1M context)",
            description: "Sonnet 4.6 with 1M context · Billed as extra usage",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
        ],
      }),
      close: vi.fn(),
    });
  });

  it("keeps manager sessions on a plain string system prompt", () => {
    const options = buildSessionOptions(
      {
        baseInstructions: "You are a manager.",
        cwd: "/tmp/worktree",
        instructionMode: "replace",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.tools).toBeUndefined();
    expect(options.cwd).toBe("/tmp/worktree");
    expect(options.systemPrompt).toBe("You are a manager.");
  });

  it("leaves standard sessions on the default Claude tool preset", () => {
    const options = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        reasoningLevel: "xhigh",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );

    expect(options.tools).toBeUndefined();
    expect(options.cwd).toBe("/tmp/worktree");
    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "You are a coder.",
    });
    expect(options.effort).toBe("xhigh");
    expect(options.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
    });
  });

  it("passes the resolved Claude permission mode through to the session", () => {
    const options = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "dontAsk",
      },
      {},
    );

    expect(options.permissionMode).toBe("dontAsk");
  });

  it("configures workspace-write sessions with Claude sandbox settings", () => {
    const askOptions = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "acceptEdits",
      },
      {},
    );
    const denyOptions = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
      },
      {},
    );

    expect(askOptions.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: true,
    });
    expect(denyOptions.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    });
  });

  it("configures workspace-write sessions with additional writable roots", () => {
    const options = buildSessionOptions(
      {
        additionalWorkspaceWriteRoots: [
          "/repo/.git/worktrees/bb13",
          "/repo/.git/objects",
        ],
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
      },
      {},
    );

    expect(options.additionalDirectories).toEqual([
      "/repo/.git/worktrees/bb13",
      "/repo/.git/objects",
    ]);
    expect(options.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: ["/repo/.git/worktrees/bb13", "/repo/.git/objects"],
      },
    });
  });

  it("configures readonly sessions with PreToolUse policy hooks", async () => {
    const askOptions = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
      },
      {},
    );
    const denyOptions = buildSessionOptions(
      {
        baseInstructions: "You are a coder.",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "dontAsk",
      },
      {},
    );

    const askHook = askOptions.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!askHook) {
      throw new Error("Expected readonly ask PreToolUse hook");
    }
    const allowedReadonlyBashCases = [
      { command: "pwd", expectedCommand: "pwd" },
      { command: "pwd -P", expectedCommand: "pwd -P" },
      { command: "pwd -L", expectedCommand: "pwd -L" },
      {
        command: "git status --short",
        expectedCommand: "git --no-optional-locks status --short",
      },
      {
        command: "git --no-optional-locks status --short",
        expectedCommand: "git --no-optional-locks status --short",
      },
      {
        command: "git --no-pager status --short",
        expectedCommand: "git --no-optional-locks --no-pager status --short",
      },
      {
        command: "git diff --stat main...HEAD",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv --stat main...HEAD",
      },
      {
        command: "git diff -U3 -- package.json",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv -U3 -- package.json",
      },
      {
        command: "git diff -- file.txt",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv -- file.txt",
      },
      {
        command: "git diff -- --no-ext-diff --no-textconv package.json",
        expectedCommand:
          "git --no-optional-locks diff --no-ext-diff --no-textconv -- --no-ext-diff --no-textconv package.json",
      },
      {
        command: "git show --stat --oneline -1 HEAD",
        expectedCommand:
          "git --no-optional-locks show --no-ext-diff --no-textconv --stat --oneline -1 HEAD",
      },
      {
        command: "git show HEAD -- --no-ext-diff --no-textconv package.json",
        expectedCommand:
          "git --no-optional-locks show --no-ext-diff --no-textconv HEAD -- --no-ext-diff --no-textconv package.json",
      },
      {
        command: "git merge-base main HEAD",
        expectedCommand: "git --no-optional-locks merge-base main HEAD",
      },
      {
        command: "git log --oneline --max-count=1",
        expectedCommand:
          "git --no-optional-locks log --no-ext-diff --no-textconv --oneline --max-count=1",
      },
      {
        command: "git log -- --no-ext-diff --no-textconv package.json",
        expectedCommand:
          "git --no-optional-locks log --no-ext-diff --no-textconv -- --no-ext-diff --no-textconv package.json",
      },
      {
        command: "git branch --show-current",
        expectedCommand: "git --no-optional-locks branch --show-current",
      },
      {
        command: "git branch --list bb/probe",
        expectedCommand: "git --no-optional-locks branch --list bb/probe",
      },
      {
        command: "git branch --merged main",
        expectedCommand: "git --no-optional-locks branch --merged main",
      },
      {
        command: "git ls-files --modified -- package.json",
        expectedCommand:
          "git --no-optional-locks ls-files --modified -- package.json",
      },
      {
        command: "git rev-parse --show-toplevel",
        expectedCommand: "git --no-optional-locks rev-parse --show-toplevel",
      },
      {
        command: "git grep -n TODO -- package.json",
        expectedCommand: "git --no-optional-locks grep -n TODO -- package.json",
      },
      {
        command: "git blame -L1,5 package.json",
        expectedCommand: "git --no-optional-locks blame -L1,5 package.json",
      },
    ] satisfies AllowedReadonlyBashCase[];
    for (const testCase of allowedReadonlyBashCases) {
      await expect(
        invokeReadonlyBashHook({
          command: testCase.command,
          hook: askHook,
        }),
      ).resolves.toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            command: testCase.expectedCommand,
            description: "Permission boundary test",
          },
        },
      });
    }

    const deniedReadonlyBashCases = [
      { command: "git add package.json" },
      { command: "git reset -- package.json" },
      { command: "git commit -m probe" },
      { command: "git checkout main" },
      { command: "git switch main" },
      { command: "git restore package.json" },
      { command: "git clean -fd" },
      { command: "git apply patch.diff" },
      { command: "git update-index --refresh" },
      { command: "git stash" },
      { command: "git fetch origin" },
      { command: "git pull" },
      { command: "git push" },
      { command: "git branch bb-probe" },
      { command: "git branch --merged main extra" },
      { command: "git -c core.pager=cat status --short" },
      { command: "git -C /tmp status" },
      { command: "git --git-dir=/tmp/repo status" },
      { command: "git diff -- ../etc/passwd" },
      { command: "git diff -- /etc/passwd" },
      { command: "git diff --textconv -- file.txt" },
      { command: "git show --ext-diff HEAD" },
      { command: "git grep -n TODO -- /etc/passwd" },
      { command: "git blame /etc/passwd" },
      { command: "GIT_DIR=/tmp/repo git status" },
      { command: "VAR=1 git diff --stat" },
      { command: "env FOO=bar git status" },
      { command: "git status --short; cat /tmp/secret" },
      { command: "git status --short && cat /tmp/secret" },
      { command: "git status --short | cat" },
      { command: "git status --short > /tmp/out" },
      { command: "git status --short $(cat /tmp/secret)" },
      { command: "git status --short `cat /tmp/secret`" },
      { command: "git blame --contents /tmp/secret package.json" },
      { command: "git blame --contents=/tmp/secret package.json" },
      { command: "git grep -f /tmp/pattern TODO" },
      { command: "git log --output=/tmp/log" },
      { command: "git show --output=/tmp/out HEAD" },
      { command: "pwd package.json" },
    ] satisfies DeniedReadonlyBashCase[];
    for (const testCase of deniedReadonlyBashCases) {
      await expect(
        invokeReadonlyBashHook({
          command: testCase.command,
          hook: askHook,
        }),
      ).resolves.toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      });
    }

    await expect(
      askHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Agent",
          tool_input: {},
          tool_use_id: "tool-1",
          session_id: "session-1",
          transcript_path: "/tmp/transcript.jsonl",
          cwd: "/tmp/worktree",
        },
        "tool-1",
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ continue: true });

    const preToolUseHook = denyOptions.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!preToolUseHook) {
      throw new Error("Expected readonly PreToolUse hook");
    }
    await expect(
      preToolUseHook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: {
            command: "git reset -- package.json",
          },
          tool_use_id: "tool-1",
          session_id: "session-1",
          transcript_path: "/tmp/transcript.jsonl",
          cwd: "/tmp/worktree",
        },
        "tool-1",
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
  });

  describe("readonly Bash canUseTool policy", () => {
    const policyCases = [
      {
        id: "default-status-rewrite",
        name: "default readonly rewrites safe Git status",
        permissionMode: "default",
        permissionEscalation: "ask",
        toolName: "Bash",
        decisionReason: "This command requires approval",
        input: {
          command: "git status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "allow",
          updatedInput: {
            command: "git --no-optional-locks status --short",
            description: "Permission boundary test",
          },
        },
      },
      {
        id: "dontask-status-allow",
        name: "dontAsk readonly allows safe Git status",
        permissionMode: "dontAsk",
        permissionEscalation: "deny",
        toolName: "Bash",
        decisionReason: "This command requires approval",
        input: {
          command: "git --no-optional-locks status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "allow",
          updatedInput: {
            command: "git --no-optional-locks status --short",
            description: "Permission boundary test",
          },
        },
      },
      {
        id: "dontask-mutating-bash-deny",
        name: "dontAsk readonly denies mutating Bash",
        permissionMode: "dontAsk",
        permissionEscalation: "deny",
        toolName: "Bash",
        blockedPath: "/tmp/project/package.json",
        input: {
          command: "git add package.json",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "deny",
          messageIncludes: "bb readonly mode allows reading and analysis only",
        },
      },
      {
        id: "dontask-read-deny",
        name: "dontAsk readonly does not auto-allow non-Bash tools",
        permissionMode: "dontAsk",
        permissionEscalation: "deny",
        toolName: "Read",
        blockedPath: "/tmp/project/package.json",
        input: { file_path: "/tmp/project/package.json" },
        expected: {
          behavior: "deny",
          messageIncludes: "bb readonly mode allows reading and analysis only",
        },
      },
      {
        id: "workspace-write-deny",
        name: "workspace-write does not use readonly Bash auto-allow",
        permissionMode: "acceptEdits",
        permissionEscalation: "deny",
        toolName: "Bash",
        blockedPath: "/tmp/project",
        input: {
          command: "git status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "deny",
          messageIncludes: "bb workspace-write mode allows work inside",
        },
      },
      {
        id: "full-bypass-allow",
        name: "full bypass does not rewrite via readonly Bash auto-allow",
        permissionMode: "bypassPermissions",
        permissionEscalation: null,
        toolName: "Bash",
        decisionReason: "This command requires approval",
        input: {
          command: "git status --short",
          description: "Permission boundary test",
        },
        expected: {
          behavior: "allow",
          updatedInput: {
            command: "git status --short",
            description: "Permission boundary test",
          },
        },
      },
    ] satisfies CanUseToolPolicyCase[];

    it.each(policyCases)("$name", async (testCase) => {
      const bridge = createBridgeJsonRpcTestHarness(handleLine);
      const queries: ControlledClaudeQuery[] = [];
      queryMock.mockImplementation(() => {
        const query = createControlledClaudeQuery();
        queries.push(query);
        return query;
      });

      try {
        const startRequestId = 1;
        const stopRequestId = startRequestId + 1;
        const threadId = `thread-readonly-bash-policy-${testCase.id}`;
        const toolUseID = `tool-readonly-policy-${testCase.id}`;
        bridge.sendRequest(startRequestId, "thread/start", {
          baseInstructions: "test",
          cwd: "/tmp/worktree",
          instructionMode: "append",
          permissionEscalation: testCase.permissionEscalation,
          permissionMode: testCase.permissionMode,
          threadId,
        });
        await bridge.waitForResponse(startRequestId);

        const canUseTool = getLastCanUseTool();
        const result = await canUseTool(testCase.toolName, testCase.input, {
          blockedPath: testCase.blockedPath,
          decisionReason: testCase.decisionReason,
          signal: new AbortController().signal,
          toolUseID,
        });

        switch (testCase.expected.behavior) {
          case "allow":
            expect(result).toMatchObject({
              behavior: "allow",
              toolUseID,
              updatedInput: testCase.expected.updatedInput,
            });
            expect("decisionClassification" in result).toBe(false);
            break;
          case "deny":
            if (result.behavior !== "deny") {
              throw new Error(`Expected ${testCase.name} to deny`);
            }
            expect(result.toolUseID).toBe(toolUseID);
            expect(result.message).toContain(testCase.expected.messageIncludes);
            break;
        }

        bridge.sendRequest(stopRequestId, "thread/stop", { threadId });
        await bridge.flushWork();
        queries[0]?.finish();
        await bridge.waitForResponse(stopRequestId);
      } finally {
        bridge.restore();
      }
    });
  });

  it("returns the bridge-owned Claude model list from the SDK probe", async () => {
    await expect(listClaudeCodeBridgeModels()).resolves.toEqual([
      expect.objectContaining({
        id: "claude-opus-4-7[1m]",
        model: "claude-opus-4-7[1m]",
        displayName: "Opus 4.7 (1M)",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "claude-opus-4-7",
        model: "claude-opus-4-7",
        displayName: "Opus 4.7",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-opus-4-6[1m]",
        model: "claude-opus-4-6[1m]",
        displayName: "Opus 4.6 (1M)",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-opus-4-6",
        model: "claude-opus-4-6",
        displayName: "Opus 4.6",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-sonnet-4-6[1m]",
        model: "claude-sonnet-4-6[1m]",
        displayName: "Sonnet 4.6 (1M)",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-sonnet-4-6",
        model: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "claude-haiku-4-5",
        model: "claude-haiku-4-5",
        displayName: "Haiku 4.5",
        isDefault: false,
      }),
    ]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("passes thread/start reasoningLevel through to Claude SDK effort and thinking display", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        reasoningLevel: "xhigh",
        threadId: "thread-reasoning",
      });
      await bridge.waitForResponse(1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            effort: "xhigh",
            thinking: {
              type: "adaptive",
              display: "summarized",
            },
          }),
        }),
      );

      bridge.sendRequest(2, "thread/stop", { threadId: "thread-reasoning" });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("passes thread/start additional workspace-write roots to Claude SDK options", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        additionalWorkspaceWriteRoots: [
          "/repo/.git/worktrees/bb13",
          "/repo/.git/objects",
        ],
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
        threadId: "thread-roots",
      });
      await bridge.waitForResponse(1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            additionalDirectories: [
              "/repo/.git/worktrees/bb13",
              "/repo/.git/objects",
            ],
            sandbox: expect.objectContaining({
              filesystem: {
                allowWrite: ["/repo/.git/worktrees/bb13", "/repo/.git/objects"],
              },
            }),
          }),
        }),
      );

      bridge.sendRequest(2, "thread/stop", { threadId: "thread-roots" });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("passes thread/resume additional workspace-write roots to Claude SDK options", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/resume", {
        additionalWorkspaceWriteRoots: [
          "/repo/.git/worktrees/bb13",
          "/repo/.git/objects",
        ],
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "deny",
        permissionMode: "acceptEdits",
        providerThreadId: "provider-thread-roots",
        threadId: "thread-resume-roots",
      });
      await bridge.waitForResponse(1);

      expect(queryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            additionalDirectories: [
              "/repo/.git/worktrees/bb13",
              "/repo/.git/objects",
            ],
            sandbox: expect.objectContaining({
              filesystem: {
                allowWrite: ["/repo/.git/worktrees/bb13", "/repo/.git/objects"],
              },
            }),
          }),
        }),
      );

      bridge.sendRequest(2, "thread/stop", {
        threadId: "thread-resume-roots",
      });
      await bridge.flushWork();
      queries[0]?.finish();
      await bridge.waitForResponse(2);
    } finally {
      bridge.restore();
    }
  });

  it("holds thread stop open until the Claude SDK stream closes", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-stop-waits",
      });
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/stop", { threadId: "thread-stop-waits" });
      await bridge.flushWork();

      expect(bridge.hasResponse(2)).toBe(false);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.close).not.toHaveBeenCalled();

      queries[0]?.finish();
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        id: 2,
        result: { ok: true },
      });
      expect(queries[0]?.close).not.toHaveBeenCalled();
    } finally {
      bridge.restore();
    }
  });

  it("waits for an in-flight close before replacing the same thread", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledClaudeQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledClaudeQuery();
      queries.push(query);
      return query;
    });

    try {
      bridge.sendRequest(11, "thread/start", {
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-overlap",
      });
      await bridge.waitForResponse(11);

      bridge.sendRequest(12, "thread/stop", { threadId: "thread-overlap" });
      await bridge.flushWork();
      bridge.sendRequest(13, "thread/start", {
        baseInstructions: "test",
        cwd: "/tmp/worktree",
        instructionMode: "append",
        permissionEscalation: "ask",
        permissionMode: "default",
        threadId: "thread-overlap",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(12)).toBe(false);
      expect(bridge.hasResponse(13)).toBe(false);
      expect(queries).toHaveLength(1);

      queries[0]?.finish();
      await expect(bridge.waitForResponse(12)).resolves.toMatchObject({
        id: 12,
        result: { ok: true },
      });
      await expect(bridge.waitForResponse(13)).resolves.toMatchObject({
        id: 13,
      });
      expect(queries).toHaveLength(2);

      bridge.sendRequest(14, "thread/stop", { threadId: "thread-overlap" });
      await bridge.flushWork();
      queries[1]?.finish();
      await bridge.waitForResponse(14);
    } finally {
      bridge.restore();
    }
  });
});
