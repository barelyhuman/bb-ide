import {
  toolCallRequestSchema,
  toolCallResponseSchema,
  type ToolCallRequest,
  type ToolCallResponse,
} from "@bb/domain";
import { z } from "zod";
import {
  ENVIRONMENT_DAEMON_COMMAND_TYPES,
  environmentDaemonCommandResultSchemaByType,
  environmentDaemonCommandSchema,
  environmentDaemonCommandTypeSchema,
  environmentDaemonEventSchema,
  type EnvironmentDaemonCommand,
  type EnvironmentDaemonCommandType,
  type EnvironmentDaemonEvent,
} from "./environment-daemon-commands.js";

export const ENVIRONMENT_DAEMON_SESSION_PROTOCOL =
  "bb.env-daemon.v1" as const;
export const ENVIRONMENT_DAEMON_SESSION_PROTOCOL_VERSION = 1 as const;
export const ENVIRONMENT_DAEMON_SESSION_SUPPORTED_PROTOCOL_VERSIONS = [
  ENVIRONMENT_DAEMON_SESSION_PROTOCOL_VERSION,
] as const;
export type EnvironmentDaemonSessionProtocolVersion =
  (typeof ENVIRONMENT_DAEMON_SESSION_SUPPORTED_PROTOCOL_VERSIONS)[number];

export const ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS =
  ENVIRONMENT_DAEMON_COMMAND_TYPES;
export type EnvironmentDaemonSessionCapabilityCommand =
  EnvironmentDaemonCommandType;

export const ENVIRONMENT_DAEMON_SESSION_CAPABILITY_FEATURES = [
  "worker_metadata",
  "provider_metadata",
  "provider_runtime_version",
  "control_endpoint",
] as const;
export type EnvironmentDaemonSessionCapabilityFeature =
  (typeof ENVIRONMENT_DAEMON_SESSION_CAPABILITY_FEATURES)[number];

export type EnvironmentDaemonSessionCloseReason =
  | "daemon_shutdown"
  | "server_shutdown"
  | "lease_expired"
  | "newer_session"
  | "migration"
  | "internal_error";

export interface EnvironmentDaemonSessionCursorExclusive {
  generation: number;
  sequenceExclusive: number;
}

export interface EnvironmentDaemonSessionControlEndpoint {
  baseUrl: string;
  authToken: string;
}

export interface EnvironmentDaemonSessionWorkerMetadata {
  name: string;
  version: string;
  buildId?: string;
}

export interface EnvironmentDaemonSessionProviderMetadata {
  providerId: string;
  adapterVersion: string;
  runtimeVersion?: string;
}

export const environmentDaemonSessionCursorSchema = z.object({
  generation: z.number().int().min(0),
  sequence: z.number().int().min(0),
});
export type EnvironmentDaemonSessionCursor = z.infer<
  typeof environmentDaemonSessionCursorSchema
>;

export const environmentDaemonSessionChannelBootstrapSchema = z.object({
  channelId: z.string().min(1),
  generation: z.number().int().min(0),
  lastServerAcked: environmentDaemonSessionCursorSchema.optional(),
});
export type EnvironmentDaemonSessionChannelBootstrap = z.infer<
  typeof environmentDaemonSessionChannelBootstrapSchema
>;

export const environmentDaemonSessionCapabilitiesSchema = z.object({
  commands: z
    .array(z.enum(ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS))
    .min(1),
  features: z.array(z.enum(ENVIRONMENT_DAEMON_SESSION_CAPABILITY_FEATURES)),
});
export type EnvironmentDaemonSessionCapabilities = z.infer<
  typeof environmentDaemonSessionCapabilitiesSchema
>;

