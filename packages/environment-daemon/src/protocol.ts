import type {
  PromptInput,
  SpawnThreadRequest,
  Thread,
} from "@bb/core";
import { assertNever } from "@bb/core";
import type {
  ProviderDynamicTool,
  ProviderExecutionOptions,
  ProviderThreadContext,
} from "@bb/provider-adapters";

export type EnvironmentDaemonTransportKind = "http";
export const ENVIRONMENT_DAEMON_PROTOCOL_VERSION = 1 as const;

export interface EnvironmentDaemonProviderLaunchWrapper {
  command: string;
  args: string[];
}

export interface EnvironmentDaemonProviderSpec {
  command: string;
  args: string[];
  launchCommand?: string;
  launchArgs?: string[];
  env?: Record<string, string>;
  files?: EnvironmentDaemonProviderFile[];
}

export type EnvironmentDaemonProviderFilePlacement = "home";

export interface EnvironmentDaemonProviderFile {
  path: string;
  content: string;
  placement: EnvironmentDaemonProviderFilePlacement;
}

export interface EnvironmentDaemonProviderStatus {
  running: boolean;
  launched: boolean;
  pid?: number;
}

export type EnvironmentDaemonConnectionTarget =
  {
    transport: "http";
    baseUrl: string;
    headers?: Record<string, string>;
    serverConnection?: EnvironmentDaemonServerConnectionConfig;
    providerLaunch?: EnvironmentDaemonProviderLaunchWrapper;
  };

export interface EnvironmentDaemonServerConnectionConfig {
  serverUrl?: string;
  authToken?: string;
  threadId?: string;
  projectId?: string;
  environmentId?: string;
  lastAckedSequence?: number;
}


export interface EnvironmentDaemonCommandMetadata {
  protocolVersion: typeof ENVIRONMENT_DAEMON_PROTOCOL_VERSION;
  commandId: string;
  idempotencyKey: string;
  sentAt: number;
  threadId?: string;
  projectId?: string;
  expectedAfterSequence?: number;
}

export interface EnvironmentDaemonInitializeRequest {
  method: string;
  params: unknown;
}

export type EnvironmentDaemonCommand =
  | {
      type: "provider.ensure";
      forThreadId?: string;
      providerId?: string;
      context?: ProviderThreadContext;
      providerLaunch?: EnvironmentDaemonProviderLaunchWrapper;
      command?: string;
      args?: string[];
      launchCommand?: string;
      launchArgs?: string[];
      env?: Record<string, string>;
      files?: EnvironmentDaemonProviderFile[];
    }
  | {
      type: "thread.start";
      threadId: string;
      projectId: string;
      request?: SpawnThreadRequest;
      context?: ProviderThreadContext;
      dynamicTools?: ProviderDynamicTool[];
      initialize?: EnvironmentDaemonInitializeRequest;
    }
  | {
      type: "thread.resume";
      threadId: string;
      projectId: string;
      providerThreadId?: string;
      context?: ProviderThreadContext;
      options?: ProviderExecutionOptions;
      resumePath?: string;
      dynamicTools?: ProviderDynamicTool[];
      initialize?: EnvironmentDaemonInitializeRequest;
    }
  | {
      type: "thread.stop";
      threadId: string;
      initialize?: EnvironmentDaemonInitializeRequest;
    }
  | {
      type: "turn.run";
      threadId: string;
      providerThreadId?: string;
      requestedMode?: "auto" | "steer" | "start";
      activeTurnId?: string;
      input?: PromptInput[];
      options?: ProviderExecutionOptions;
      initialize?: EnvironmentDaemonInitializeRequest;
    }
  | {
      type: "thread.rename";
      threadId: string;
      providerThreadId?: string;
      title: string;
      initialize?: EnvironmentDaemonInitializeRequest;
    }
  | {
      type: "provider.list_models";
      providerId?: string;
    }
  | {
      type: "provider.list_catalog";
    }
  | {
      type: "workspace.status";
      threadId: string;
    }
  | {
      type: "workspace.diff";
      threadId: string;
    };

export interface EnvironmentDaemonCommandEnvelope<
  TCommand extends EnvironmentDaemonCommand = EnvironmentDaemonCommand,
> {
  meta: EnvironmentDaemonCommandMetadata;
  command: TCommand;
}

export type EnvironmentDaemonCommandDeliveryState =
  | "accepted"
  | "duplicate"
  | "rejected";

