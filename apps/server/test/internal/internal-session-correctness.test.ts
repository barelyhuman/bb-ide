import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import {
  getActiveSession,
  getEnvironment,
  getThread,
  hostDaemonCommands,
  hostDaemonSessions,
  listEvents,
  markThreadDeleted,
} from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  buildHostDaemonWebSocketAuthorizationHeader,
  buildHostDaemonWebSocketProtocols,
  createHostDaemonClient,
} from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { DAEMON_DISCONNECT_GRACE_MS } from "../../src/constants.js";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import {
  onDaemonSocketClose,
  onDaemonSocketMessage,
  validateDaemonWebSocket,
} from "../../src/ws/daemon-protocol.js";
import {
  internalAuthHeaders,
  listQueuedEnvironmentCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import { readJson } from "../helpers/json.js";
import {
  createTestDaemonHostKey,
  createTestAppHarness,
  startTestServer,
  withTestHarness,
} from "../helpers/test-app.js";

async function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
}

async function waitForImmediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitForCloseDetails(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    });
    socket.once("error", reject);
  });
}

async function waitForUpgradeRejectionStatus(
  socket: WebSocket,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("unexpected-response", onUnexpectedResponse);
      socket.off("open", onOpen);
      socket.off("error", onError);
    };

    const onUnexpectedResponse = (
      _request: unknown,
      response: { statusCode?: number },
    ) => {
      cleanup();
      resolve(response.statusCode ?? 0);
    };

    const onOpen = () => {
      cleanup();
      reject(new Error("Expected websocket upgrade to be rejected"));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once("unexpected-response", onUnexpectedResponse);
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

function createDaemonWebSocket(args: {
  hostKey: string;
  serverBaseUrl: string;
  sessionId: string;
}): WebSocket {
  return new WebSocket(
    `${args.serverBaseUrl.replace("http", "ws")}/internal/ws?sessionId=${encodeURIComponent(args.sessionId)}`,
    buildHostDaemonWebSocketProtocols(),
    {
      headers: {
        authorization: buildHostDaemonWebSocketAuthorizationHeader(
          args.hostKey,
        ),
      },
    },
  );
}

describe("internal session correctness", () => {
  it("throws ApiError for daemon websocket upgrades missing a sessionId", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        validateDaemonWebSocket(harness.deps, {
          authorizationHeader: buildHostDaemonWebSocketAuthorizationHeader(
            createTestDaemonHostKey(),
          ),
          protocolHeader: buildHostDaemonWebSocketProtocols().join(", "),
          sessionId: null,
        }),
      ).rejects.toThrowError(ApiError);
      await expect(
        validateDaemonWebSocket(harness.deps, {
          authorizationHeader: buildHostDaemonWebSocketAuthorizationHeader(
            createTestDaemonHostKey(),
          ),
          protocolHeader: buildHostDaemonWebSocketProtocols().join(", "),
          sessionId: null,
        }),
      ).rejects.toThrowError("Unauthorized");
    });
  });

  it("rejects daemon websocket upgrades missing the daemon protocol", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        validateDaemonWebSocket(harness.deps, {
          authorizationHeader: buildHostDaemonWebSocketAuthorizationHeader(
            createTestDaemonHostKey(),
          ),
          protocolHeader: undefined,
          sessionId: "session-1",
        }),
      ).rejects.toThrowError("Unsupported host daemon websocket protocol");
    });
  });

  it("returns an empty command batch instead of timing out when the queue is empty", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, {
        id: "host-empty-queue",
      });

      const response = await harness.app.request(
        `/internal/session/commands?sessionId=${session.id}&limit=100&waitMs=0`,
        {
          headers: internalAuthHeaders(harness, { hostId: session.hostId }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        commands: [],
      });
    });
  });

  it("extends the session lease when the daemon websocket sends a heartbeat", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({ hostId: "host-heartbeat" });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const sessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-heartbeat",
          instanceId: "instance-1",
          hostName: "Heartbeat Host",
          hostType: "persistent",
          dataDir: "/tmp/host-heartbeat-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json();
      const initialLease = server.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.sessionId))
        .get()?.leaseExpiresAt;
      expect(initialLease).toBeTypeOf("number");

      const socket = createDaemonWebSocket({
        hostKey,
        serverBaseUrl: server.baseUrl,
        sessionId: session.sessionId,
      });
      await waitForOpen(socket);
      await sleep(10);
      socket.send(
        JSON.stringify({
          type: "heartbeat",
        }),
      );
      await sleep(25);

      const updatedLease = server.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.sessionId))
        .get()?.leaseExpiresAt;
      expect(updatedLease).toBeGreaterThan(initialLease ?? 0);
      const closed = waitForClose(socket);
      socket.close();
      await closed;
    } finally {
      await server.close();
    }
  });

  it("returns server-retired loaded environments when opening a session", async () => {
    await withTestHarness(async (harness) => {
      const hostA = seedHostSession(harness.deps, {
        id: "host-loaded-env-a",
      });
      const hostB = seedHostSession(harness.deps, {
        id: "host-loaded-env-b",
      });
      const projectA = seedProjectWithSource(harness.deps, {
        hostId: hostA.host.id,
      }).project;
      const projectB = seedProjectWithSource(harness.deps, {
        hostId: hostB.host.id,
      }).project;
      const retainedEnvironment = seedEnvironment(harness.deps, {
        hostId: hostA.host.id,
        path: "/tmp/loaded-env-retained",
        projectId: projectA.id,
        status: "ready",
      });
      const destroyedEnvironment = seedEnvironment(harness.deps, {
        hostId: hostA.host.id,
        path: "/tmp/loaded-env-destroyed",
        projectId: projectA.id,
        status: "destroyed",
      });
      const otherHostEnvironment = seedEnvironment(harness.deps, {
        hostId: hostB.host.id,
        path: "/tmp/loaded-env-other-host",
        projectId: projectB.id,
        status: "ready",
      });

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness, {
          hostId: hostA.host.id,
          hostType: hostA.host.type,
        }),
        body: JSON.stringify({
          hostId: hostA.host.id,
          instanceId: "instance-loaded-env-reconcile",
          hostName: hostA.host.name,
          hostType: hostA.host.type,
          dataDir: "/tmp/host-loaded-env-reconcile",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
          loadedEnvironments: [
            { environmentId: retainedEnvironment.id },
            { environmentId: destroyedEnvironment.id },
            { environmentId: otherHostEnvironment.id },
            { environmentId: "env_missing_loaded" },
          ],
        }),
      });

      expect(response.status).toBe(201);
      await expect(readJson(response)).resolves.toMatchObject({
        retiredEnvironmentIds: [
          destroyedEnvironment.id,
          otherHostEnvironment.id,
          "env_missing_loaded",
        ],
      });
    });
  });

  it("rejects a session open whose protocol version does not match the server", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({ hostId: "host-protocol" });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const response = await daemonClient.session.open.$post({
        json: {
          hostId: "host-protocol",
          instanceId: "instance-1",
          hostName: "Protocol Host",
          hostType: "persistent",
          dataDir: "/tmp/host-protocol-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
          activeThreads: [],
        },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "protocol_version_mismatch",
      });
    } finally {
      await server.close();
    }
  });

  it("closes the daemon websocket with 1008 on malformed messages", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({
        hostId: "host-malformed-heartbeat",
      });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const sessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-malformed-heartbeat",
          instanceId: "instance-1",
          hostName: "Malformed Heartbeat Host",
          hostType: "persistent",
          dataDir: "/tmp/host-malformed-heartbeat-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json();

      const socket = createDaemonWebSocket({
        hostKey,
        serverBaseUrl: server.baseUrl,
        sessionId: session.sessionId,
      });
      await waitForOpen(socket);

      const closed = waitForCloseDetails(socket);
      socket.send("{");

      await expect(closed).resolves.toEqual({
        code: 1008,
        reason: "invalid-message",
      });
    } finally {
      await server.close();
    }
  });

  it("closes the daemon websocket with 1008 on invalid heartbeat payloads", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({
        hostId: "host-invalid-heartbeat",
      });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const sessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-invalid-heartbeat",
          instanceId: "instance-1",
          hostName: "Invalid Heartbeat Host",
          hostType: "persistent",
          dataDir: "/tmp/host-invalid-heartbeat-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json();

      const socket = createDaemonWebSocket({
        hostKey,
        serverBaseUrl: server.baseUrl,
        sessionId: session.sessionId,
      });
      await waitForOpen(socket);

      const closed = waitForCloseDetails(socket);
      socket.send(
        JSON.stringify({
          type: "heartbeat",
          bufferDepth: 1,
        }),
      );

      await expect(closed).resolves.toEqual({
        code: 1008,
        reason: "invalid-message",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects daemon websocket upgrades when the authenticated host does not own the session", async () => {
    const server = await startTestServer();
    try {
      const sessionHostKey = await server.deps.machineAuth.issueDaemonHostKey({
        hostId: "host-ws-owner",
        hostType: "persistent",
      });
      const otherHostKey = await server.deps.machineAuth.issueDaemonHostKey({
        hostId: "host-ws-other",
        hostType: "persistent",
      });
      const daemonClient = createHostDaemonClient(
        server.baseUrl,
        sessionHostKey,
      );
      const sessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-ws-owner",
          instanceId: "instance-1",
          hostName: "WebSocket Owner",
          hostType: "persistent",
          dataDir: "/tmp/host-ws-owner",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json();

      const socket = createDaemonWebSocket({
        hostKey: otherHostKey,
        serverBaseUrl: server.baseUrl,
        sessionId: session.sessionId,
      });

      await expect(waitForUpgradeRejectionStatus(socket)).resolves.toBe(403);
    } finally {
      await server.close();
    }
  });

  it("closes the daemon websocket with 1008 when the session is no longer active", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey({
        hostId: "host-inactive-session",
      });
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);
      const sessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-inactive-session",
          instanceId: "instance-1",
          hostName: "Inactive Session Host",
          hostType: "persistent",
          dataDir: "/tmp/host-inactive-session-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json();

      const socket = createDaemonWebSocket({
        hostKey,
        serverBaseUrl: server.baseUrl,
        sessionId: session.sessionId,
      });
      await waitForOpen(socket);

      // Close the session in the DB so the next heartbeat finds it inactive.
      server.db
        .update(hostDaemonSessions)
        .set({
          status: "closed",
          closedAt: Date.now(),
          closeReason: "replaced",
        })
        .where(eq(hostDaemonSessions.id, session.sessionId))
        .run();

      const closed = waitForCloseDetails(socket);
      socket.send(JSON.stringify({ type: "heartbeat" }));

      await expect(closed).resolves.toEqual({
        code: 1008,
        reason: "inactive-session",
      });
    } finally {
      await server.close();
    }
  });

  it("logs inactive daemon heartbeats without an ApiError stack", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-inactive-heartbeat-log",
      });
      harness.db
        .update(hostDaemonSessions)
        .set({
          status: "closed",
          closedAt: Date.now(),
          closeReason: "expired",
        })
        .where(eq(hostDaemonSessions.id, session.id))
        .run();

      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      const socket = {
        close: vi.fn(),
        send: vi.fn(),
      };

      onDaemonSocketMessage(
        {
          config: harness.config,
          db: harness.db,
          hub: harness.hub,
          logger,
          terminalSessions: harness.deps.terminalSessions,
        },
        {
          hostId: host.id,
          raw: JSON.stringify({ type: "heartbeat" }),
          sessionId: session.id,
          socket,
        },
      );

      expect(socket.close).toHaveBeenCalledWith(1008, "inactive-session");
      expect(logger.info).toHaveBeenCalledWith(
        { sessionId: session.id },
        "Daemon heartbeat for inactive session, closing socket",
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  it("warns and closes distinctly when daemon heartbeats use another host session", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, {
        id: "host-heartbeat-owner",
      });

      const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      const socket = {
        close: vi.fn(),
        send: vi.fn(),
      };

      onDaemonSocketMessage(
        {
          config: harness.config,
          db: harness.db,
          hub: harness.hub,
          logger,
          terminalSessions: harness.deps.terminalSessions,
        },
        {
          hostId: "host-heartbeat-intruder",
          raw: JSON.stringify({ type: "heartbeat" }),
          sessionId: session.id,
          socket,
        },
      );

      expect(socket.close).toHaveBeenCalledWith(1008, "unauthorized-session");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(ApiError),
          sessionId: session.id,
        }),
        "Daemon heartbeat for unauthorized session, closing socket",
      );
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  it("closes the daemon session immediately when the websocket disconnects", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, {
        id: "host-daemon-disconnect",
      });

      onDaemonSocketClose(harness.deps, session.id);

      const closedSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(closedSession?.status).toBe("closed");
      expect(closedSession?.closeReason).toBe("daemon-disconnect");
    });
  });

  it("keeps active threads active and reports host wait state after the grace period expires", async () => {
    const harness = await createTestAppHarness();
    try {
      vi.useFakeTimers();
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-daemon-active-disconnect",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });

      onDaemonSocketClose(harness.deps, session.id);
      const reconnectingResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(reconnectingResponse.status).toBe(200);
      expect(
        threadResponseSchema.parse(await readJson(reconnectingResponse))
          .runtime,
      ).toMatchObject({
        displayStatus: "host-reconnecting",
        hostReconnectGraceExpiresAt: expect.any(Number),
      });

      await vi.advanceTimersByTimeAsync(DAEMON_DISCONNECT_GRACE_MS);

      const closedSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(closedSession?.closeReason).toBe("daemon-disconnect");
      const interruptedThread = getThread(harness.db, thread.id);
      expect(interruptedThread?.status).toBe("active");
      expect(interruptedThread?.latestAttentionAt).toBe(
        thread.latestAttentionAt,
      );

      const threadEventsAfterGrace = listEvents(harness.db, {
        threadId: thread.id,
      });
      expect(
        threadEventsAfterGrace.some((event) => event.type === "system/error"),
      ).toBe(false);
      expect(
        threadEventsAfterGrace.some(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toBe(false);

      const waitingResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(waitingResponse.status).toBe(200);
      expect(
        threadResponseSchema.parse(await readJson(waitingResponse)).runtime,
      ).toMatchObject({
        displayStatus: "waiting-for-host",
        hostReconnectGraceExpiresAt: null,
      });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("interrupts pending interactions after the daemon-disconnect grace period", async () => {
    const harness = await createTestAppHarness();
    try {
      vi.useFakeTimers();
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-daemon-pending-interaction-disconnect",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-disconnect-pending-interaction",
        providerThreadId: "provider-thread-disconnect-pending-interaction",
      });

      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-disconnect-pending-interaction",
            providerId: "codex",
            providerThreadId: "provider-thread-disconnect-pending-interaction",
            providerRequestId: "request-disconnect-pending-interaction",
            payload: createCommandApprovalPayload({
              itemId: "item-disconnect-pending-interaction",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
          sessionId: session.id,
        });
      if (registered.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${registered.reason}`,
        );
      }

      onDaemonSocketClose(harness.deps, session.id);
      await vi.advanceTimersByTimeAsync(DAEMON_DISCONNECT_GRACE_MS);

      const interrupted = harness.deps.pendingInteractions.getThreadInteraction(
        {
          threadId: thread.id,
          interactionId: registered.interaction.id,
        },
      );
      expect(interrupted).toMatchObject({
        status: "interrupted",
        statusReason:
          "Host daemon disconnected while awaiting user interaction; retry the thread to continue",
      });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("closes expired lease sockets and interrupts pending interactions during sweeps", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-daemon-expired-lease-interaction",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-expired-lease-pending-interaction",
        providerThreadId: "provider-thread-expired-lease-pending-interaction",
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-expired-lease-pending-interaction",
            providerId: "codex",
            providerThreadId:
              "provider-thread-expired-lease-pending-interaction",
            providerRequestId: "request-expired-lease-pending-interaction",
            payload: createCommandApprovalPayload({
              itemId: "item-expired-lease-pending-interaction",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
          sessionId: session.id,
        });
      if (registered.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${registered.reason}`,
        );
      }

      const socket = {
        close: vi.fn(),
        send: vi.fn(),
      };
      harness.hub.registerDaemon(session.id, host.id, socket);
      harness.db
        .update(hostDaemonSessions)
        .set({ leaseExpiresAt: Date.now() - 1_000 })
        .where(eq(hostDaemonSessions.id, session.id))
        .run();

      await runPeriodicSweeps(harness.deps);

      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "session-close", reason: "expired" }),
      );
      expect(socket.close).toHaveBeenCalledWith(1000, "expired");
      const expiredSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(expiredSession?.status).toBe("closed");
      expect(expiredSession?.closeReason).toBe("expired");

      const interrupted = harness.deps.pendingInteractions.getThreadInteraction(
        {
          threadId: thread.id,
          interactionId: registered.interaction.id,
        },
      );
      expect(interrupted).toMatchObject({
        status: "interrupted",
        statusReason:
          "Host daemon session expired while awaiting user interaction; retry the thread to continue",
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("active");

      const threadResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(threadResponse.status).toBe(200);
      expect(
        threadResponseSchema.parse(await readJson(threadResponse)).runtime,
      ).toMatchObject({
        displayStatus: "waiting-for-host",
        hostReconnectGraceExpiresAt: null,
      });
    });
  });

  it("keeps pending interactions and runtime connected when a replacement session opens during grace", async () => {
    const harness = await createTestAppHarness();
    try {
      vi.useFakeTimers();
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-daemon-reconnect",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-reconnect-pending-interaction",
        providerThreadId: "provider-thread-reconnect-pending-interaction",
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-reconnect-pending-interaction",
            providerId: "codex",
            providerThreadId: "provider-thread-reconnect-pending-interaction",
            providerRequestId: "request-reconnect-pending-interaction",
            payload: createCommandApprovalPayload({
              itemId: "item-reconnect-pending-interaction",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
          sessionId: session.id,
        });
      if (registered.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${registered.reason}`,
        );
      }

      onDaemonSocketClose(harness.deps, session.id);

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness, {
          hostId: host.id,
          hostType: host.type,
        }),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-1",
          hostName: host.name,
          hostType: host.type,
          dataDir: "/tmp/host-daemon-reconnect-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [{ threadId: thread.id }],
        }),
      });
      expect(response.status).toBe(201);
      await vi.advanceTimersByTimeAsync(DAEMON_DISCONNECT_GRACE_MS);

      const activeSession = getActiveSession(harness.db, host.id);
      expect(activeSession?.id).not.toBe(session.id);
      expect(activeSession?.status).toBe("active");

      const originalSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(originalSession?.closeReason).toBe("daemon-disconnect");
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      const interrupted = harness.deps.pendingInteractions.getThreadInteraction(
        {
          threadId: thread.id,
          interactionId: registered.interaction.id,
        },
      );
      expect(interrupted).toMatchObject({
        status: "pending",
        statusReason: null,
      });
      const threadResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(threadResponse.status).toBe(200);
      expect(
        threadResponseSchema.parse(await readJson(threadResponse)).runtime,
      ).toMatchObject({
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).some(
          (event) => event.type === "system/error",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("interrupts pending interactions when a same-instance reconnect no longer reports an active thread", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-daemon-same-instance-disowns-thread",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-same-instance-disowned-interaction",
        providerThreadId: "provider-thread-same-instance-disowned",
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-same-instance-disowned-interaction",
            providerId: "codex",
            providerThreadId: "provider-thread-same-instance-disowned",
            providerRequestId: "request-same-instance-disowned",
            payload: createCommandApprovalPayload({
              itemId: "item-same-instance-disowned",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
          sessionId: session.id,
        });
      if (registered.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${registered.reason}`,
        );
      }

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness, {
          hostId: host.id,
          hostType: host.type,
        }),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-1",
          hostName: host.name,
          hostType: host.type,
          dataDir: "/tmp/host-daemon-same-instance-disowns-thread",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });

      expect(response.status).toBe(201);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      const interrupted = harness.deps.pendingInteractions.getThreadInteraction({
        threadId: thread.id,
        interactionId: registered.interaction.id,
      });
      expect(interrupted).toMatchObject({
        status: "interrupted",
        statusReason: "Host daemon restarted while awaiting user interaction",
      });

      const originalSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(originalSession?.closeReason).toBe("replaced");
    });
  });

  it("defers cleanup preflight when reconnect finalizes a deleted thread during session open", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-session-open-deferred-cleanup",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/session-open-deferred-cleanup",
        status: "ready",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        isGitRepo: true,
        mergeBaseBranch: "main",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      markThreadDeleted(harness.db, harness.hub, {
        threadId: thread.id,
        deletedAt: 1_700_000_000_000,
      });

      const sessionOpen = harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness, {
          hostId: host.id,
          hostType: host.type,
        }),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-session-open-deferred-cleanup",
          hostName: host.name,
          hostType: host.type,
          dataDir: "/tmp/session-open-deferred-cleanup-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });
      const response = await Promise.race([
        sessionOpen,
        sleep(50).then(() => null),
      ]);

      if (response === null) {
        throw new Error(
          "Session open waited for environment cleanup preflight instead of returning",
        );
      }
      expect(response.status).toBe(201);
      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        cleanupMode: "safe",
        cleanupRequestedAt: expect.any(Number),
      });
      expect(
        listQueuedEnvironmentCommands(
          harness,
          "environment.cleanup_preflight",
          environment.id,
        ),
      ).toEqual([]);

      await waitForImmediate();

      const preflightCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.cleanup_preflight" &&
          command.environmentId === environment.id,
      );
      const preflightResponse = await reportQueuedCommandSuccess(
        harness,
        preflightCommand,
        { outcome: "safe_to_destroy" },
        { hostId: host.id, hostType: host.type },
      );
      expect(preflightResponse.status).toBe(200);

      const destroyCommand = await waitForQueuedCommandAfter(
        harness,
        preflightCommand.row.cursor,
        ({ command }) =>
          command.type === "environment.destroy" &&
          command.environmentId === environment.id,
      );
      expect(destroyCommand.command).toMatchObject({
        environmentId: environment.id,
      });
      expect(
        harness.db
          .select()
          .from(hostDaemonCommands)
          .where(eq(hostDaemonCommands.type, "environment.cleanup_preflight"))
          .all(),
      ).toHaveLength(1);
    });
  });

  it("interrupts pending interactions when a replacement daemon session has a new instance id", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-daemon-session-restart-interaction",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-session-restart-interaction",
        providerThreadId: "provider-thread-session-restart-interaction",
      });

      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: thread.id,
            turnId: "turn-session-restart-interaction",
            providerId: "codex",
            providerThreadId: "provider-thread-session-restart-interaction",
            providerRequestId: "request-session-restart-interaction",
            payload: createCommandApprovalPayload({
              itemId: "item-session-restart-interaction",
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
            }),
          },
          sessionId: session.id,
        });
      if (registered.outcome === "rejected") {
        throw new Error(
          `Expected interaction registration to succeed: ${registered.reason}`,
        );
      }

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness, {
          hostId: host.id,
          hostType: host.type,
        }),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-restarted",
          hostName: host.name,
          hostType: host.type,
          dataDir: "/tmp/host-daemon-session-restart-interaction",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });

      expect(response.status).toBe(201);
      const interrupted = harness.deps.pendingInteractions.getThreadInteraction(
        {
          threadId: thread.id,
          interactionId: registered.interaction.id,
        },
      );
      expect(interrupted).toMatchObject({
        status: "interrupted",
        statusReason:
          "Host daemon restarted while awaiting user interaction; retry the thread to continue",
      });

      const originalSession = harness.db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(originalSession?.closeReason).toBe("replaced");
    });
  });
});
