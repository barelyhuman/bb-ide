import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  translateSdkMessage,
  createTurnCounterState,
  type TurnCounterState,
} from "../event-translator.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Multi-thread isolation tests for the Claude Code bridge.
 *
 * The bridge now maintains a Map<threadId, ThreadSession> instead of
 * module-level singletons. These tests verify that the event-translator
 * layer — with per-thread TurnCounterState — correctly isolates
 * concurrent thread lifecycles.
 */
describe("multi-thread bridge isolation", () => {
  it("concurrent threads get independent turn counters", () => {
    const counterA = createTurnCounterState();
    const counterB = createTurnCounterState();

    const assistantMsg = (text: string) =>
      ({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text }] },
      }) as unknown as SDKMessage;

    // Thread A: first turn
    const a1 = translateSdkMessage(assistantMsg("A1"), "thread-A", undefined, counterA);
    expect(a1.turnId).toBe("turn-1");

    // Thread B: first turn (should also be turn-1, not turn-2)
    const b1 = translateSdkMessage(assistantMsg("B1"), "thread-B", undefined, counterB);
    expect(b1.turnId).toBe("turn-1");

    // Thread A: complete turn, then start second turn
    const a1Result = translateSdkMessage(
      { type: "result", subtype: "success" } as unknown as SDKMessage,
      "thread-A",
      a1.turnId,
      counterA,
    );
    expect(a1Result.turnId).toBeUndefined();

    const a2 = translateSdkMessage(assistantMsg("A2"), "thread-A", undefined, counterA);
    expect(a2.turnId).toBe("turn-2");

    // Thread B still on turn-1, unaffected by thread A's progress
    const b1Continue = translateSdkMessage(assistantMsg("B1-more"), "thread-B", b1.turnId, counterB);
    expect(b1Continue.turnId).toBe("turn-1");
    // Should not emit turn/started again
    expect(b1Continue.notifications.filter((n) => n.method === "turn/started")).toHaveLength(0);
  });

  it("stopping one thread does not affect another thread's turn counter", () => {
    const counterA = createTurnCounterState();
    const counterB = createTurnCounterState();

    const assistantMsg = (text: string) =>
      ({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text }] },
      }) as unknown as SDKMessage;

    // Both threads start their first turn
    const a1 = translateSdkMessage(assistantMsg("A"), "thread-A", undefined, counterA);
    const b1 = translateSdkMessage(assistantMsg("B"), "thread-B", undefined, counterB);

    // Complete thread A
    translateSdkMessage(
      { type: "result", subtype: "success" } as unknown as SDKMessage,
      "thread-A",
      a1.turnId,
      counterA,
    );

    // Thread B starts turn 2 — should still be turn-2, not affected by A
    translateSdkMessage(
      { type: "result", subtype: "success" } as unknown as SDKMessage,
      "thread-B",
      b1.turnId,
      counterB,
    );
    const b2 = translateSdkMessage(assistantMsg("B2"), "thread-B", undefined, counterB);
    expect(b2.turnId).toBe("turn-2");
  });

  it("events carry correct threadId for each session", () => {
    const counterA = createTurnCounterState();
    const counterB = createTurnCounterState();

    const assistantMsg = {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    } as unknown as SDKMessage;

    const resultA = translateSdkMessage(assistantMsg, "thread-A", undefined, counterA);
    const resultB = translateSdkMessage(assistantMsg, "thread-B", undefined, counterB);

    // Every notification from A should have threadId "thread-A"
    for (const n of resultA.notifications) {
      expect(n.params.threadId).toBe("thread-A");
    }

    // Every notification from B should have threadId "thread-B"
    for (const n of resultB.notifications) {
      expect(n.params.threadId).toBe("thread-B");
    }
  });
});
