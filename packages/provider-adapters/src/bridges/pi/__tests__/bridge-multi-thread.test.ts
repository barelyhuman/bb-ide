import { describe, expect, it } from "vitest";
import {
  translatePiEvent,
  createTurnCounterState,
} from "../event-translator.js";

/**
 * Multi-thread isolation tests for the Pi bridge.
 *
 * The bridge now maintains a Map<threadId, PiThreadSession> instead of
 * module-level singletons. These tests verify that the event-translator
 * layer — with per-thread TurnCounterState — correctly isolates
 * concurrent thread lifecycles.
 */
describe("multi-thread bridge isolation", () => {
  it("concurrent threads get independent turn counters", () => {
    const counterA = createTurnCounterState();
    const counterB = createTurnCounterState();

    // Thread A: first turn
    const a1 = translatePiEvent({ type: "agent_start" }, "thread-A", undefined, counterA);
    expect(a1.turnId).toBe("turn-1");

    // Thread B: first turn (should also be turn-1, not turn-2)
    const b1 = translatePiEvent({ type: "agent_start" }, "thread-B", undefined, counterB);
    expect(b1.turnId).toBe("turn-1");

    // Thread A: complete turn, then start second turn
    const a1End = translatePiEvent(
      {
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: "A done" }] }],
      },
      "thread-A",
      a1.turnId,
      counterA,
    );
    expect(a1End.turnId).toBeUndefined();

    const a2 = translatePiEvent({ type: "agent_start" }, "thread-A", undefined, counterA);
    expect(a2.turnId).toBe("turn-2");

    // Thread B still on turn-1, unaffected by thread A's progress
    const b1Update = translatePiEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "chunk" },
      },
      "thread-B",
      b1.turnId,
      counterB,
    );
    expect(b1Update.turnId).toBe("turn-1");
  });

  it("stopping one thread does not affect another thread's turn counter", () => {
    const counterA = createTurnCounterState();
    const counterB = createTurnCounterState();

    // Both threads start their first turn
    const a1 = translatePiEvent({ type: "agent_start" }, "thread-A", undefined, counterA);
    const b1 = translatePiEvent({ type: "agent_start" }, "thread-B", undefined, counterB);

    // Complete thread A
    translatePiEvent(
      {
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: "A done" }] }],
      },
      "thread-A",
      a1.turnId,
      counterA,
    );

    // Thread B starts turn 2 — should still be turn-2, not affected by A
    translatePiEvent(
      {
        type: "agent_end",
        messages: [{ role: "assistant", content: [{ type: "text", text: "B done" }] }],
      },
      "thread-B",
      b1.turnId,
      counterB,
    );
    const b2 = translatePiEvent({ type: "agent_start" }, "thread-B", undefined, counterB);
    expect(b2.turnId).toBe("turn-2");
  });

  it("events carry correct threadId for each session", () => {
    const counterA = createTurnCounterState();
    const counterB = createTurnCounterState();

    const resultA = translatePiEvent({ type: "agent_start" }, "thread-A", undefined, counterA);
    const resultB = translatePiEvent({ type: "agent_start" }, "thread-B", undefined, counterB);

    for (const n of resultA.notifications) {
      expect(n.params.threadId).toBe("thread-A");
    }

    for (const n of resultB.notifications) {
      expect(n.params.threadId).toBe("thread-B");
    }
  });
});