export interface EnvironmentDaemonCommandAck {
  protocolVersion: typeof ENVIRONMENT_DAEMON_PROTOCOL_VERSION;
  commandId: string;
  idempotencyKey: string;
  state: EnvironmentDaemonCommandDeliveryState;
  acknowledgedAt: number;
  latestSequence: number;
  errorCode?: string;
  message?: string;
  result?: unknown;
}

export type EnvironmentDaemonEvent =
  | {
      type: "environment.ready";
      threadId: string;
    }
  | {
      type: "environment.degraded";
      threadId: string;
      message: string;
    }
  | {
      type: "thread.started";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread.stopped";
      threadId: string;
    }
  | {
      type: "turn.started";
      threadId: string;
      turnId?: string;
    }
  | {
      type: "turn.completed";
      threadId: string;
      turnId?: string;
    }
  | {
      type: "provider.event";
      threadId: string;
      method: string;
      payload: unknown;
      providerId?: string;
      normalizedMethod?: string;
      shouldPersist?: boolean;
      shouldBroadcast?: boolean;
      nextStatus?: Thread["status"];
      title?: string;
      turnState?: "active" | "idle";
      turnId?: string;
    }
  | {
      type: "provider.stderr";
      threadId: string;
      line: string;
    }
  | {
      type: "provider.rpc_error";
      threadId: string;
      requestId: string | number;
      message: string;
    }
  | {
      type: "workspace.status.changed";
      threadId: string;
    };

export interface EnvironmentDaemonEventEnvelope<
  TEvent extends EnvironmentDaemonEvent = EnvironmentDaemonEvent,
> {
  protocolVersion: typeof ENVIRONMENT_DAEMON_PROTOCOL_VERSION;
  sequence: number;
  emittedAt: number;
  threadId: string;
  event: TEvent;
}

export type EnvironmentDaemonDeliveryReason =
  | "accepted"
  | "duplicate"
  | "sequence_gap"
  | "transport_error"
  | "thread_archived"
  | "thread_inactive";

export type EnvironmentDaemonDeliveryRuntimeState =
  | "healthy"
  | "retrying"
  | "stalled"
  | "stopped";

export interface EnvironmentDaemonStatusSnapshot {
  protocolVersion: typeof ENVIRONMENT_DAEMON_PROTOCOL_VERSION;
  threadId?: string;
  projectId?: string;
  environmentId?: string;
  latestSequence: number;
  lastAckedSequence?: number;
  connectedToServer: boolean;
  pendingEventCount: number;
  pendingCommandCount: number;
  deliveryState: EnvironmentDaemonDeliveryRuntimeState;
  deliveryIssue?: EnvironmentDaemonDeliveryReason;
  retryAttemptCount: number;
  nextRetryAt?: number;
  lastDeliveryError?: string;
}

interface EnvironmentDaemonControlMessageBase {
  environmentDaemonMessage: true;
  requestId: string;
}

export type EnvironmentDaemonControlRequest =
  | (EnvironmentDaemonControlMessageBase & {
      type: "command";
      payload: EnvironmentDaemonCommandEnvelope;
    })
  | (EnvironmentDaemonControlMessageBase & {
      type: "provider.ensure";
      payload: EnvironmentDaemonProviderSpec;
    })
  | (EnvironmentDaemonControlMessageBase & {
      type: "status";
    });

export type EnvironmentDaemonControlResponse =
  | (EnvironmentDaemonControlMessageBase & {
      type: "command.response";
      payload: EnvironmentDaemonCommandAck;
    })
  | (EnvironmentDaemonControlMessageBase & {
      type: "provider.ensure.response";
      payload: EnvironmentDaemonProviderStatus;
    })
  | (EnvironmentDaemonControlMessageBase & {
      type: "status.response";
      payload: EnvironmentDaemonStatusSnapshot;
    });

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isEnvironmentDaemonControlRequest(
  value: unknown,
): value is EnvironmentDaemonControlRequest {
  const record = asRecord(value);
  if (!record) return false;
  if (record.environmentDaemonMessage !== true) return false;
  if (typeof record.requestId !== "string" || record.requestId.length === 0) return false;
  const type = record.type;
  return (
    type === "command" ||
    type === "provider.ensure" ||
    type === "status"
  );
}

export function isEnvironmentDaemonControlResponse(
  value: unknown,
): value is EnvironmentDaemonControlResponse {
  const record = asRecord(value);
  if (!record) return false;
  if (record.environmentDaemonMessage !== true) return false;
  if (typeof record.requestId !== "string" || record.requestId.length === 0) return false;
  const type = record.type;
  return (
    type === "command.response" ||
    type === "provider.ensure.response" ||
    type === "status.response"
  );
}