export const environmentDaemonSessionOpenPayloadSchema = z.object({
  environmentDaemonId: z.string().min(1),
  environmentDaemonInstanceId: z.string().min(1),
  supportedProtocolVersions: z.array(z.number().int()).min(1),
  capabilities: environmentDaemonSessionCapabilitiesSchema.optional(),
  worker: z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
      buildId: z.string().min(1).optional(),
    })
    .optional(),
  providers: z
    .array(
      z.object({
        providerId: z.string().min(1),
        adapterVersion: z.string().min(1),
        runtimeVersion: z.string().min(1).optional(),
      }),
    )
    .optional(),
  controlEndpoint: z
    .object({
      baseUrl: z.string().url(),
      authToken: z.string().min(1),
    })
    .optional(),
  channels: z.array(environmentDaemonSessionChannelBootstrapSchema),
});
export type EnvironmentDaemonSessionOpenPayload = z.infer<
  typeof environmentDaemonSessionOpenPayloadSchema
>;

export interface EnvironmentDaemonSessionWelcomeChannel {
  channelId: string;
  applyFrom: EnvironmentDaemonSessionCursorExclusive;
}

const environmentDaemonSessionCursorExclusiveSchema = z.object({
  generation: z.number().int().min(0),
  sequenceExclusive: z.number().int().min(0),
});

export const environmentDaemonSessionWelcomePayloadSchema = z.object({
  leaseTtlMs: z.number().int().positive(),
  heartbeatIntervalMs: z.number().int().positive(),
  protocolVersion: z.literal(ENVIRONMENT_DAEMON_SESSION_PROTOCOL_VERSION),
  selectedCapabilities: environmentDaemonSessionCapabilitiesSchema.optional(),
  channels: z.array(
    z.object({
      channelId: z.string().min(1),
      applyFrom: environmentDaemonSessionCursorExclusiveSchema,
    }),
  ),
});
export type EnvironmentDaemonSessionWelcomePayload = z.infer<
  typeof environmentDaemonSessionWelcomePayloadSchema
>;

export function selectEnvironmentDaemonSessionProtocolVersion(args: {
  supportedByServer: readonly EnvironmentDaemonSessionProtocolVersion[];
  supportedByDaemon: readonly number[];
}): EnvironmentDaemonSessionProtocolVersion | undefined {
  const daemonSupportedVersions = new Set(args.supportedByDaemon);
  for (const version of [...args.supportedByServer].sort((a, b) => b - a)) {
    if (daemonSupportedVersions.has(version)) {
      return version;
    }
  }
  return undefined;
}

function uniqueInOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isKnownCommand(
  value: string,
): value is EnvironmentDaemonSessionCapabilityCommand {
  return ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS.includes(
    value as EnvironmentDaemonSessionCapabilityCommand,
  );
}

function isKnownFeature(
  value: string,
): value is EnvironmentDaemonSessionCapabilityFeature {
  return ENVIRONMENT_DAEMON_SESSION_CAPABILITY_FEATURES.includes(
    value as EnvironmentDaemonSessionCapabilityFeature,
  );
}

export function inferEnvironmentDaemonSessionCapabilities(args: {
  worker?: EnvironmentDaemonSessionWorkerMetadata;
  providers?: EnvironmentDaemonSessionProviderMetadata[];
  controlEndpoint?: EnvironmentDaemonSessionControlEndpoint;
}): EnvironmentDaemonSessionCapabilities {
  const features: EnvironmentDaemonSessionCapabilityFeature[] = [];
  if (args.worker) {
    features.push("worker_metadata");
  }
  if (args.providers && args.providers.length > 0) {
    features.push("provider_metadata");
    if (args.providers.some((provider) => provider.runtimeVersion?.trim())) {
      features.push("provider_runtime_version");
    }
  }
  if (args.controlEndpoint) {
    features.push("control_endpoint");
  }
  return {
    commands: [...ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS],
    features,
  };
}

export function createEnvironmentDaemonSessionCapabilities(args: {
  worker?: EnvironmentDaemonSessionWorkerMetadata;
  providers?: EnvironmentDaemonSessionProviderMetadata[];
  controlEndpoint?: EnvironmentDaemonSessionControlEndpoint;
}): EnvironmentDaemonSessionCapabilities {
  const inferred = inferEnvironmentDaemonSessionCapabilities(args);
  return {
    commands: [...ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS],
    features: inferred.features,
  };
}

