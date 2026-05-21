import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

type ControlledPiAgentSessionListener = (event: AgentSessionEvent) => void;

interface MockPiResourceLoaderOptions {
  cwd?: string;
  agentDir?: string;
  systemPrompt?: string;
  appendSystemPromptOverride?: (base: string[]) => string[];
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
}

interface MockPiResourceLoader {
  options: MockPiResourceLoaderOptions;
  reload: ReturnType<typeof vi.fn>;
}

const {
  mockCreateAgentSession,
  mockDefaultResourceLoader,
  mockInMemory,
  mockOpen,
  mockResourceLoaders,
  mockSettingsInMemory,
} = vi.hoisted(() => {
  const mockResourceLoaders: MockPiResourceLoader[] = [];

  const mockDefaultResourceLoader = vi.fn(function defaultResourceLoader(
    options: MockPiResourceLoaderOptions,
  ): MockPiResourceLoader {
    const resourceLoader = {
      options,
      reload: vi.fn(async () => {}),
    };
    mockResourceLoaders.push(resourceLoader);
    return resourceLoader;
  });

  return {
    mockCreateAgentSession: vi.fn(),
    mockDefaultResourceLoader,
    mockInMemory: vi.fn((cwd?: string) => ({ kind: "in-memory", cwd })),
    mockOpen: vi.fn((path: string) => ({ kind: "open", path })),
    mockResourceLoaders,
    mockSettingsInMemory: vi.fn(() => ({ kind: "settings" })),
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  DefaultResourceLoader: mockDefaultResourceLoader,
  getAgentDir: vi.fn(() => "/tmp/pi-agent"),
  SessionManager: {
    open: mockOpen,
    inMemory: mockInMemory,
  },
  SettingsManager: {
    inMemory: mockSettingsInMemory,
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(),
}));

import { handleLine } from "../bridge.js";
import { PI_BRIDGE_SESSION_DIR_ENV } from "../session-paths.js";
import { createBridgeJsonRpcTestHarness } from "../../../test/bridge-json-rpc-test-helpers.js";

const originalPiBridgeSessionDir = process.env[PI_BRIDGE_SESSION_DIR_ENV];

interface ControlledPiAgentSession {
  abort: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  emit(event: AgentSessionEvent): void;
  finishAbort(): void;
  getActiveToolNames: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
  prompt: ReturnType<typeof vi.fn>;
  setActiveToolsByName: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

function createControlledPiAgentSession(): ControlledPiAgentSession {
  let finishAbort: (() => void) | undefined;
  const listeners: ControlledPiAgentSessionListener[] = [];
  const abort = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishAbort = resolve;
      }),
  );
  return {
    abort,
    dispose: vi.fn(),
    emit(event: AgentSessionEvent): void {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    finishAbort() {
      if (!finishAbort) {
        throw new Error("Expected Pi abort to be waiting");
      }
      finishAbort();
      finishAbort = undefined;
    },
    getActiveToolNames: vi.fn(() => []),
    getContextUsage: vi.fn(() => undefined),
    isStreaming: false,
    prompt: vi.fn(async () => {}),
    setActiveToolsByName: vi.fn(),
    subscribe: vi.fn((listener: ControlledPiAgentSessionListener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    }),
  };
}

