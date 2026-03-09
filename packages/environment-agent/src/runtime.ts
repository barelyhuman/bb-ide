import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ENVIRONMENT_AGENT_PROTOCOL_VERSION,
  type EnvironmentAgentAckRequest,
  type EnvironmentAgentAckResponse,
  type EnvironmentAgentCommand,
  type EnvironmentAgentCommandEnvelope,
  type EnvironmentAgentCommandAck,
  type EnvironmentAgentDaemonConnectionConfig,
  type EnvironmentAgentDeliveryReason,
  type EnvironmentAgentDeliveryResponse,
  type EnvironmentAgentDeliveryRuntimeState,
  type EnvironmentAgentEvent,
  type EnvironmentAgentEventEnvelope,
  type EnvironmentAgentProviderFile,
  type EnvironmentAgentProviderSpec,
  type EnvironmentAgentProviderStatus,
  type EnvironmentAgentReplayRequest,
  type EnvironmentAgentReplayResponse,
  type EnvironmentAgentStatusSnapshot,
} from "./protocol.js";

export interface EnvironmentAgentRuntimeOptions {
  threadId?: string;
  projectId?: string;
  environmentId?: string;
  daemonConnection?: EnvironmentAgentDaemonConnectionConfig;
  providerCommand?: string;
  providerArgs?: string[];
  providerLaunchCommand?: string;
  providerLaunchArgs?: string[];
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

const INITIAL_DELIVERY_BACKOFF_MS = 250;
const MAX_DELIVERY_BACKOFF_MS = 30_000;
const MAX_AUTOMATIC_DELIVERY_RETRIES = 8;

export class EnvironmentAgentRuntime {
  private readonly events: EnvironmentAgentEventEnvelope[] = [];
  private sequence = 0;
  private providerRequestId = 0;
  private lastAckedSequence = 0;
  private pendingCommandCount = 0;
  private providerChild: ChildProcess | null = null;
  private readonly stdoutLineSubscribers = new Set<(line: string) => void>();
  private readonly stderrLineSubscribers = new Set<(line: string) => void>();
  private readonly eventSubscribers = new Set<(event: EnvironmentAgentEventEnvelope) => void>();
  private daemonConnection: EnvironmentAgentDaemonConnectionConfig | undefined;
  private connectedToDaemon = false;
  private deliveryInFlight: Promise<void> | null = null;
  private deliveryRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private deliveryBackoffMs = INITIAL_DELIVERY_BACKOFF_MS;
  private deliveryState: EnvironmentAgentDeliveryRuntimeState = "healthy";
  private deliveryIssue: EnvironmentAgentDeliveryReason | undefined;
  private deliveryRetryAttemptCount = 0;
  private nextRetryAt: number | undefined;
  private lastDeliveryError: string | undefined;

  constructor(private readonly opts: EnvironmentAgentRuntimeOptions) {
    this.daemonConnection = opts.daemonConnection
      ? { ...opts.daemonConnection }
      : undefined;
  }

  start(): ChildProcess | null {
    this.appendEvent({
      type: "environment.ready",
      threadId: this.resolveThreadId(),
    });

    this.triggerDaemonDelivery();

    return this.ensureProviderRunning();
  }

  appendEvent(event: EnvironmentAgentEvent): EnvironmentAgentEventEnvelope {
    const envelope: EnvironmentAgentEventEnvelope = {
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      sequence: ++this.sequence,
      emittedAt: Date.now(),
      threadId: event.threadId,
      event,
    };
    this.events.push(envelope);
    this.emitEvent(envelope);
    this.triggerDaemonDelivery();
    return envelope;
  }

  sendProviderLine(line: string): void {
    if (!line.trim()) return;
    this.providerChild?.stdin?.write(`${line}\n`);
  }

  ensureProviderRunning(spec?: EnvironmentAgentProviderSpec): ChildProcess | null {
    if (this.providerChild && !this.providerChild.killed) {
      return this.providerChild;
    }

    const resolvedSpec = this.resolveProviderSpec(spec);
    if (!resolvedSpec) {
      return null;
    }

    const child = this.spawnProvider(resolvedSpec);
    this.providerChild = child;
    return child;
  }

  getProviderStatus(): EnvironmentAgentProviderStatus {
    const child = this.providerChild;
    const running = Boolean(child && child.exitCode === null && !child.killed);
    return {
      running,
      launched: running,
      ...(typeof child?.pid === "number" ? { pid: child.pid } : {}),
    };
  }