export function normalizeEnvironmentDaemonSessionCapabilities(
  capabilities: Partial<EnvironmentDaemonSessionCapabilities> | undefined,
): EnvironmentDaemonSessionCapabilities {
  return {
    commands: uniqueInOrder(
      (capabilities?.commands ?? []).filter(
        (value): value is EnvironmentDaemonSessionCapabilityCommand =>
          typeof value === "string" && isKnownCommand(value),
      ),
    ),
    features: uniqueInOrder(
      (capabilities?.features ?? []).filter(
        (value): value is EnvironmentDaemonSessionCapabilityFeature =>
          typeof value === "string" && isKnownFeature(value),
      ),
    ),
  };
}

export function negotiateEnvironmentDaemonSessionCapabilities(args: {
  requested?: Partial<EnvironmentDaemonSessionCapabilities>;
  fallback: {
    worker?: EnvironmentDaemonSessionWorkerMetadata;
    providers?: EnvironmentDaemonSessionProviderMetadata[];
    controlEndpoint?: EnvironmentDaemonSessionControlEndpoint;
  };
}): EnvironmentDaemonSessionCapabilities {
  const advertised = args.requested
    ? normalizeEnvironmentDaemonSessionCapabilities(args.requested)
    : inferEnvironmentDaemonSessionCapabilities(args.fallback);
  return {
    commands: advertised.commands.filter((command) =>
      ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS.includes(command),
    ),
    features: advertised.features.filter((feature) =>
      ENVIRONMENT_DAEMON_SESSION_CAPABILITY_FEATURES.includes(feature),
    ),
  };
}

export interface EnvironmentDaemonSessionHeartbeatChannel {
  channelId: string;
  lastSent?: EnvironmentDaemonSessionCursor;
  lastAcked?: EnvironmentDaemonSessionCursor;
}

export const environmentDaemonSessionHeartbeatPayloadSchema = z.object({
  environmentDaemonObservedAt: z.number().int().nonnegative(),
  outboxDepth: z.number().int().nonnegative(),
  channels: z.array(
    z.object({
      channelId: z.string().min(1),
      lastSent: environmentDaemonSessionCursorSchema.optional(),
      lastAcked: environmentDaemonSessionCursorSchema.optional(),
    }),
  ),
});
export type EnvironmentDaemonSessionHeartbeatPayload = z.infer<
  typeof environmentDaemonSessionHeartbeatPayloadSchema
>;

export interface EnvironmentDaemonSessionEventBatchItem<
  TEvent = EnvironmentDaemonEvent,
> {
  sequence: number;
  eventId: string;
  emittedAt: number;
  event: TEvent;
}

export interface EnvironmentDaemonSessionEventBatchChannel<
  TEvent = EnvironmentDaemonEvent,
> {
  channelId: string;
  generation: number;
  events: EnvironmentDaemonSessionEventBatchItem<TEvent>[];
}

export interface EnvironmentDaemonSessionEventBatchPayload<
  TEvent = EnvironmentDaemonEvent,
> {
  batches: EnvironmentDaemonSessionEventBatchChannel<TEvent>[];
}