const ENVIRONMENT_DAEMON_COMMAND_TYPES = [
  "provider.ensure",
  "thread.start",
  "thread.resume",
  "thread.stop",
  "turn.run",
  "thread.rename",
  "provider.list_models",
  "provider.list_catalog",
  "workspace.status",
  "workspace.diff",
] as const satisfies readonly EnvironmentDaemonCommand["type"][];

function decodeEnvironmentDaemonCommandType(
  value: string,
): EnvironmentDaemonCommand["type"] | null {
  return ENVIRONMENT_DAEMON_COMMAND_TYPES.find((candidate) => candidate === value) ?? null;
}

function getStringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decodeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result = value.filter((entry): entry is string => typeof entry === "string");
  return result.length === value.length ? result : null;
}

function decodeStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record);
  if (entries.some(([, entry]) => typeof entry !== "string")) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function decodeProviderFile(value: unknown): EnvironmentDaemonProviderFile | null {
  const record = asRecord(value);
  const path = getStringField(record, "path");
  const content = getStringField(record, "content");
  const placement = getStringField(record, "placement");
  if (!path || !content || placement !== "home") {
    return null;
  }
  return { path, content, placement };
}

function decodeProviderFiles(value: unknown): EnvironmentDaemonProviderFile[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = value
    .map((entry) => decodeProviderFile(entry))
    .filter((entry): entry is EnvironmentDaemonProviderFile => entry !== null);
  return files.length === value.length ? files : undefined;
}

function decodeInitializeRequest(
  value: unknown,
): EnvironmentDaemonInitializeRequest | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  const method = getStringField(record, "method");
  if (!record || !method || !("params" in record)) {
    return undefined;
  }
  return { method, params: record.params };
}

function decodeCommandRecord(
  payload: unknown,
  commandType: string,
): Record<string, unknown> {
  const record = asRecord(payload);
  if (!record) {
    throw new Error(`Invalid persisted environment-daemon command payload for ${commandType}`);
  }
  if ("type" in record && record.type !== commandType) {
    throw new Error(`Environment-daemon command payload type mismatch for ${commandType}`);
  }
  return record;
}

function requireStringField(
  record: Record<string, unknown>,
  key: string,
  commandType: string,
): string {
  const value = getStringField(record, key);
  if (!value) {
    throw new Error(`Invalid persisted environment-daemon command payload for ${commandType}`);
  }
  return value;
}

function decodeThreadContext(value: unknown): ProviderThreadContext | undefined {
  return asRecord(value) as unknown as ProviderThreadContext | undefined;
}

function decodeSpawnThreadRequest(value: unknown): SpawnThreadRequest | undefined {
  return asRecord(value) as unknown as SpawnThreadRequest | undefined;
}

function decodeDynamicTools(value: unknown): ProviderDynamicTool[] | undefined {
  return Array.isArray(value) ? (value as ProviderDynamicTool[]) : undefined;
}

function decodeExecutionOptions(value: unknown): ProviderExecutionOptions | undefined {
  return asRecord(value) as ProviderExecutionOptions | undefined;
}

function decodePromptInputArray(value: unknown): PromptInput[] | undefined {
  return Array.isArray(value) ? (value as PromptInput[]) : undefined;
}

