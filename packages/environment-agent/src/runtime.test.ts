import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_AGENT_PROTOCOL_VERSION,
} from "./protocol.js";
import { EnvironmentAgentRuntime } from "./runtime.js";

describe("EnvironmentAgentRuntime", () => {
  it("appends replayable sequenced events", () => {
    const runtime = new EnvironmentAgentRuntime({
      threadId: "thread-1",
      providerCommand: "codex",
      providerArgs: ["app-server"],
    });

    runtime.appendEvent({
      type: "environment.ready",
      threadId: "thread-1",
    });
    runtime.appendEvent({
      type: "workspace.status.changed",
      threadId: "thread-1",
    });

    const replay = runtime.replay({
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      afterSequence: 0,
    });

    expect(replay.events).toHaveLength(2);
    expect(replay.toSequenceInclusive).toBe(2);
    expect(replay.events[0]?.sequence).toBe(1);
  });

  it("tracks acknowledged sequence progress", () => {
    const runtime = new EnvironmentAgentRuntime({
      threadId: "thread-1",
      providerCommand: "codex",
      providerArgs: ["app-server"],
    });
    runtime.appendEvent({
      type: "environment.ready",
      threadId: "thread-1",
    });
    runtime.appendEvent({
      type: "workspace.status.changed",
      threadId: "thread-1",
    });

    const ack = runtime.acknowledge({
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      sequence: 1,
      threadId: "thread-1",
    });
    const status = runtime.getStatusSnapshot();

    expect(ack.acknowledgedSequence).toBe(1);
    expect(status.lastAckedSequence).toBe(1);
    expect(status.pendingEventCount).toBe(1);
  });

  it("normalizes provider notifications into replayable provider events", () => {
    const runtime = new EnvironmentAgentRuntime({
      threadId: "thread-1",
      providerCommand: "codex",
      providerArgs: ["app-server"],
    });

    runtime.appendEvent({
      type: "provider.event",
      threadId: "thread-1",
      method: "turn/started",
      payload: { turnId: "turn-1" },
    });

    const replay = runtime.replay({
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      afterSequence: 0,
    });

    expect(replay.events[0]?.event).toMatchObject({
      type: "provider.event",
      method: "turn/started",
      payload: { turnId: "turn-1" },
    });
  });
});