export const environmentDaemonSessionEventBatchPayloadSchema = z.object({
  batches: z
    .array(
      z.object({
        channelId: z.string().min(1),
        generation: z.number().int().min(0),
        events: z
          .array(
            z.object({
              sequence: z.number().int().min(0),
              eventId: z.string().min(1),
              emittedAt: z.number().int().nonnegative(),
              event: environmentDaemonEventSchema,
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export interface EnvironmentDaemonSessionEventAckChannel {
  channelId: string;
  ackedThrough: EnvironmentDaemonSessionCursor;
}

export const environmentDaemonSessionEventAckPayloadSchema = z.object({
  channels: z
    .array(
      z.object({
        channelId: z.string().min(1),
        ackedThrough: environmentDaemonSessionCursorSchema,
      }),
    )
    .min(1),
});
export type EnvironmentDaemonSessionEventAckPayload = z.infer<
  typeof environmentDaemonSessionEventAckPayloadSchema
>;

export interface EnvironmentDaemonSessionCommandBatchItem<
  TCommand = EnvironmentDaemonCommand,
> {
  channelId: string;
  commandCursor: number;
  commandId: string;
  createdAt: number;
  command: TCommand;
}

export interface EnvironmentDaemonSessionCommandBatchPayload<
  TCommand = EnvironmentDaemonCommand,
> {
  commands: EnvironmentDaemonSessionCommandBatchItem<TCommand>[];
}

export const environmentDaemonSessionCommandBatchPayloadSchema = z.object({
  commands: z
    .array(
      z.object({
        channelId: z.string().min(1),
        commandCursor: z.number().int().min(0),
        commandId: z.string().min(1),
        createdAt: z.number().int().nonnegative(),
        command: environmentDaemonCommandSchema,
      }),
    )
    .min(1),
});

export type EnvironmentDaemonSessionCommandAckState =
  | "received"
  | "duplicate";

export interface EnvironmentDaemonSessionCommandAckItem {
  commandId: string;
  channelId: string;
  state: EnvironmentDaemonSessionCommandAckState;
}

export const environmentDaemonSessionCommandAckPayloadSchema = z.object({
  commands: z
    .array(
      z.object({
        commandId: z.string().min(1),
        channelId: z.string().min(1),
        state: z.enum(["received", "duplicate"]),
      }),
    )
    .min(1),
});
export type EnvironmentDaemonSessionCommandAckPayload = z.infer<
  typeof environmentDaemonSessionCommandAckPayloadSchema
>;

export type EnvironmentDaemonSessionCommandResultState =
  | "started"
  | "completed"
  | "failed";

const commandResultPayloadBaseSchema = z.object({
  commandId: z.string().min(1),
  channelId: z.string().min(1),
  commandType: environmentDaemonCommandTypeSchema,
});

const commandResultStartedPayloadSchema = commandResultPayloadBaseSchema.extend({
  state: z.literal("started"),
});

const commandResultFailedPayloadSchema = commandResultPayloadBaseSchema.extend({
  state: z.literal("failed"),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

const commandResultCompletedThreadStartPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("thread.start"),
    result: environmentDaemonCommandResultSchemaByType["thread.start"],
  });

const commandResultCompletedThreadResumePayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("thread.resume"),
    result: environmentDaemonCommandResultSchemaByType["thread.resume"],
  });

const commandResultCompletedTurnRunPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("turn.run"),
    result: environmentDaemonCommandResultSchemaByType["turn.run"],
  });

const commandResultCompletedTurnSteerPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("turn.steer"),
    result: environmentDaemonCommandResultSchemaByType["turn.steer"],
  });

const commandResultCompletedThreadStopPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("thread.stop"),
    result: environmentDaemonCommandResultSchemaByType["thread.stop"],
  });

const commandResultCompletedThreadRenamePayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("thread.rename"),
    result: environmentDaemonCommandResultSchemaByType["thread.rename"],
  });

const commandResultCompletedProviderListModelsPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("provider.list_models"),
    result: environmentDaemonCommandResultSchemaByType["provider.list_models"],
  });

const commandResultCompletedWorkspaceStatusPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("workspace.status"),
    result: environmentDaemonCommandResultSchemaByType["workspace.status"],
  });

const commandResultCompletedWorkspaceDiffPayloadSchema =
  commandResultPayloadBaseSchema.extend({
    state: z.literal("completed"),
    commandType: z.literal("workspace.diff"),
    result: environmentDaemonCommandResultSchemaByType["workspace.diff"],
  });

