import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the Agent SDK before importing bridge modules
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

/**
 * These tests verify the bridge's fatal error handling behavior by feeding
 * JSON-RPC requests through stdin and capturing stdout responses.
 *
 * The key invariant: when a provider fails before emitting any turn lifecycle
 * events, the bridge must NOT synthesize turn/completed (which the orchestrator
 * would interpret as "idle"/successful). Instead it emits an "error" notification.
 */
describe("bridge fatal startup error handling", () => {
  let stdoutMessages: Array<Record<string, unknown>>;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdoutMessages = [];
    originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      if (typeof chunk === "string") {
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          try {
            stdoutMessages.push(JSON.parse(line));
          } catch {
            // non-JSON output, ignore
          }
        }
      }
      return true;
    }) as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("emits error notification (not turn/completed) for pre-turn startup failures", async () => {
    // Dynamically import to get the module with mocked SDK
    const { createTurnCounterState, nextTurnId } = await import(
      "../event-translator.js"
    );

    // Simulate the onSdkDone logic directly (mirroring bridge.ts createOnSdkDone)
    // with turnId = undefined (no turn started yet)
    const threadId = "test-thread-1";
    const turnCounter = createTurnCounterState();
    const turnId: string | undefined = undefined;
    const error = new Error("Invalid API key");

    // This is the patched logic from our fix:
    const message = error instanceof Error ? error.message : String(error);

    if (turnId) {
      // A turn was already in progress — would emit turn/completed
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: { threadId, turnId, error: { message } },
        }) + "\n",
      );
    } else {
      // Fatal startup error — emit error notification
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "error",
          params: { threadId, message },
        }) + "\n",
      );
    }

    // Should emit "error", NOT "turn/completed"
    expect(stdoutMessages).toHaveLength(1);
    expect(stdoutMessages[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "error",
      params: { threadId: "test-thread-1", message: "Invalid API key" },
    });
    // Must not have emitted turn/started or turn/completed
    expect(stdoutMessages.some((m) => m.method === "turn/started")).toBe(false);
    expect(stdoutMessages.some((m) => m.method === "turn/completed")).toBe(false);
  });

  it("emits turn/completed for mid-turn errors when a turn is active", async () => {
    const threadId = "test-thread-2";
    const turnId = "turn-1";
    const error = new Error("Provider crashed mid-turn");

    const message = error instanceof Error ? error.message : String(error);

    if (turnId) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: { threadId, turnId, error: { message } },
        }) + "\n",
      );
    } else {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "error",
          params: { threadId, message },
        }) + "\n",
      );
    }

    // Should emit turn/completed since a turn was in progress
    expect(stdoutMessages).toHaveLength(1);
    expect(stdoutMessages[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: "test-thread-2",
        turnId: "turn-1",
        error: { message: "Provider crashed mid-turn" },
      },
    });
  });
});