  subscribeToProviderStdout(listener: (line: string) => void): () => void {
    this.stdoutLineSubscribers.add(listener);
    return () => {
      this.stdoutLineSubscribers.delete(listener);
    };
  }

  subscribeToProviderStderr(listener: (line: string) => void): () => void {
    this.stderrLineSubscribers.add(listener);
    return () => {
      this.stderrLineSubscribers.delete(listener);
    };
  }

  subscribeToEvents(listener: (event: EnvironmentAgentEventEnvelope) => void): () => void {
    this.eventSubscribers.add(listener);
    return () => {
      this.eventSubscribers.delete(listener);
    };
  }

  acknowledge(request: EnvironmentAgentAckRequest): EnvironmentAgentAckResponse {
    this.lastAckedSequence = Math.max(this.lastAckedSequence, request.sequence);
    return {
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      acknowledgedSequence: this.lastAckedSequence,
      ...(request.threadId ? { threadId: request.threadId } : {}),
    };
  }

  replay(request: EnvironmentAgentReplayRequest): EnvironmentAgentReplayResponse {
    const events = this.events.filter((event) => event.sequence > request.afterSequence);
    const limitedEvents =
      request.limit && request.limit > 0 ? events.slice(0, request.limit) : events;
    const toSequenceInclusive =
      limitedEvents.length > 0
        ? limitedEvents[limitedEvents.length - 1]!.sequence
        : request.afterSequence;
    return {
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      fromSequenceExclusive: request.afterSequence,
      toSequenceInclusive,
      events: limitedEvents,
      hasMore: limitedEvents.length < events.length,
    };
  }

  createCommandAck(args: {
    commandId: string;
    idempotencyKey: string;
    state: EnvironmentAgentCommandAck["state"];
    message?: string;
  }): EnvironmentAgentCommandAck {
    return {
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      commandId: args.commandId,
      idempotencyKey: args.idempotencyKey,
      state: args.state,
      acknowledgedAt: Date.now(),
      latestSequence: this.sequence,
      ...(args.message ? { message: args.message } : {}),
    };
  }

  getStatusSnapshot(): EnvironmentAgentStatusSnapshot {
    return {
      protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
      ...(this.opts.threadId ? { threadId: this.opts.threadId } : {}),
      ...(this.opts.projectId ? { projectId: this.opts.projectId } : {}),
      ...(this.opts.environmentId ? { environmentId: this.opts.environmentId } : {}),
      latestSequence: this.sequence,
      ...(this.lastAckedSequence > 0
        ? { lastAckedSequence: this.lastAckedSequence }
        : {}),
      connectedToDaemon: this.connectedToDaemon,
      pendingEventCount: Math.max(0, this.sequence - this.lastAckedSequence),
      pendingCommandCount: this.pendingCommandCount,
      deliveryState: this.deliveryState,
      ...(this.deliveryIssue ? { deliveryIssue: this.deliveryIssue } : {}),
      retryAttemptCount: this.deliveryRetryAttemptCount,
      ...(this.nextRetryAt ? { nextRetryAt: this.nextRetryAt } : {}),
      ...(this.lastDeliveryError ? { lastDeliveryError: this.lastDeliveryError } : {}),
    };
  }

  triggerDaemonDelivery(opts?: { nudge?: boolean }): void {
    if (!this.hasDaemonDeliveryConfig()) {
      this.connectedToDaemon = false;
      return;
    }
    if (this.deliveryState === "stopped") {
      return;
    }
    if (this.deliveryState === "stalled" && !opts?.nudge) {
      return;
    }

    if (this.deliveryRetryTimer) {
      clearTimeout(this.deliveryRetryTimer);
      this.deliveryRetryTimer = undefined;
      this.nextRetryAt = undefined;
    }
    if (this.deliveryInFlight) {
      return;
    }

    this.deliveryInFlight = this.flushDaemonDelivery()
      .catch(() => {
        // Retry is scheduled by flushDaemonDelivery on failure.
      })
      .finally(() => {
        this.deliveryInFlight = null;
      });
  }

