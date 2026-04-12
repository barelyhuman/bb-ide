import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import {
  buildSessionOptions,
} from "../bridge.js";
import { listClaudeCodeBridgeModels } from "../model-list.js";

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
            description: "Opus 4.6 with 1M context [NEW] · Most capable for complex work",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "max"],
          },
          {
            value: "sonnet",
            displayName: "Sonnet",
            description: "Sonnet 4.6 · Best for everyday tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
          {
            value: "sonnet[1m]",
            displayName: "Sonnet (1M context)",
            description: "Sonnet 4.6 with 1M context · Billed as extra usage",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high"],
          },
          {
            value: "haiku",
            displayName: "Haiku",
            description: "Haiku 4.5",
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
    await expect(
      askHook({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {},
        tool_use_id: "tool-1",
        session_id: "session-1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/tmp/worktree",
      }, "tool-1", { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
      },
    });

    const preToolUseHook = denyOptions.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!preToolUseHook) {
      throw new Error("Expected readonly PreToolUse hook");
    }
    await expect(
      preToolUseHook({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {},
        tool_use_id: "tool-1",
        session_id: "session-1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: "/tmp/worktree",
      }, "tool-1", { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
  });

  it("returns the bridge-owned Claude model list from the SDK probe", async () => {
    await expect(listClaudeCodeBridgeModels()).resolves.toEqual([
      expect.objectContaining({
        id: "opus[1m]",
        model: "opus[1m]",
        displayName: "Opus 4.6 (1M)",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "opus",
        model: "opus",
        displayName: "Opus 4.6",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "sonnet[1m]",
        model: "sonnet[1m]",
        displayName: "Sonnet 4.6 (1M)",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet 4.6",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "haiku",
        model: "haiku",
        displayName: "Haiku 4.5",
        isDefault: false,
      }),
    ]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