export const environmentDaemonSessionCommandResultPayloadSchema = z.union([
  commandResultStartedPayloadSchema,
  commandResultFailedPayloadSchema,
  commandResultCompletedThreadStartPayloadSchema,
  commandResultCompletedThreadResumePayloadSchema,
  commandResultCompletedTurnRunPayloadSchema,
  commandResultCompletedTurnSteerPayloadSchema,
  commandResultCompletedThreadStopPayloadSchema,
  commandResultCompletedThreadRenamePayloadSchema,
  commandResultCompletedProviderListModelsPayloadSchema,
  commandResultCompletedWorkspaceStatusPayloadSchema,
  commandResultCompletedWorkspaceDiffPayloadSchema,
]);
export type EnvironmentDaemonSessionCommandResultPayload = z.infer<
  typeof environmentDaemonSessionCommandResultPayloadSchema
>;

export interface EnvironmentDaemonSessionToolCallRequestPayload {
  channelId: string;
  request: ToolCallRequest;
}

export const environmentDaemonSessionToolCallRequestPayloadSchema = z.object({
  channelId: z.string().min(1),
  request: toolCallRequestSchema,
});

export interface EnvironmentDaemonSessionToolCallResponsePayload {
  channelId: string;
  requestId: ToolCallRequest["requestId"];
  ok: boolean;
  response?: ToolCallResponse;
  errorCode?: string;
  errorMessage?: string;
}

export const environmentDaemonSessionToolCallResponsePayloadSchema = z
  .object({
    channelId: z.string().min(1),
    requestId: z.union([z.string().min(1), z.number()]),
    ok: z.boolean(),
    response: toolCallResponseSchema.optional(),
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.ok) {
      if (!payload.response) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Successful tool call responses must include response",
          path: ["response"],
        });
      }
      return;
    }
    if (!payload.errorCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed tool call responses must include errorCode",
        path: ["errorCode"],
      });
    }
    if (!payload.errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed tool call responses must include errorMessage",
        path: ["errorMessage"],
      });
    }
  });

const environmentDaemonSessionClientCloseReasonSchema = z.enum([
  "daemon_shutdown",
  "server_shutdown",
  "migration",
  "internal_error",
]);

export const environmentDaemonSessionClosePayloadSchema = z.object({
  reason: z.enum([
    "daemon_shutdown",
    "server_shutdown",
    "lease_expired",
    "newer_session",
    "migration",
    "internal_error",
  ]),
});
export type EnvironmentDaemonSessionClosePayload = z.infer<
  typeof environmentDaemonSessionClosePayloadSchema
>;

export const environmentDaemonSessionReplacedPayloadSchema = z.object({
  reason: z.literal("newer_session"),
});
export type EnvironmentDaemonSessionReplacedPayload = z.infer<
  typeof environmentDaemonSessionReplacedPayloadSchema
>;

interface EnvironmentDaemonSessionMessageBase {
  protocol: typeof ENVIRONMENT_DAEMON_SESSION_PROTOCOL;
  messageId: string;
  sentAt: number;
}

interface EnvironmentDaemonSessionBoundMessageBase
  extends EnvironmentDaemonSessionMessageBase {
  sessionId: string;
}

export interface EnvironmentDaemonSessionOpenMessage
  extends EnvironmentDaemonSessionMessageBase {
  type: "session_open";
  payload: EnvironmentDaemonSessionOpenPayload;
}

export interface EnvironmentDaemonSessionWelcomeMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "session_welcome";
  payload: EnvironmentDaemonSessionWelcomePayload;
}

export interface EnvironmentDaemonSessionHeartbeatMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "heartbeat";
  payload: EnvironmentDaemonSessionHeartbeatPayload;
}

export interface EnvironmentDaemonSessionEventBatchMessage<
  TEvent = EnvironmentDaemonEvent,
> extends EnvironmentDaemonSessionBoundMessageBase {
  type: "event_batch";
  payload: EnvironmentDaemonSessionEventBatchPayload<TEvent>;
}

export interface EnvironmentDaemonSessionEventAckMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "event_ack";
  payload: EnvironmentDaemonSessionEventAckPayload;
}

export interface EnvironmentDaemonSessionCommandBatchMessage<
  TCommand = EnvironmentDaemonCommand,