  executeCommand(
    envelope: EnvironmentAgentCommandEnvelope,
  ): EnvironmentAgentCommandAck {
    try {
      this.ensureProviderForCommand(envelope.command);
      this.sendProviderLine(this.toProviderCommandLine(envelope.command));
      return this.createCommandAck({
        commandId: envelope.meta.commandId,
        idempotencyKey: envelope.meta.idempotencyKey,
        state: "accepted",
      });
    } catch (error) {
      return this.createCommandAck({
        commandId: envelope.meta.commandId,
        idempotencyKey: envelope.meta.idempotencyKey,
        state: "rejected",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private emitProviderStdoutLine(line: string): void {
    for (const subscriber of this.stdoutLineSubscribers) {
      subscriber(line);
    }
  }

  private emitProviderStderrLine(line: string): void {
    for (const subscriber of this.stderrLineSubscribers) {
      subscriber(line);
    }
  }

  private emitEvent(event: EnvironmentAgentEventEnvelope): void {
    for (const subscriber of this.eventSubscribers) {
      subscriber(event);
    }
  }

  ensureProviderStatus(spec?: EnvironmentAgentProviderSpec): EnvironmentAgentProviderStatus {
    const launchedBefore = this.getProviderStatus().running;
    const child = this.ensureProviderRunning(spec);
    const status = this.getProviderStatus();
    if (!launchedBefore && child) {
      return {
        ...status,
        launched: true,
      };
    }
    return status;
  }

  private resolveProviderSpec(
    spec?: EnvironmentAgentProviderSpec,
  ): EnvironmentAgentProviderSpec | null {
    const command = spec?.command ?? this.opts.providerCommand;
    if (!command?.trim()) {
      return null;
    }
    return {
      command: command.trim(),
      args: [...(spec?.args ?? this.opts.providerArgs ?? [])],
      launchCommand: spec?.launchCommand ?? this.opts.providerLaunchCommand,
      launchArgs: [...(spec?.launchArgs ?? this.opts.providerLaunchArgs ?? [])],
      ...(spec?.env ? { env: { ...spec.env } } : {}),
      ...(spec?.files ? { files: spec.files.map((file) => ({ ...file })) } : {}),
    };
  }

  private spawnProvider(spec: EnvironmentAgentProviderSpec): ChildProcess {
    const command = spec.launchCommand?.trim() || spec.command;
    const args = spec.launchCommand?.trim()
      ? [...(spec.launchArgs ?? []), spec.command, ...spec.args]
      : spec.args;
    const env = this.resolveProviderEnvironment(spec);

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r\n|\n|\r/g)) {
        if (!line.trim()) continue;
        this.opts.onStdoutLine?.(line);
        this.emitProviderStdoutLine(line);
        this.appendEvent(this.toProviderEvent(line));
      }
    });

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r\n|\n|\r/g)) {
        if (!line.trim()) continue;
        this.opts.onStderrLine?.(line);
        this.emitProviderStderrLine(line);
      }
    });

    child.once("exit", (_code, _signal) => {
      if (this.providerChild === child) {
        this.providerChild = null;
      }
      this.opts.onStderrLine?.(
        `provider runtime exited (code=${String(_code)}, signal=${String(_signal)})`,
      );
      this.appendEvent({
        type: "environment.degraded",
        threadId: this.resolveThreadId(),
        message: "Provider runtime exited",
      });
    });

    return child;
  }

  private resolveProviderEnvironment(
    spec: EnvironmentAgentProviderSpec,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(spec.env ?? {}),
    };
    if (!spec.files || spec.files.length === 0) {
      return env;
    }

    const homeDir = env.HOME?.trim() || this.resolveManagedProviderHomeDir();
    this.materializeProviderFiles(homeDir, spec.files);
    env.HOME = homeDir;
    return env;
  }

  private materializeProviderFiles(
    homeDir: string,
    files: EnvironmentAgentProviderFile[],
  ): void {
    for (const file of files) {
      const targetPath = this.resolveProviderFilePath(homeDir, file);
      mkdirSync(path.dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, file.content, "utf8");
    }
  }

  private resolveManagedProviderHomeDir(): string {
    return path.join(
      tmpdir(),
      "beanbag-environment-agent",
      this.resolveThreadId(),
      "provider-home",
    );
  }

  private resolveProviderFilePath(
    homeDir: string,
    file: EnvironmentAgentProviderFile,
  ): string {
    switch (file.placement) {
      case "home":
        return path.join(homeDir, file.path);
    }
    const exhausted: never = file.placement;
    throw new Error(`Unsupported provider file placement: ${String(exhausted)}`);
  }

  private hasDaemonDeliveryConfig(): boolean {
    return Boolean(
      this.daemonConnection?.daemonUrl?.trim() &&
        this.daemonConnection?.authToken?.trim() &&
        this.resolveThreadId().trim(),
    );
  }

  private async flushDaemonDelivery(): Promise<void> {
    if (!this.hasDaemonDeliveryConfig()) {
      this.connectedToDaemon = false;
      return;
    }

    const daemonUrl = this.daemonConnection!.daemonUrl!.trim();
    const authToken = this.daemonConnection!.authToken!.trim();
    const threadId = this.resolveThreadId();
    const pendingEvents = this.events.filter((event) => event.sequence > this.lastAckedSequence);
    if (pendingEvents.length === 0) {
      this.markDeliveryHealthy();
      return;
    }

    try {
      const response = await fetch(
        this.resolveDaemonEndpointUrl(
          daemonUrl,
          `threads/${threadId}/environment-agent/deliver`,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
            threadId,
            ...(this.opts.projectId ? { projectId: this.opts.projectId } : {}),
            ...(this.opts.environmentId ? { environmentId: this.opts.environmentId } : {}),
            afterSequence: this.lastAckedSequence,
            events: pendingEvents,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Daemon delivery failed: ${response.status}`);
      }

      const body = (await response.json()) as EnvironmentAgentDeliveryResponse;
      const previousAckedSequence = this.lastAckedSequence;
      this.lastAckedSequence = Math.max(this.lastAckedSequence, body.acknowledgedSequence);
      this.connectedToDaemon = true;
      this.lastDeliveryError = undefined;
      this.nextRetryAt = undefined;

      switch (body.state) {
        case "accepted":
          this.deliveryIssue = body.reason;
          if (this.lastAckedSequence > previousAckedSequence) {
            this.markDeliveryHealthy();
          } else if (this.sequence > this.lastAckedSequence) {
            this.markDeliveryStalled(
              body.reason === "accepted" ? "sequence_gap" : body.reason,
              body.message ?? "Daemon accepted delivery without acknowledgement progress",
            );
            return;
          } else {
            this.markDeliveryHealthy();
          }
          if (this.sequence > this.lastAckedSequence) {
            this.triggerDaemonDelivery();
          }
          return;
        case "retry":
          this.markDeliveryRetrying(
            body.reason,
            body.message ?? "Daemon requested delivery retry",
            body.retryAfterMs,
          );
          return;
        case "stalled":
          this.markDeliveryStalled(
            body.reason,
            body.message ?? "Daemon reported stalled delivery",
          );
          return;
        case "stopped":
          this.markDeliveryStopped(
            body.reason,
            body.message ?? "Daemon reported delivery is no longer eligible",
          );
          return;
      }
    } catch (error) {
      this.connectedToDaemon = false;
      const message = error instanceof Error ? error.message : String(error);
      this.opts.onStderrLine?.(`daemon delivery failed: ${message}`);
      this.markDeliveryRetrying("transport_error", message);
      throw error;
    }
  }

  private markDeliveryHealthy(): void {
    this.connectedToDaemon = true;
    this.deliveryState = "healthy";
    this.deliveryIssue = undefined;
    this.deliveryRetryAttemptCount = 0;
    this.deliveryBackoffMs = INITIAL_DELIVERY_BACKOFF_MS;
    this.nextRetryAt = undefined;
    this.lastDeliveryError = undefined;
  }

  private markDeliveryRetrying(
    reason: EnvironmentAgentDeliveryReason,
    message: string,
    requestedDelayMs?: number,
  ): void {
    this.deliveryState = "retrying";
    this.deliveryIssue = reason;
    this.lastDeliveryError = message;
    if (this.deliveryRetryAttemptCount >= MAX_AUTOMATIC_DELIVERY_RETRIES) {
      this.markDeliveryStalled(
        "transport_error",
        `Automatic delivery retry budget exhausted after ${this.deliveryRetryAttemptCount} attempts`,
      );
      return;
    }
    const delayMs = Math.max(100, Math.round(requestedDelayMs ?? this.nextBackoffDelayMs()));
    this.deliveryRetryAttemptCount += 1;
    this.scheduleDaemonDeliveryRetry(delayMs);
  }

  private markDeliveryStalled(
    reason: EnvironmentAgentDeliveryReason,
    message: string,
  ): void {
    this.deliveryState = "stalled";
    this.deliveryIssue = reason;
    this.lastDeliveryError = message;
    if (this.deliveryRetryTimer) {
      clearTimeout(this.deliveryRetryTimer);
      this.deliveryRetryTimer = undefined;
    }
    this.nextRetryAt = undefined;
  }

  private markDeliveryStopped(
    reason: EnvironmentAgentDeliveryReason,
    message: string,
  ): void {
    this.deliveryState = "stopped";
    this.deliveryIssue = reason;
    this.lastDeliveryError = message;
    if (this.deliveryRetryTimer) {
      clearTimeout(this.deliveryRetryTimer);
      this.deliveryRetryTimer = undefined;
    }
    this.nextRetryAt = undefined;
  }

  private scheduleDaemonDeliveryRetry(delayMs: number): void {
    if (this.deliveryRetryTimer) {
      return;
    }
    this.nextRetryAt = Date.now() + delayMs;
    this.deliveryRetryTimer = setTimeout(() => {
      this.deliveryRetryTimer = undefined;
      this.nextRetryAt = undefined;
      this.triggerDaemonDelivery();
    }, delayMs);
  }

  private nextBackoffDelayMs(): number {
    const baseDelayMs = this.deliveryBackoffMs;
    this.deliveryBackoffMs = Math.min(this.deliveryBackoffMs * 2, MAX_DELIVERY_BACKOFF_MS);
    const jitterFactor = 0.8 + Math.random() * 0.4;
    return Math.min(
      MAX_DELIVERY_BACKOFF_MS,
      Math.max(INITIAL_DELIVERY_BACKOFF_MS, Math.round(baseDelayMs * jitterFactor)),
    );
  }

  private resolveThreadId(): string {
    return this.opts.threadId ?? process.env.BB_THREAD_ID ?? "unknown-thread";
  }

  private resolveDaemonEndpointUrl(daemonUrl: string, relativePath: string): URL {
    const normalizedBase = daemonUrl.endsWith("/") ? daemonUrl : `${daemonUrl}/`;
    return new URL(relativePath, normalizedBase);
  }

  private toProviderEvent(line: string): EnvironmentAgentEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return {
        type: "provider.event",
        threadId: this.resolveThreadId(),
        method: "provider.stdout",
        payload: { line },
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        type: "provider.event",
        threadId: this.resolveThreadId(),
        method: "provider.stdout",
        payload: { line },
      };
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.method !== "string") {
      return {
        type: "provider.event",
        threadId: this.resolveThreadId(),
        method: "provider.stdout",
        payload: { line },
      };
    }

    return {
      type: "provider.event",
      threadId: this.resolveThreadId(),
      method: record.method,
      payload: record.params ?? {},
    };
  }

  private ensureProviderForCommand(command: EnvironmentAgentCommand): void {
    switch (command.type) {
      case "thread.start":
      case "thread.resume":
      case "thread.stop":
      case "turn.start":
      case "turn.steer":
      case "thread.rename":
        if (!this.ensureProviderRunning()) {
          throw new Error("Provider runtime is unavailable");
        }
        return;
      case "workspace.status":
      case "workspace.diff":
        return;
    }
  }

  private toProviderCommandLine(command: EnvironmentAgentCommand): string {
    const message = {
      jsonrpc: "2.0" as const,
      method: this.toProviderMethod(command),
      id: ++this.providerRequestId,
      params: this.toProviderParams(command),
    };
    return JSON.stringify(message);
  }

  private toProviderMethod(command: EnvironmentAgentCommand): string {
    switch (command.type) {
      case "thread.start":
        return "thread/start";
      case "thread.resume":
        return "thread/resume";
      case "thread.stop":
        return "thread/stop";
      case "turn.start":
        return "turn/start";
      case "turn.steer":
        return "turn/steer";
      case "thread.rename":
        return "thread/name-set";
      case "workspace.status":
        return "workspace/status";
      case "workspace.diff":
        return "workspace/diff";
    }
  }

  private toProviderParams(command: EnvironmentAgentCommand): unknown {
    switch (command.type) {
      case "thread.start":
      case "thread.resume":
      case "turn.start":
      case "turn.steer":
      case "thread.rename":
        return command.params;
      case "thread.stop":
        return command.params ?? {};
      case "workspace.status":
      case "workspace.diff":
        return { threadId: command.threadId };
    }
  }
}
