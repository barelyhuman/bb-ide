import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionEvent,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";

type MockAgentSessionEventListener = (event: AgentSessionEvent) => void;

interface MockSubscribe {
  (listener: MockAgentSessionEventListener): () => void;
}

interface MockBashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface MockBashSpawnHook {
  (context: MockBashSpawnContext): MockBashSpawnContext;
}

interface MockBashToolOptions {
  spawnHook?: MockBashSpawnHook;
}

interface MockBashToolTextContent {
  type: "text";
  text: string;
}

interface MockBashToolExecutionResult {
  content: MockBashToolTextContent[];
  details: Record<string, never>;
}

interface MockBashToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, never>;
  execute: () => Promise<MockBashToolExecutionResult>;
}

interface MockCreateBashToolDefinition {
  (cwd: string, options?: MockBashToolOptions): MockBashToolDefinition;
}

const {
  mockGetActiveToolNames,
  mockSetActiveToolsByName,
  mockCreateBashToolDefinition,
  mockDefineTool,
  mockOpen,
  mockInMemory,
  mockSettingsInMemory,
  mockCreateAgentSession,
  mockSessionState,
  mockSessionEventListeners,
  mockAbort,
  mockDispose,
  mockPrompt,
  mockGetModel,
} = vi.hoisted(() => {
  const mockSessionEventListeners: MockAgentSessionEventListener[] = [];
  const mockSubscribe = vi.fn<MockSubscribe>((listener) => {
    mockSessionEventListeners.push(listener);
    return () => {
      const index = mockSessionEventListeners.indexOf(listener);
      if (index !== -1) {
        mockSessionEventListeners.splice(index, 1);
      }
    };
  });
  const mockSessionState = { isStreaming: false };
  const mockPrompt = vi.fn();
  const mockAbort = vi.fn(async () => {});
  const mockDispose = vi.fn();
  const mockGetSessionStats = vi.fn();
  const mockGetContextUsage = vi.fn();
  const mockGetActiveToolNames = vi.fn<() => string[]>(() => []);
  const mockSetActiveToolsByName = vi.fn<(toolNames: string[]) => void>();
  const mockOpen = vi.fn((path: string) => ({ kind: "open", path }));
  const mockInMemory = vi.fn((cwd?: string) => ({ kind: "in-memory", cwd }));
  const mockSettingsInMemory = vi.fn(() => ({ kind: "settings" }));
  const mockCreateBashToolDefinition = vi.fn<MockCreateBashToolDefinition>(
    (_cwd, _options) => ({
      name: "bash",
      label: "bash",
      description: "Execute a bash command",
      parameters: {},
      execute: vi.fn(
        async (): Promise<MockBashToolExecutionResult> => ({
          content: [{ type: "text", text: "ok" }],
          details: {},
        }),
      ),
    }),
  );
  const mockDefineTool = vi.fn(<TTool>(tool: TTool): TTool => tool);
  const mockCreateAgentSession = vi.fn(async () => ({
    session: {
      abort: mockAbort,
      subscribe: mockSubscribe,
      prompt: mockPrompt,
      dispose: mockDispose,
      getSessionStats: mockGetSessionStats,
      getContextUsage: mockGetContextUsage,
      getActiveToolNames: mockGetActiveToolNames,
      setActiveToolsByName: mockSetActiveToolsByName,
      get isStreaming() {
        return mockSessionState.isStreaming;
      },
    },
  }));
  const mockGetModel = vi.fn((provider: string, modelId: string) => ({
    id: modelId,
    provider,
  }));

  return {
    mockGetActiveToolNames,
    mockSetActiveToolsByName,
    mockCreateBashToolDefinition,
    mockDefineTool,
    mockOpen,
    mockInMemory,
    mockSettingsInMemory,
    mockCreateAgentSession,
    mockSessionState,
    mockSessionEventListeners,
    mockAbort,
    mockDispose,
    mockPrompt,
    mockGetModel,
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createBashToolDefinition: mockCreateBashToolDefinition,
  defineTool: mockDefineTool,
  SessionManager: {
    open: mockOpen,
    inMemory: mockInMemory,
  },
  SettingsManager: {
    inMemory: mockSettingsInMemory,
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: mockGetModel,
}));

import { PiSdkSession } from "../sdk-session.js";

function rejectPromptWithTransientAuthError(count: number, error: Error): void {
  for (let index = 0; index < count; index += 1) {
    mockPrompt.mockRejectedValueOnce(error);
  }
}

function emitSessionEvent(event: AgentSessionEvent): void {
  for (const listener of [...mockSessionEventListeners]) {
    listener(event);
  }
}

function createQueueUpdateEvent(
  steering: readonly string[],
): AgentSessionEvent {
  return {
    type: "queue_update",
    steering,
    followUp: [],
  };
}

function createAgentEndEvent(): AgentSessionEvent {
  return {
    type: "agent_end",
    messages: [],
  };
}

function createAutoRetryStartEvent(): AgentSessionEvent {
  return {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 2,
    delayMs: 1,
    errorMessage: "retryable failure",
  };
}

function createAutoRetryEndEvent(success: boolean): AgentSessionEvent {
  return {
    type: "auto_retry_end",
    success,
    attempt: 1,
    ...(success ? {} : { finalError: "Retry cancelled" }),
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushDeferredSteerSettlement(): Promise<void> {
  await flushAsyncWork();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flushAsyncWork();
}

describe("PiSdkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionState.isStreaming = false;
    mockSessionEventListeners.length = 0;
    mockGetActiveToolNames.mockReturnValue([]);
    mockAbort.mockResolvedValue(undefined);
  });

  it("opens a persistent session file when provided", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        sessionFilePath: "/tmp/pi-sessions/thread-1.jsonl",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockOpen).toHaveBeenCalledWith(
      "/tmp/pi-sessions/thread-1.jsonl",
      "/tmp/pi-sessions",
    );
    expect(mockInMemory).not.toHaveBeenCalled();
  });

  it("falls back to an in-memory session when no file path is provided", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();

    expect(mockInMemory).toHaveBeenCalledWith("/tmp/project");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("leaves Pi's built-in bash active when no shell env overrides are configured", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();

    expect(mockCreateBashToolDefinition).not.toHaveBeenCalled();
  });

  it("resolves openai-codex subscription models", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "openai-codex/gpt-5.5",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockGetModel).toHaveBeenCalledWith("openai-codex", "gpt-5.5");
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          id: "gpt-5.5",
          provider: "openai-codex",
        },
      }),
    );
  });

  it("rejects unresolved explicit models before opening a Pi session", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "unsupported/model",
      },
      vi.fn(),
      vi.fn(),
    );

    await expect(session.start()).rejects.toThrow(
      'Failed to resolve Pi model "unsupported/model"',
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it("forwards thinking level to the SDK when configured", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        thinkingLevel: "xhigh",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingLevel: "xhigh",
      }),
    );
  });

  it("scopes shell env overrides to the bash spawn hook without mutating process.env", async () => {
    const sessionEnvKey = "BB_PI_UNIT_SESSION_ENV";
    const processOnlyEnvKey = "BB_PI_UNIT_PROCESS_ONLY_ENV";
    const previousSessionEnvValue = process.env[sessionEnvKey];
    const previousProcessOnlyEnvValue = process.env[processOnlyEnvKey];
    delete process.env[sessionEnvKey];
    process.env[processOnlyEnvKey] = "daemon-secret";

    try {
      const session = new PiSdkSession(
        {
          cwd: "/tmp/project",
          shellEnvOverrides: {
            BB_THREAD_ID: "t1",
            [sessionEnvKey]: "thread-a",
          },
        },
        vi.fn(),
        vi.fn(),
      );

      await session.start();

      expect(process.env[sessionEnvKey]).toBeUndefined();
      expect(process.env[processOnlyEnvKey]).toBe("daemon-secret");
      expect(mockCreateBashToolDefinition).toHaveBeenCalledTimes(1);

      const bashToolCall = mockCreateBashToolDefinition.mock.calls[0];
      if (!bashToolCall) {
        throw new Error("Expected Pi bash tool to be created");
      }

      const bashToolOptions = bashToolCall[1];
      if (!bashToolOptions?.spawnHook) {
        throw new Error("Expected Pi bash tool to receive a spawn hook");
      }

      const spawnContext: MockBashSpawnContext = {
        command: "printf ok",
        cwd: "/tmp/project",
        env: {
          PATH: "/bin",
          BB_THREAD_ID: "base-thread",
        },
      };

      expect(bashToolOptions.spawnHook(spawnContext)).toEqual({
        command: "printf ok",
        cwd: "/tmp/project",
        env: {
          PATH: "/bin",
          BB_THREAD_ID: "t1",
          [sessionEnvKey]: "thread-a",
        },
      });
    } finally {
      if (previousSessionEnvValue === undefined) {
        delete process.env[sessionEnvKey];
      } else {
        process.env[sessionEnvKey] = previousSessionEnvValue;
      }
      if (previousProcessOnlyEnvValue === undefined) {
        delete process.env[processOnlyEnvKey];
      } else {
        process.env[processOnlyEnvKey] = previousProcessOnlyEnvValue;
      }
    }
  });

  it("re-activates missing custom tools before later prompts", async () => {
    mockGetActiveToolNames
      .mockReturnValueOnce(["read", "bash"])
      .mockReturnValueOnce(["read", "bash"])
      .mockReturnValueOnce(["read", "bash", "message_user"]);

    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        customTools: [
          {
            name: "message_user",
            label: "message_user",
            description: "Send a message to the user",
            parameters: {} as ToolDefinition["parameters"],
            execute: vi.fn(async () => ({
              content: [{ type: "text" as const, text: "ok" }],
              details: {},
            })),
          } satisfies ToolDefinition,
        ],
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();
    await session.prompt("first follow-up");
    await session.prompt("second follow-up");

    expect(mockSetActiveToolsByName).toHaveBeenCalledTimes(2);
    expect(mockSetActiveToolsByName).toHaveBeenNthCalledWith(1, [
      "read",
      "bash",
      "message_user",
    ]);
    expect(mockSetActiveToolsByName).toHaveBeenNthCalledWith(2, [
      "read",
      "bash",
      "message_user",
    ]);
  });

  it("queues normal prompts as follow-ups while the SDK is still streaming", async () => {
    mockSessionState.isStreaming = true;
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    await session.prompt("queued follow-up");

    expect(mockPrompt).toHaveBeenCalledWith("queued follow-up", {
      streamingBehavior: "followUp",
    });
  });

  it("waits for queued steer consumption using the SDK queued text", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["expanded steer"]));
    });
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());
    let steerConsumed = false;

    await session.start();
    const steerPromise = session.steer("interrupting steer").then(() => {
      steerConsumed = true;
    });
    await flushAsyncWork();

    expect(mockPrompt).toHaveBeenCalledWith("interrupting steer", {
      streamingBehavior: "steer",
    });
    expect(steerConsumed).toBe(false);

    emitSessionEvent(createQueueUpdateEvent([]));
    await steerPromise;

    expect(steerConsumed).toBe(true);
  });

  it("resolves handled steers when the SDK does not queue input", async () => {
    mockSessionState.isStreaming = true;
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    await session.steer("handled steer");

    expect(mockPrompt).toHaveBeenCalledWith("handled steer", {
      streamingBehavior: "steer",
    });
  });

  it("rejects steer consumption when the SDK prompt rejects", async () => {
    mockSessionState.isStreaming = true;
    const promptError = new Error("prompt rejected");
    mockPrompt.mockRejectedValueOnce(promptError);
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();

    await expect(session.steer("rejected steer")).rejects.toThrow(
      "prompt rejected",
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(promptError);
  });

  it("resolves duplicate queued steer text one consumed entry at a time", async () => {
    mockSessionState.isStreaming = true;
    let queuedSteerCount = 0;
    mockPrompt.mockImplementation(async () => {
      queuedSteerCount += 1;
      emitSessionEvent(
        createQueueUpdateEvent(
          Array.from({ length: queuedSteerCount }, () => "same steer"),
        ),
      );
    });
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());
    let firstConsumed = false;
    let secondConsumed = false;

    await session.start();
    const firstPromise = session.steer("same steer").then(() => {
      firstConsumed = true;
    });
    await flushAsyncWork();
    const secondPromise = session.steer("same steer").then(() => {
      secondConsumed = true;
    });
    await flushAsyncWork();

    expect(firstConsumed).toBe(false);
    expect(secondConsumed).toBe(false);

    emitSessionEvent(createQueueUpdateEvent(["same steer"]));
    await flushAsyncWork();

    expect(firstConsumed).toBe(true);
    expect(secondConsumed).toBe(false);

    emitSessionEvent(createQueueUpdateEvent([]));
    await Promise.all([firstPromise, secondPromise]);

    expect(secondConsumed).toBe(true);
  });

  it("rejects queued steer consumption when the turn ends before delivery", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["undelivered steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    const steerPromise = session.steer("undelivered steer");
    await flushAsyncWork();

    emitSessionEvent(createAgentEndEvent());

    await expect(steerPromise).rejects.toThrow(
      "Pi turn ended before steer was consumed",
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps queued steer consumption pending when auto retry starts", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["retry steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);
    let consumed = false;
    let steerError: Error | undefined;

    await session.start();
    const steerPromise = session.steer("retry steer").then(
      () => {
        consumed = true;
      },
      (error) => {
        steerError = error instanceof Error ? error : new Error(String(error));
      },
    );
    await flushAsyncWork();

    emitSessionEvent(createAgentEndEvent());
    emitSessionEvent(createAutoRetryStartEvent());
    await flushDeferredSteerSettlement();

    expect(consumed).toBe(false);
    expect(steerError).toBeUndefined();

    emitSessionEvent(createAutoRetryEndEvent(true));
    emitSessionEvent(createQueueUpdateEvent([]));
    await steerPromise;

    expect(consumed).toBe(true);
    expect(steerError).toBeUndefined();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("rejects queued steer consumption when auto retry ends unsuccessfully", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["retry failed steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    const steerPromise = session.steer("retry failed steer");
    await flushAsyncWork();

    emitSessionEvent(createAgentEndEvent());
    emitSessionEvent(createAutoRetryStartEvent());
    await flushDeferredSteerSettlement();
    emitSessionEvent(createAutoRetryEndEvent(false));

    await expect(steerPromise).rejects.toThrow(
      "Pi auto retry ended before steer was consumed",
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("omits streaming behavior while the SDK is idle", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    await session.prompt("idle follow-up");
    await session.steer("idle steer");

    expect(mockPrompt).toHaveBeenNthCalledWith(1, "idle follow-up", {});
    expect(mockPrompt).toHaveBeenNthCalledWith(2, "idle steer", {});
  });

  it("rejects pending steer consumption when the session closes", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["closing steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    const steerPromise = session.steer("closing steer");
    await flushAsyncWork();

    session.stop();

    await expect(steerPromise).rejects.toThrow(
      "Pi SDK session stopped before steer consumed",
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("allows eight transient Pi auth storage misses before succeeding", async () => {
    const authError = new Error("No API key found for anthropic.");
    rejectPromptWithTransientAuthError(8, authError);
    mockPrompt.mockResolvedValueOnce(undefined);
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    await session.prompt("retry after auth storage miss");

    expect(mockPrompt).toHaveBeenCalledTimes(9);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("fails after nine transient Pi auth storage misses", async () => {
    const authError = new Error("No API key found for anthropic.");
    rejectPromptWithTransientAuthError(9, authError);
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    await session.prompt("fail after retry budget");

    expect(mockPrompt).toHaveBeenCalledTimes(9);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(authError);
  });

  it("waits for abort before disposing during graceful close", async () => {
    let resolveAbort: (() => void) | undefined;
    mockAbort.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAbort = resolve;
        }),
    );
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    const closePromise = session.closeGracefully(1_000);
    await Promise.resolve();

    expect(mockAbort).toHaveBeenCalledTimes(1);
    expect(mockDispose).not.toHaveBeenCalled();
    if (!resolveAbort) {
      throw new Error("Expected Pi abort promise to be pending");
    }
    resolveAbort();
    await closePromise;

    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(session.getIsProcessing()).toBe(false);
  });
});
