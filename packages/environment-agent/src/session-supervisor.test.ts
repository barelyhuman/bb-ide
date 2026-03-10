import { describe, expect, it, vi } from "vitest";
import { EnvironmentAgentRuntime } from "./runtime.js";
import { EnvironmentAgentSessionRuntime } from "./session-runtime.js";
import { InMemoryEnvironmentAgentSessionStore } from "./in-memory-session-store.js";
import { EnvironmentAgentSessionSync } from "./session-sync.js";
import { EnvironmentAgentSessionSupervisor } from "./session-supervisor.js";
import type { EnvironmentAgentSessionHttpClient } from "./session-http-client.js";

function makeClientMock(): EnvironmentAgentSessionHttpClient {
  return {
    openSession: vi.fn(),
    heartbeat: vi.fn(),
    pushEvents: vi.fn(),
    pullCommands: vi.fn(),
    acknowledgeCommands: vi.fn(),
    sendCommandResult: vi.fn(),
    closeSession: vi.fn(),
  } as unknown as EnvironmentAgentSessionHttpClient;
}

describe("EnvironmentAgentSessionSupervisor", () => {
  it("opens a session, persists runtime events, executes pulled commands, and reports results", async () => {
    const store = new InMemoryEnvironmentAgentSessionStore();
    const runtime = new EnvironmentAgentRuntime({ threadId: "thread-1" });
    const sessionRuntime = new EnvironmentAgentSessionRuntime({
      store,
      clock: () => 10_000,
    });
    const client = makeClientMock();
    (client.openSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      protocol: "beanbag.env-agent.v1",
      type: "session_welcome",
      messageId: "msg-open",
      sessionId: "sess-1",
      sentAt: 2_000,
      payload: {
        leaseTtlMs: 30_000,
        heartbeatIntervalMs: 10_000,
        selectedTransport: "http-long-poll",
        protocolVersion: 1,
        channels: [],
      },
    });
    (client.pushEvents as ReturnType<typeof vi.fn>).mockResolvedValue({
      protocol: "beanbag.env-agent.v1",
      type: "event_ack",
      messageId: "msg-ack",
      sessionId: "sess-1",
      sentAt: 3_000,
      payload: {
        channels: [
          {
            channelId: "thread-1",
            ackedThrough: { generation: 1, sequence: 1 },
          },
        ],
      },
    });
    (client.pullCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      protocol: "beanbag.env-agent.v1",
      type: "command_batch",
      messageId: "msg-cmd",
      sessionId: "sess-1",
      sentAt: 4_000,
      payload: {
        commands: [
          {
            channelId: "thread-1",
            commandCursor: 1,
            commandId: "cmd-1",
            createdAt: 3_500,
            command: {
              type: "workspace.status",
              threadId: "thread-1",
            },
          },
        ],
      },
    }).mockResolvedValue({
      protocol: "beanbag.env-agent.v1",
      type: "command_batch",
      messageId: "msg-cmd-empty",
      sessionId: "sess-1",
      sentAt: 5_000,
      payload: { commands: [] },
    });
    (client.acknowledgeCommands as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (client.sendCommandResult as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    vi.spyOn(runtime, "executeCommand").mockResolvedValue({
      protocolVersion: 1,
      commandId: "cmd-1",
      idempotencyKey: "cmd-1",
      state: "accepted",
      acknowledgedAt: 4_500,
      latestSequence: 1,
      result: { ok: true },
    });

    const sync = new EnvironmentAgentSessionSync({ runtime: sessionRuntime, client });
    const supervisor = new EnvironmentAgentSessionSupervisor({
      threadId: "thread-1",
      runtime,
      sessionRuntime,
      sessionSync: sync,
      pollIntervalMs: 5,
    });

    await supervisor.start();
    runtime.appendEvent({ type: "environment.ready", threadId: "thread-1" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await supervisor.close();
    await runtime.shutdown();

    expect(client.openSession).toHaveBeenCalledTimes(1);
    expect(client.pushEvents).toHaveBeenCalled();
    expect(client.acknowledgeCommands).toHaveBeenCalledWith("sess-1", {
      commands: [
        {
          commandId: "cmd-1",
          channelId: "thread-1",
          state: "received",
        },
      ],
      deliveredThrough: 1,
    });
    expect(client.sendCommandResult).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ commandId: "cmd-1", state: "started" }),
    );
    expect(client.sendCommandResult).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ commandId: "cmd-1", state: "completed" }),
    );
    expect(client.closeSession).toHaveBeenCalledWith("sess-1", "agent_shutdown");
  });
});