function decodeProviderId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function decodePersistedEnvironmentDaemonCommand(args: {
  commandType: string;
  payload: unknown;
}): EnvironmentDaemonCommand {
  const commandType = decodeEnvironmentDaemonCommandType(args.commandType);
  if (!commandType) {
    throw new Error(`Unsupported environment-daemon command type ${args.commandType}`);
  }

  const record = decodeCommandRecord(args.payload, commandType);
  const initialize = decodeInitializeRequest(record.initialize);

  switch (commandType) {
    case "provider.ensure": {
      const command = getStringField(record, "command");
      const providerArgs =
        record.args === undefined ? undefined : decodeStringArray(record.args);
      const launchArgs =
        record.launchArgs === undefined ? undefined : decodeStringArray(record.launchArgs);
      const env = decodeStringRecord(record.env);
      const files = decodeProviderFiles(record.files);
      const launchCommand = getStringField(record, "launchCommand");
      const forThreadId = getStringField(record, "forThreadId");
      if (
        (record.args !== undefined && !providerArgs) ||
        (record.launchArgs !== undefined && !launchArgs) ||
        (record.env !== undefined && !env) ||
        (record.files !== undefined && !files) ||
        (!command && !decodeProviderId(record.providerId))
      ) {
        throw new Error(`Invalid persisted environment-daemon command payload for ${commandType}`);
      }
      return {
        type: commandType,
        ...(command ? { command } : {}),
        ...(providerArgs ? { args: providerArgs } : {}),
        ...(launchCommand ? { launchCommand } : {}),
        ...(launchArgs ? { launchArgs } : {}),
        ...(env ? { env } : {}),
        ...(files ? { files } : {}),
        ...(forThreadId ? { forThreadId } : {}),
        ...(decodeProviderId(record.providerId)
          ? { providerId: decodeProviderId(record.providerId)! }
          : {}),
        ...(decodeThreadContext(record.context)
          ? { context: decodeThreadContext(record.context)! }
          : {}),
        ...(asRecord(record.providerLaunch)
          ? {
              providerLaunch: {
                command: requireStringField(asRecord(record.providerLaunch)!, "command", commandType),
                args: decodeStringArray(asRecord(record.providerLaunch)!.args) ?? [],
              },
            }
          : {}),
      };
    }
    case "thread.start":
      return {
        type: commandType,
        threadId: requireStringField(record, "threadId", commandType),
        projectId: requireStringField(record, "projectId", commandType),
        ...(decodeSpawnThreadRequest(record.request)
          ? { request: decodeSpawnThreadRequest(record.request)! }
          : {}),
        ...(decodeThreadContext(record.context)
          ? { context: decodeThreadContext(record.context)! }
          : {}),
        ...(decodeDynamicTools(record.dynamicTools)
          ? { dynamicTools: decodeDynamicTools(record.dynamicTools)! }
          : {}),
        ...(initialize ? { initialize } : {}),
      };
    case "thread.resume":
      return {
        type: commandType,
        threadId: requireStringField(record, "threadId", commandType),
        projectId: requireStringField(record, "projectId", commandType),
        ...(getStringField(record, "providerThreadId")
          ? { providerThreadId: getStringField(record, "providerThreadId")! }
          : {}),
        ...(decodeThreadContext(record.context)
          ? { context: decodeThreadContext(record.context)! }
          : {}),
        ...(decodeExecutionOptions(record.options)
          ? { options: decodeExecutionOptions(record.options)! }
          : {}),
        ...(decodeDynamicTools(record.dynamicTools)
          ? { dynamicTools: decodeDynamicTools(record.dynamicTools)! }
          : {}),
        ...(getStringField(record, "resumePath")
          ? { resumePath: getStringField(record, "resumePath")! }
          : {}),
        ...(initialize ? { initialize } : {}),
      };
    case "thread.stop":
      return {
        type: commandType,
        threadId: requireStringField(record, "threadId", commandType),
        ...(initialize ? { initialize } : {}),
      };
    case "turn.run": {
      const requestedMode = getStringField(record, "requestedMode");
      const activeTurnId = getStringField(record, "activeTurnId");
      if (
        (requestedMode !== undefined &&
          requestedMode !== "auto" &&
          requestedMode !== "steer" &&
          requestedMode !== "start") ||
        !Array.isArray(record.input)
      ) {
        throw new Error(`Invalid persisted environment-daemon command payload for ${commandType}`);
      }
      return {
        type: commandType,
        threadId: requireStringField(record, "threadId", commandType),
        ...(getStringField(record, "providerThreadId")
          ? { providerThreadId: getStringField(record, "providerThreadId")! }
          : {}),
        ...(requestedMode ? { requestedMode } : {}),
        ...(activeTurnId ? { activeTurnId } : {}),
        input: decodePromptInputArray(record.input)!,
        ...(decodeExecutionOptions(record.options)
          ? { options: decodeExecutionOptions(record.options)! }
          : {}),
        ...(initialize ? { initialize } : {}),
      };
    }
    case "thread.rename":
      return {
        type: commandType,
        threadId: requireStringField(record, "threadId", commandType),
        ...(getStringField(record, "providerThreadId")
          ? { providerThreadId: getStringField(record, "providerThreadId")! }
          : {}),
        title: requireStringField(record, "title", commandType),
        ...(initialize ? { initialize } : {}),
      };
    case "provider.list_models":
      return {
        type: commandType,
        ...(decodeProviderId(record.providerId)
          ? { providerId: decodeProviderId(record.providerId)! }
          : {}),
      };
    case "provider.list_catalog":
      return { type: commandType };
    case "workspace.status":
    case "workspace.diff":
      return {
        type: commandType,
        threadId: requireStringField(record, "threadId", commandType),
      };
    default:
      return assertNever(commandType);
  }
}
