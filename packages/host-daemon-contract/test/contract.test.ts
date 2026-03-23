import { describe, expect, it } from "vitest";
import {
  createHostDaemonClient,
  hostDaemonCommandResultSchemaByType,
  hostDaemonCommandSchema,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonEventBatchRequestSchema,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenRequestSchema,
  hostDaemonSessionOpenResponseSchema,
} from "../src/index.js";

describe("host-daemon command schemas", () => {
  it("parses valid workspace and provisioning commands", () => {
    expect(
      hostDaemonCommandSchema.parse({
        type: "workspace.commit",
        message: "Checkpoint work",
        includeUnstaged: true,
      }),
    ).toMatchObject({
      type: "workspace.commit",
      message: "Checkpoint work",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        projectId: "proj_123",
        strategy: "worktree",
        sourcePath: "/tmp/project",
        targetPath: "/tmp/project/.bb/env",
        branchName: "bb/env-123",
      }),
    ).toMatchObject({
      type: "environment.provision",
      strategy: "worktree",
    });
  });

  it("keeps typed per-command result schemas", () => {
    expect(
      hostDaemonCommandResultSchemaByType["workspace.import"].parse({
        previousBranch: "feature/demo",
        stashRef: "stash@{0}",
      }),
    ).toMatchObject({
      previousBranch: "feature/demo",
      stashRef: "stash@{0}",
    });

    expect(() =>
      hostDaemonCommandResultSchemaByType["workspace.commit"].parse({
        commitSha: "",
      }),
    ).toThrow();
  });
});

describe("host-daemon session schemas", () => {
  it("parses valid session open and event batch payloads", () => {
    expect(
      hostDaemonSessionOpenRequestSchema.parse({
        hostId: "host_123",
        instanceId: "instance_1",
        hostName: "Michael's MacBook",
        hostType: "persistent",
        protocolVersion: 2,
        activeThreads: [
          {
            environmentId: "env_123",
            threadId: "thr_123",
            providerThreadId: "provider_thr_123",
          },
        ],
      }),
    ).toMatchObject({
      hostId: "host_123",
      hostType: "persistent",
    });

    expect(
      hostDaemonSessionOpenResponseSchema.parse({
        sessionId: "session_123",
        heartbeatIntervalMs: 5_000,
        leaseTimeoutMs: 30_000,
      }),
    ).toMatchObject({
      sessionId: "session_123",
    });

    expect(
      hostDaemonEventBatchRequestSchema.parse({
        events: [
          {
            id: "evt_1",
            environmentId: "env_123",
            threadId: "thr_123",
            sequence: 1,
            createdAt: 1,
            event: {
              type: "system/error",
              threadId: "thr_123",
              message: "boom",
            },
          },
        ],
      }),
    ).toMatchObject({
      events: [
        {
          id: "evt_1",
        },
      ],
    });
  });

  it("restricts websocket messages to notifications and heartbeats", () => {
    expect(
      hostDaemonServerWsMessageSchema.parse({
        type: "commands-available",
      }),
    ).toEqual({ type: "commands-available" });

    expect(
      hostDaemonServerWsMessageSchema.parse({
        type: "session-close",
        reason: "replaced",
      }),
    ).toMatchObject({
      type: "session-close",
      reason: "replaced",
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "heartbeat",
        payload: {
          bufferDepth: 3,
          lastCommandCursor: 12,
        },
      }),
    ).toMatchObject({
      type: "heartbeat",
    });
  });

  it("builds an internal client rooted at /internal", () => {
    const client = createHostDaemonClient("http://localhost:3334", "secret", {
      sessionId: "session_123",
    });

    expect(client.session.open.$url().pathname).toBe("/internal/session/open");
    expect(client.session.commands.$url().pathname).toBe(
      "/internal/session/commands",
    );
    expect(client.session["command-result"].$url().pathname).toBe(
      "/internal/session/command-result",
    );
  });
});