> extends EnvironmentDaemonSessionBoundMessageBase {
  type: "command_batch";
  payload: EnvironmentDaemonSessionCommandBatchPayload<TCommand>;
}

export interface EnvironmentDaemonSessionCommandAckMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "command_ack";
  payload: EnvironmentDaemonSessionCommandAckPayload;
}

export interface EnvironmentDaemonSessionCommandResultMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "command_result";
  payload: EnvironmentDaemonSessionCommandResultPayload;
}

export interface EnvironmentDaemonSessionToolCallRequestMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "tool_call_request";
  payload: EnvironmentDaemonSessionToolCallRequestPayload;
}

export interface EnvironmentDaemonSessionToolCallResponseMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "tool_call_response";
  payload: EnvironmentDaemonSessionToolCallResponsePayload;
}

export interface EnvironmentDaemonSessionCloseMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "session_close";
  payload: EnvironmentDaemonSessionClosePayload;
}

export interface EnvironmentDaemonSessionReplacedMessage
  extends EnvironmentDaemonSessionBoundMessageBase {
  type: "session_replaced";
  payload: EnvironmentDaemonSessionReplacedPayload;
}

export type EnvironmentDaemonSessionClientMessage =
  | EnvironmentDaemonSessionOpenMessage
  | EnvironmentDaemonSessionHeartbeatMessage
  | EnvironmentDaemonSessionEventBatchMessage
  | EnvironmentDaemonSessionCommandAckMessage
  | EnvironmentDaemonSessionCommandResultMessage
  | EnvironmentDaemonSessionToolCallRequestMessage
  | EnvironmentDaemonSessionCloseMessage;

export type EnvironmentDaemonSessionSessionControlMessage =
  | EnvironmentDaemonSessionCloseMessage
  | EnvironmentDaemonSessionReplacedMessage;

export type EnvironmentDaemonSessionServerMessage =
  | EnvironmentDaemonSessionWelcomeMessage
  | EnvironmentDaemonSessionEventAckMessage
  | EnvironmentDaemonSessionCommandBatchMessage
  | EnvironmentDaemonSessionToolCallResponseMessage
  | EnvironmentDaemonSessionSessionControlMessage;

export type EnvironmentDaemonSessionMessage =
  | EnvironmentDaemonSessionClientMessage
  | EnvironmentDaemonSessionServerMessage;

const environmentDaemonSessionBaseMessageSchema = z.object({
  protocol: z.literal(ENVIRONMENT_DAEMON_SESSION_PROTOCOL),
  messageId: z.string().min(1),
  sentAt: z.number().finite(),
});

const environmentDaemonSessionBoundMessageSchema =
  environmentDaemonSessionBaseMessageSchema.extend({
    sessionId: z.string().min(1),
  });

export const environmentDaemonSessionOpenMessageSchema =
  environmentDaemonSessionBaseMessageSchema.extend({
    type: z.literal("session_open"),
    payload: environmentDaemonSessionOpenPayloadSchema,
  });

export const environmentDaemonSessionClientMessageSchema =
  z.discriminatedUnion("type", [
    environmentDaemonSessionOpenMessageSchema,
    environmentDaemonSessionBoundMessageSchema.extend({
      type: z.literal("heartbeat"),
      payload: environmentDaemonSessionHeartbeatPayloadSchema,
    }),
    environmentDaemonSessionBoundMessageSchema.extend({
      type: z.literal("event_batch"),
      payload: environmentDaemonSessionEventBatchPayloadSchema,
    }),
    environmentDaemonSessionBoundMessageSchema.extend({
      type: z.literal("command_ack"),
      payload: environmentDaemonSessionCommandAckPayloadSchema,
    }),
    environmentDaemonSessionBoundMessageSchema.extend({
      type: z.literal("command_result"),
      payload: environmentDaemonSessionCommandResultPayloadSchema,
    }),
    environmentDaemonSessionBoundMessageSchema.extend({
      type: z.literal("tool_call_request"),
      payload: environmentDaemonSessionToolCallRequestPayloadSchema,
    }),
    environmentDaemonSessionBoundMessageSchema.extend({
      type: z.literal("session_close"),
      payload: z.object({
        reason: environmentDaemonSessionClientCloseReasonSchema,
      }),
    }),
  ]);

