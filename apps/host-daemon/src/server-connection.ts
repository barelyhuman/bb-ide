import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonCommandBatchSchema,
  hostDaemonCommandResultReportSchema,
  hostDaemonCommandsQuerySchema,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonEventBatchRequestSchema,
  hostDaemonEventBatchResponseSchema,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenRequestSchema,
  hostDaemonSessionOpenResponseSchema,
  type HostDaemonActiveThread,
  type HostDaemonCommandEnvelope,
  type HostDaemonCommandResultReport,
  type HostDaemonEventEnvelope,
  type HostDaemonSessionOpenRequest,
  type HostDaemonSessionOpenResponse,
} from "@bb/host-daemon-contract";
import { WebSocket, type RawData } from "ws";

type FetchFn = typeof fetch;
type TimeoutHandle = ReturnType<typeof setTimeout>;
type IntervalHandle = ReturnType<typeof setInterval>;

export interface ServerConnectionOptions {
  serverUrl: string;
  authToken: string;
  hostId: string;
  hostName: string;
  hostType: HostDaemonSessionOpenRequest["hostType"];
  instanceId: string;
  getActiveThreads?: () =>
    | HostDaemonActiveThread[]
    | Promise<HostDaemonActiveThread[]>;
  getHeartbeatPayload?: () => {
    bufferDepth: number;
    lastCommandCursor?: number;
  };
  onCommandsAvailable?: () => void | Promise<void>;
  onSessionClose?: (
    reason: "replaced" | "expired" | "daemon-disconnect",
  ) => void | Promise<void>;
  fetchFn?: FetchFn;
  createWebSocket?: (url: string) => WebSocket;
  protocolVersion?: typeof HOST_DAEMON_PROTOCOL_VERSION;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  pollAfterDisconnectMs?: number;
  pollIntervalMs?: number;
  random?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_POLL_AFTER_DISCONNECT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

export class ServerConnection {
  private readonly fetchFn: FetchFn;
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly pollAfterDisconnectMs: number;
  private readonly pollIntervalMs: number;
  private readonly random: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  private session: HostDaemonSessionOpenResponse | null = null;
  private websocket: WebSocket | null = null;
  private reconnectTimer: TimeoutHandle | null = null;
  private pollingDelayTimer: TimeoutHandle | null = null;
  private pollingInterval: IntervalHandle | null = null;
  private heartbeatInterval: IntervalHandle | null = null;
  private reconnectAttempt = 0;
  private stopped = false;

  constructor(private readonly options: ServerConnectionOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.createWebSocket =
      options.createWebSocket ?? ((url) => new WebSocket(url));
    this.reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.pollAfterDisconnectMs =
      options.pollAfterDisconnectMs ?? DEFAULT_POLL_AFTER_DISCONNECT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.random = options.random ?? Math.random;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  get sessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  async start(): Promise<HostDaemonSessionOpenResponse> {
    this.stopped = false;
    return this.openSessionAndConnect();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.stopPollingFallback();
    this.clearReconnectTimer();
    this.clearHeartbeat();

    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.close();
      this.websocket = null;
    }
  }

