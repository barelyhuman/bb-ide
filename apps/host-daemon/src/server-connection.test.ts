import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonCommandResultReportSchema,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonEventBatchRequestSchema,
  hostDaemonSessionOpenRequestSchema,
  type HostDaemonActiveThread,
  type HostDaemonCommandResultReport,
  type HostDaemonServerWsMessage,
  type HostDaemonSessionOpenRequest,
} from "@bb/host-daemon-contract";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { ServerConnection } from "./server-connection.js";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

type TestServer = Awaited<ReturnType<typeof createTestServer>>;

async function createTestServer(options: {
  commandResultFailures?: number;
} = {}) {
  const sessionOpenCalls: HostDaemonSessionOpenRequest[] = [];
  const heartbeats: Array<{ sessionId: string; message: { bufferDepth: number; lastCommandCursor?: number } }> = [];
  const commandResultReports: HostDaemonCommandResultReport[] = [];
  const activeSockets = new Set<WebSocket>();
  let sessionCounter = 0;
  let commandResultAttemptCount = 0;

  const app = new Hono();
  app.post("/internal/session/open", async (context) => {
    const payload = hostDaemonSessionOpenRequestSchema.parse(
      await context.req.json(),
    );
    sessionOpenCalls.push(payload);
    sessionCounter += 1;
    return context.json(
      {
        sessionId: `session-${sessionCounter}`,
        heartbeatIntervalMs: 25,
        leaseTimeoutMs: 500,
        threadHighWaterMarks: { threadA: 4 },
      },
      201,
    );
  });
  app.get("/internal/session/commands", (context) => {
    void context.req.query();
    return new Response(null, { status: 204 });
  });
  app.post("/internal/session/command-result", async (context) => {
    const payload = hostDaemonCommandResultReportSchema.parse(
      await context.req.json(),
    );
    commandResultReports.push(payload);
    commandResultAttemptCount += 1;
    if (commandResultAttemptCount <= (options.commandResultFailures ?? 0)) {
      return context.json({ ok: false }, 500);
    }
    return context.json({ ok: true });
  });
  app.post("/internal/session/events", async (context) => {
    const payload = hostDaemonEventBatchRequestSchema.parse(
      await context.req.json(),
    );
    const threadHighWaterMarks = Object.fromEntries(
      payload.events.map((event) => [event.threadId, event.sequence]),
    );
    return context.json({ threadHighWaterMarks });
  });

  const server = createServer(async (request, response) => {
    await serveHonoRequest(app, request, response);
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/internal/ws") {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      activeSockets.add(websocket);
      websocket.on("message", (data: RawData) => {
        const message = hostDaemonDaemonWsMessageSchema.parse(JSON.parse(data.toString("utf8")));
        heartbeats.push({
          sessionId: url.searchParams.get("sessionId") ?? "",
          message: {
            bufferDepth: message.bufferDepth,
            lastCommandCursor: message.lastCommandCursor,
          },
        });
      });
      websocket.on("close", () => {
        activeSockets.delete(websocket);
      });
      websocketServer.emit("connection", websocket, request);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    sessionOpenCalls,
    heartbeats,
    commandResultReports,
    get commandResultAttemptCount() {
      return commandResultAttemptCount;
    },
    sendWebSocketMessage(message: HostDaemonServerWsMessage): void {
      const encoded = JSON.stringify(message);
      for (const socket of activeSockets) {
        socket.send(encoded);
      }
    },
    closeWebSockets(): void {
      for (const socket of activeSockets) {
        socket.close();
      }
    },
    socketCount(): number {
      return activeSockets.size;
    },
    async close(): Promise<void> {
      for (const socket of activeSockets) {
        socket.close();
      }
      await new Promise<void>((resolve, reject) => {
        websocketServer.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function serveHonoRequest(
  app: Hono,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readRequestBody(request);
  const honoRequest = new Request(
    new URL(request.url ?? "/", "http://127.0.0.1"),
    {
      method: request.method,
      headers: request.headers as HeadersInit,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : body.toString("utf8"),
    },
  );
  const honoResponse = await app.fetch(honoRequest);

  response.statusCode = honoResponse.status;
  honoResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  const payload = Buffer.from(await honoResponse.arrayBuffer());
  response.end(payload);
}

describe("ServerConnection", () => {
  let testServer: TestServer | null = null;

  afterEach(async () => {
    await testServer?.close();
    testServer = null;
  });

  it("opens a session and returns the server config", async () => {
    testServer = await createTestServer();

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
    });

    const session = await connection.start();

    expect(session.sessionId).toBe("session-1");
    expect(session.threadHighWaterMarks).toEqual({ threadA: 4 });
    expect(testServer.sessionOpenCalls).toHaveLength(1);

    await connection.shutdown();
  });

  it("sends heartbeat messages over the websocket", async () => {
    testServer = await createTestServer();

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
      getHeartbeatPayload: () => ({
        bufferDepth: 3,
        lastCommandCursor: 7,
      }),
    });

    await connection.start();
    await waitFor(() => testServer!.heartbeats.length > 0);

    expect(testServer.heartbeats[0]).toEqual({
      sessionId: "session-1",
      message: {
        bufferDepth: 3,
        lastCommandCursor: 7,
      },
    });

    await connection.shutdown();
  });

  it("triggers the fetch callback when commands become available", async () => {
    testServer = await createTestServer();
    const onCommandsAvailable = vi.fn();

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
      onCommandsAvailable,
    });

    await connection.start();
    testServer.sendWebSocketMessage({ type: "commands-available" });
    await waitFor(() => onCommandsAvailable.mock.calls.length === 1);

    expect(onCommandsAvailable).toHaveBeenCalledTimes(1);
    await connection.shutdown();
  });

  it("triggers the shutdown callback when the server closes the session", async () => {
    testServer = await createTestServer();
    const onSessionClose = vi.fn();

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
      onSessionClose,
    });

    await connection.start();
    testServer.sendWebSocketMessage({
      type: "session-close",
      reason: "replaced",
    });
    await waitFor(() => onSessionClose.mock.calls.length === 1);
    await waitFor(() => testServer!.socketCount() === 0);

    expect(onSessionClose).toHaveBeenCalledWith("replaced");
  });

  it("reconnects after the websocket disconnects", async () => {
    testServer = await createTestServer();

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
      reconnectBaseMs: 20,
      reconnectMaxMs: 20,
      pollAfterDisconnectMs: 40,
      pollIntervalMs: 40,
      random: () => 0.5,
    });

    await connection.start();
    expect(testServer.sessionOpenCalls).toHaveLength(1);

    testServer.closeWebSockets();

    await waitFor(() => testServer!.sessionOpenCalls.length >= 2);
    expect(testServer.sessionOpenCalls).toHaveLength(2);

    await connection.shutdown();
  });

  it("retries command result delivery until the server accepts it", async () => {
    testServer = await createTestServer({ commandResultFailures: 1 });

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
      reconnectBaseMs: 20,
      reconnectMaxMs: 20,
      random: () => 0.5,
    });

    await connection.start();
    await connection.reportCommandResult({
      sessionId: "session-1",
      commandId: "cmd-1",
      cursor: 7,
      completedAt: 1,
      type: "turn.run",
      ok: true,
      result: {},
    });

    expect(testServer.commandResultAttemptCount).toBe(2);
    expect(testServer.commandResultReports).toEqual([
      hostDaemonCommandResultReportSchema.parse({
        sessionId: "session-1",
        commandId: "cmd-1",
        cursor: 7,
        completedAt: 1,
        type: "turn.run",
        ok: true,
        result: {},
      }),
      hostDaemonCommandResultReportSchema.parse({
        sessionId: "session-1",
        commandId: "cmd-1",
        cursor: 7,
        completedAt: 1,
        type: "turn.run",
        ok: true,
        result: {},
      }),
    ]);

    await connection.shutdown();
  });

  it("includes active threads when opening the session", async () => {
    testServer = await createTestServer();
    const activeThreads: HostDaemonActiveThread[] = [
      {
        environmentId: "env-1",
        threadId: "thread-1",
        providerThreadId: "provider-1",
      },
    ];

    const connection = new ServerConnection({
      serverUrl: testServer.baseUrl,
      authToken: "secret",
      hostId: "host-1",
      hostName: "Host One",
      hostType: "persistent",
      instanceId: "instance-1",
      getActiveThreads: () => activeThreads,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
    });

    await connection.start();

    expect(testServer.sessionOpenCalls[0]?.activeThreads).toEqual(activeThreads);

    await connection.shutdown();
  });
});
