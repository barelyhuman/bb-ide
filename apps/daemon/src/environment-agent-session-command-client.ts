import type {
  EnvironmentAgentClient,
  EnvironmentAgentCommandAck,
  EnvironmentAgentCommandEnvelope,
  EnvironmentAgentProviderSpec,
  EnvironmentAgentProviderStatus,
  EnvironmentAgentStatusSnapshot,
} from "@beanbag/environment-agent";
import { ENVIRONMENT_AGENT_PROTOCOL_VERSION } from "@beanbag/environment-agent";
import type { JsonLineTransport } from "@beanbag/environment-agent";
import { EnvironmentAgentCommandDispatcher } from "./environment-agent-command-dispatcher.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EnvironmentAgentSessionCommandClientOptions {
  threadId: string;
  commandDispatcher: EnvironmentAgentCommandDispatcher;
  commandTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class EnvironmentAgentSessionCommandClient implements EnvironmentAgentClient {
  readonly providerTransport: JsonLineTransport = {
    setHandlers: () => undefined,
    send: () => {
      throw new Error("Session-backed environment-agent client does not expose provider transport");
    },
    close: () => undefined,
  };

  private readonly commandTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private closed = false;

  constructor(private readonly options: EnvironmentAgentSessionCommandClientOptions) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async sendCommand(
    envelope: EnvironmentAgentCommandEnvelope,
  ): Promise<EnvironmentAgentCommandAck> {
    this.ensureOpen();
    const command = await this.options.commandDispatcher.enqueueForActiveSession({
      threadId: this.options.threadId,
      commandId: envelope.meta.commandId,
      commandType: envelope.command.type,
      payload: envelope.command,
      timeoutMs: this.commandTimeoutMs,
      pollIntervalMs: this.pollIntervalMs,
      sentAt: envelope.meta.sentAt,
    });

    switch (command.state) {
      case "completed":
        return {
          protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
          commandId: envelope.meta.commandId,
          idempotencyKey: envelope.meta.idempotencyKey,
          state: "accepted",
          acknowledgedAt: command.updatedAt,
          latestSequence: 0,
          ...(command.result !== undefined ? { result: command.result } : {}),
        };
      case "failed":
      case "cancelled":
        return {
          protocolVersion: ENVIRONMENT_AGENT_PROTOCOL_VERSION,
          commandId: envelope.meta.commandId,
          idempotencyKey: envelope.meta.idempotencyKey,
          state: "rejected",
          acknowledgedAt: command.updatedAt,
          latestSequence: 0,
          ...(command.errorCode !== undefined ? { errorCode: command.errorCode } : {}),
          message:
            command.errorMessage ??
            (command.state === "cancelled"
              ? "Environment-agent command was cancelled"
              : "Environment-agent command failed"),
        };
      default:
        throw new Error(
          `Environment-agent command ${envelope.meta.commandId} did not reach terminal state`,
        );
    }
  }

  async ensureProviderRunning(
    _spec: EnvironmentAgentProviderSpec,
  ): Promise<EnvironmentAgentProviderStatus> {
    this.ensureOpen();
    await this.options.commandDispatcher.awaitActiveSession({
      threadId: this.options.threadId,
      timeoutMs: this.commandTimeoutMs,
      pollIntervalMs: this.pollIntervalMs,
    });
    return {
      running: true,
      launched: true,
    };
  }

  status(): Promise<EnvironmentAgentStatusSnapshot> {
    throw new Error("Session-backed environment-agent client does not support status");
  }

  close(): void {
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("Environment-agent session command client is closed");
    }
  }
}