  async fetchCommands(options: {
    afterCursor: number;
    limit?: number;
    waitMs?: number;
  }): Promise<HostDaemonCommandEnvelope[]> {
    const sessionId = this.requireSessionId();
    const query = hostDaemonCommandsQuerySchema.parse({
      sessionId,
      afterCursor: String(options.afterCursor),
      limit: options.limit === undefined ? undefined : String(options.limit),
      waitMs: options.waitMs === undefined ? undefined : String(options.waitMs),
    });

    const response = await this.fetchFn(
      this.buildInternalUrl("/session/commands", query),
      {
        method: "GET",
        headers: this.headers(),
      },
    );

    if (response.status === 204) {
      return [];
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch commands: ${response.status} ${response.statusText}`,
      );
    }

    const json = await response.json();
    const parsed = hostDaemonCommandBatchSchema.parse(json);
    return parsed.commands;
  }

  async reportCommandResult(
    report: HostDaemonCommandResultReport,
  ): Promise<void> {
    const payload = hostDaemonCommandResultReportSchema.parse(report);
    await this.retryWithBackoff(async () => {
      const response = await this.fetchFn(
        this.buildInternalUrl("/session/command-result"),
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to report command result: ${response.status} ${response.statusText}`,
        );
      }
    });
  }

  async postEvents(
    events: HostDaemonEventEnvelope[],
  ): Promise<Record<string, number>> {
    const payload = hostDaemonEventBatchRequestSchema.parse({
      sessionId: this.requireSessionId(),
      events,
    });
    const response = await this.fetchFn(this.buildInternalUrl("/session/events"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to post events: ${response.status} ${response.statusText}`,
      );
    }

    const json = await response.json();
    return hostDaemonEventBatchResponseSchema.parse(json).threadHighWaterMarks;
  }

  private async openSessionAndConnect(): Promise<HostDaemonSessionOpenResponse> {
    const session = await this.openSession();
    await this.connectWebSocket(session.sessionId);
    return session;
  }

  private async openSession(): Promise<HostDaemonSessionOpenResponse> {
    const activeThreads = await this.options.getActiveThreads?.();
    const payload = hostDaemonSessionOpenRequestSchema.parse({
      hostId: this.options.hostId,
      instanceId: this.options.instanceId,
      hostName: this.options.hostName,
      hostType: this.options.hostType,
      protocolVersion:
        this.options.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads,
    });

    const response = await this.fetchFn(this.buildInternalUrl("/session/open"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (response.status !== 201) {
      throw new Error(
        `Failed to open session: ${response.status} ${response.statusText}`,
      );
    }

    const json = await response.json();
    const session = hostDaemonSessionOpenResponseSchema.parse(json);
    this.session = session;
    this.resetHeartbeat();
    return session;
  }

  private async connectWebSocket(sessionId: string): Promise<void> {
    const websocketUrl = this.buildWebSocketUrl(sessionId);
    const websocket = this.createWebSocket(websocketUrl);

    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      websocket.on("open", () => {
        opened = true;
        settled = true;
        this.websocket = websocket;
        this.reconnectAttempt = 0;
        this.stopPollingFallback();
        resolve();
      });

      websocket.on("message", (data: RawData) => {
        this.handleWebSocketMessage(data);
      });

      websocket.on("close", () => {
        if (this.websocket === websocket) {
          this.websocket = null;
        }

        if (!opened) {
          fail(new Error("WebSocket closed before opening"));
        }

        if (this.stopped) {
          return;
        }

        this.startPollingFallback();
        this.scheduleReconnect();
      });

      websocket.on("error", (error: Error) => {
        if (!opened) {
          fail(error);
        }
      });
    });
  }

  private handleWebSocketMessage(data: RawData): void {
    const text =
      typeof data === "string"
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
        : Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Buffer.from(data).toString("utf8");
    const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(text));

    if (message.type === "commands-available") {
      void Promise.resolve(this.options.onCommandsAvailable?.()).catch(
        () => undefined,
      );
      return;
    }

    void Promise.resolve(this.options.onSessionClose?.(message.reason)).catch(
      () => undefined,
    );
    void this.shutdown();
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();

    if (!this.session) {
      return;
    }

    this.heartbeatInterval = this.setIntervalFn(() => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        return;
      }

      const payload = hostDaemonDaemonWsMessageSchema.parse({
        type: "heartbeat",
        ...(this.options.getHeartbeatPayload?.() ?? { bufferDepth: 0 }),
      });
      this.websocket.send(JSON.stringify(payload));
    }, this.session.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatInterval) {
      return;
    }
    this.clearIntervalFn(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    const delayMs = this.computeBackoffMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      void this.openSessionAndConnect().catch(() => {
        if (this.stopped) {
          return;
        }
        this.startPollingFallback();
        this.scheduleReconnect();
      });
    }, delayMs);
  }

  private startPollingFallback(): void {
    if (this.pollingDelayTimer || this.pollingInterval || this.stopped) {
      return;
    }

    this.pollingDelayTimer = this.setTimeoutFn(() => {
      this.pollingDelayTimer = null;
      void Promise.resolve(this.options.onCommandsAvailable?.()).catch(
        () => undefined,
      );
      this.pollingInterval = this.setIntervalFn(() => {
        void Promise.resolve(this.options.onCommandsAvailable?.()).catch(
          () => undefined,
        );
      }, this.pollIntervalMs);
    }, this.pollAfterDisconnectMs);
  }

  private stopPollingFallback(): void {
    if (this.pollingDelayTimer) {
      this.clearTimeoutFn(this.pollingDelayTimer);
      this.pollingDelayTimer = null;
    }
    if (this.pollingInterval) {
      this.clearIntervalFn(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }
    this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private computeBackoffMs(attempt: number): number {
    const baseDelay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** attempt,
    );
    const jitterFactor = 0.75 + this.random() * 0.5;
    return Math.round(baseDelay * jitterFactor);
  }

  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (this.stopped) {
          throw error;
        }
        const delayMs = this.computeBackoffMs(attempt);
        attempt += 1;
        await this.delay(delayMs);
      }
    }
  }

  private async delay(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.setTimeoutFn(resolve, delayMs);
    });
  }

  private requireSessionId(): string {
    if (!this.session?.sessionId) {
      throw new Error("Server session is not open");
    }
    return this.session.sessionId;
  }

  private headers(): HeadersInit {
    return {
      authorization: `Bearer ${this.options.authToken}`,
      "content-type": "application/json",
    };
  }

  private buildInternalUrl(
    pathname: string,
    query?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`/internal${pathname}`, this.options.serverUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private buildWebSocketUrl(sessionId: string): string {
    const serverUrl = new URL(this.options.serverUrl);
    serverUrl.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
    serverUrl.pathname = "/internal/ws";
    serverUrl.searchParams.set("sessionId", sessionId);
    serverUrl.searchParams.set("token", this.options.authToken);
    return serverUrl.toString();
  }
}