function createQueueUpdateEvent(steering: readonly string[]): AgentSessionEvent {
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

describe("pi bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResourceLoaders.length = 0;
    delete process.env[PI_BRIDGE_SESSION_DIR_ENV];
  });

  afterEach(() => {
    if (originalPiBridgeSessionDir === undefined) {
      delete process.env[PI_BRIDGE_SESSION_DIR_ENV];
      return;
    }
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = originalPiBridgeSessionDir;
  });

  it("passes appendSystemPrompt through Pi's append override path", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(1, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-append",
        appendSystemPrompt: "BB append instructions",
      });
      await bridge.waitForResponse(1);

      expect(mockResourceLoaders).toHaveLength(1);
      expect(mockResourceLoaders[0]?.options).toMatchObject({
        cwd: "/tmp/worktree",
        agentDir: "/tmp/pi-agent",
      });
      expect(mockResourceLoaders[0]?.options.systemPrompt).toBeUndefined();
      expect(mockResourceLoaders[0]?.options.noSkills).toBeUndefined();
      expect(
        mockResourceLoaders[0]?.options.appendSystemPromptOverride?.([
          "Project append instructions",
        ]),
      ).toEqual(["Project append instructions", "BB append instructions"]);
    } finally {
      bridge.restore();
    }
  });

  it("passes baseInstructions through Pi's replacement system prompt path", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(2, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-replace",
        baseInstructions: "Replacement prompt",
      });
      await bridge.waitForResponse(2);

      expect(mockResourceLoaders).toHaveLength(1);
      expect(mockResourceLoaders[0]?.options).toMatchObject({
        cwd: "/tmp/worktree",
        agentDir: "/tmp/pi-agent",
        systemPrompt: "Replacement prompt",
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      expect(
        mockResourceLoaders[0]?.options.appendSystemPromptOverride,
      ).toBeUndefined();
    } finally {
      bridge.restore();
    }
  });

  it("passes thread/start reasoningLevel through to Pi thinkingLevel", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(3, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-reasoning",
        reasoningLevel: "high",
      });
      await bridge.waitForResponse(3);

      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          thinkingLevel: "high",
        }),
      );
    } finally {
      bridge.restore();
    }
  });

  it("uses the configured bridge session directory for default Pi sessions", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = "/tmp/pi-bridge-test-sessions";

    try {
      bridge.sendRequest(4, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread/session:test",
      });
      await bridge.waitForResponse(4);

      expect(mockOpen).toHaveBeenCalledWith(
        join("/tmp/pi-bridge-test-sessions", "thread_session_test.jsonl"),
        "/tmp/pi-bridge-test-sessions",
      );
    } finally {
      bridge.restore();
    }
  });

  it("fails thread/start when the requested Pi model cannot be resolved", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(4, "thread/start", {
        cwd: "/tmp/worktree",
        model: "unsupported/model",
        threadId: "thread-invalid-model",
      });
      await expect(bridge.waitForResponse(4)).resolves.toMatchObject({
        error: {
          code: -32000,
          message: 'Failed to resolve Pi model "unsupported/model"',
        },
        id: 4,
      });
      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(
        bridge.messages.some((message) => message.method === "thread/identity"),
      ).toBe(false);
    } finally {
      bridge.restore();
    }
  });

  it("rejects requests that combine replacement and append instructions", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(3, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-both",
        baseInstructions: "Replacement prompt",
        appendSystemPrompt: "Append prompt",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(3)).toBe(false);
      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(mockResourceLoaders).toHaveLength(0);
    } finally {
      bridge.restore();
    }
  });

  it("holds thread stop open until the Pi SDK session closes", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const sessions: ControlledPiAgentSession[] = [];
    mockCreateAgentSession.mockImplementation(async () => {
      const session = createControlledPiAgentSession();
      sessions.push(session);
      return { session };
    });

    try {
      bridge.sendRequest(1, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-stop-waits",
      });
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/stop", { threadId: "thread-stop-waits" });
      await bridge.flushWork();

      expect(bridge.hasResponse(2)).toBe(false);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.abort).toHaveBeenCalledTimes(1);
      expect(sessions[0]?.dispose).not.toHaveBeenCalled();

      sessions[0]?.finishAbort();
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        id: 2,
        result: { ok: true },
      });
      expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    } finally {
      bridge.restore();
    }
  });

  it("waits for an in-flight close before replacing the same thread", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const sessions: ControlledPiAgentSession[] = [];
    mockCreateAgentSession.mockImplementation(async () => {
      const session = createControlledPiAgentSession();
      sessions.push(session);
      return { session };
    });

    try {
      bridge.sendRequest(11, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-overlap",
      });
      await bridge.waitForResponse(11);

      bridge.sendRequest(12, "thread/stop", { threadId: "thread-overlap" });
      await bridge.flushWork();
      bridge.sendRequest(13, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-overlap",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(12)).toBe(false);
      expect(bridge.hasResponse(13)).toBe(false);
      expect(sessions).toHaveLength(1);

      sessions[0]?.finishAbort();
      await expect(bridge.waitForResponse(12)).resolves.toMatchObject({
        id: 12,
        result: { ok: true },
      });
      await expect(bridge.waitForResponse(13)).resolves.toMatchObject({
        id: 13,
      });
      expect(sessions).toHaveLength(2);

      bridge.sendRequest(14, "thread/stop", { threadId: "thread-overlap" });
      await bridge.flushWork();
      sessions[1]?.finishAbort();
      await bridge.waitForResponse(14);
    } finally {
      bridge.restore();
    }
  });

  it("responds to turn/steer after the SDK accepts queued steer input", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.isStreaming = true;
    piSession.prompt.mockImplementation(async () => {
      piSession.emit(createQueueUpdateEvent(["expanded steer"]));
    });
    mockCreateAgentSession.mockImplementation(async () => ({
      session: piSession,
    }));

    try {
      bridge.sendRequest(21, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-steer-consumption",
      });
      await bridge.waitForResponse(21);

      bridge.sendRequest(22, "turn/steer", {
        threadId: "thread-steer-consumption",
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: "interrupting steer" }],
      });
      await bridge.flushWork();

      expect(piSession.prompt).toHaveBeenCalledWith("interrupting steer", {
        streamingBehavior: "steer",
      });
      await expect(bridge.waitForResponse(22)).resolves.toMatchObject({
        id: 22,
        result: { threadId: "thread-steer-consumption" },
      });
    } finally {
      bridge.restore();
    }
  });

  it("emits an error when a queued steer is not consumed before agent end", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.isStreaming = true;
    piSession.prompt.mockImplementation(async () => {
      piSession.emit(createQueueUpdateEvent(["undelivered steer"]));
    });
    mockCreateAgentSession.mockImplementation(async () => ({
      session: piSession,
    }));

    try {
      bridge.sendRequest(31, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-undelivered-steer",
      });
      await bridge.waitForResponse(31);

      bridge.sendRequest(32, "turn/steer", {
        threadId: "thread-undelivered-steer",
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: "undelivered steer" }],
      });
      await bridge.flushWork();

      await expect(bridge.waitForResponse(32)).resolves.toMatchObject({
        id: 32,
        result: { threadId: "thread-undelivered-steer" },
      });

      piSession.emit(createAgentEndEvent());
      await bridge.flushWork();
      await bridge.flushWork();

      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "error",
          params: {
            threadId: "thread-undelivered-steer",
            message: "Pi turn ended before steer was consumed",
          },
        }),
      );
    } finally {
      bridge.restore();
    }
  });
});