export const environmentDaemonSessionWelcomeMessageSchema =
  environmentDaemonSessionBoundMessageSchema.extend({
    type: z.literal("session_welcome"),
    payload: environmentDaemonSessionWelcomePayloadSchema,
  });

export const environmentDaemonSessionEventAckMessageSchema =
  environmentDaemonSessionBoundMessageSchema.extend({
    type: z.literal("event_ack"),
    payload: environmentDaemonSessionEventAckPayloadSchema,
  });

export const environmentDaemonSessionCommandBatchMessageSchema =
  environmentDaemonSessionBoundMessageSchema.extend({
    type: z.literal("command_batch"),
    payload: environmentDaemonSessionCommandBatchPayloadSchema,
  });

export const environmentDaemonSessionToolCallResponseMessageSchema =
  environmentDaemonSessionBoundMessageSchema.extend({
    type: z.literal("tool_call_response"),
    payload: environmentDaemonSessionToolCallResponsePayloadSchema,
  });

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasBaseMessageFields(
  value: unknown,
): value is Record<string, unknown> & {
  protocol: typeof ENVIRONMENT_DAEMON_SESSION_PROTOCOL;
  messageId: string;
  sentAt: number;
  type: string;
} {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    record.protocol === ENVIRONMENT_DAEMON_SESSION_PROTOCOL &&
    typeof record.messageId === "string" &&
    record.messageId.length > 0 &&
    typeof record.sentAt === "number" &&
    Number.isFinite(record.sentAt) &&
    typeof record.type === "string"
  );
}

export function isEnvironmentDaemonSessionCursor(
  value: unknown,
): value is EnvironmentDaemonSessionCursor {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return (
    typeof record.generation === "number" &&
    Number.isInteger(record.generation) &&
    record.generation >= 0 &&
    typeof record.sequence === "number" &&
    Number.isInteger(record.sequence) &&
    record.sequence >= 0
  );
}

export function compareEnvironmentDaemonSessionCursors(
  left: EnvironmentDaemonSessionCursor,
  right: EnvironmentDaemonSessionCursor,
): number {
  if (left.generation !== right.generation) {
    return left.generation - right.generation;
  }
  return left.sequence - right.sequence;
}

export function isEnvironmentDaemonSessionMessage(
  value: unknown,
): value is EnvironmentDaemonSessionMessage {
  if (!hasBaseMessageFields(value)) {
    return false;
  }
  switch (value.type) {
    case "session_open":
      return true;
    case "session_welcome":
    case "heartbeat":
    case "event_batch":
    case "event_ack":
    case "command_batch":
    case "command_ack":
    case "command_result":
    case "tool_call_request":
    case "tool_call_response":
    case "session_close":
    case "session_replaced":
      return typeof value.sessionId === "string" && value.sessionId.length > 0;
    default:
      return false;
  }
}

export function isEnvironmentDaemonSessionClientMessage(
  value: unknown,
): value is EnvironmentDaemonSessionClientMessage {
  if (!isEnvironmentDaemonSessionMessage(value)) {
    return false;
  }
  switch (value.type) {
    case "session_open":
    case "heartbeat":
    case "event_batch":
    case "command_ack":
    case "command_result":
    case "tool_call_request":
    case "session_close":
      return true;
    default:
      return false;
  }
}

export function isEnvironmentDaemonSessionServerMessage(
  value: unknown,
): value is EnvironmentDaemonSessionServerMessage {
  if (!isEnvironmentDaemonSessionMessage(value)) {
    return false;
  }
  switch (value.type) {
    case "session_welcome":
    case "event_ack":
    case "command_batch":
    case "tool_call_response":
    case "session_close":
    case "session_replaced":
      return true;
    default:
      return false;
  }
}
