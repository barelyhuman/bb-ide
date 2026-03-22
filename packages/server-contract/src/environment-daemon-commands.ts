import { z } from "zod";
import {
  dynamicToolSchema,
  promptInputSchema,
  sandboxModeSchema,
  serviceTierSchema,
  threadStatusSchema,
  type Thread,
  type ThreadEvent,
} from "@bb/domain";
import { reasoningLevelSchema } from "@bb/domain";
import { spawnThreadRequestSchema } from "./public-api.js";

export const ENVIRONMENT_DAEMON_PROTOCOL_VERSION = 1 as const;

export const environmentDaemonProviderLaunchWrapperSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
});
export type EnvironmentDaemonProviderLaunchWrapper = z.infer<
  typeof environmentDaemonProviderLaunchWrapperSchema
>;

export const providerThreadContextSchema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  serverUrl: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});
export type ProviderThreadContext = z.infer<
  typeof providerThreadContextSchema
>;

export const providerExecutionOptionsSchema = z.object({
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
});
export type ProviderExecutionOptions = z.infer<
  typeof providerExecutionOptionsSchema
>;

export const environmentDaemonInitializeRequestSchema = z.object({
  method: z.string().min(1),
  params: z.unknown(),
});
export type EnvironmentDaemonInitializeRequest = z.infer<
  typeof environmentDaemonInitializeRequestSchema
>;

const environmentDaemonThreadEventListSchema = z.custom<ThreadEvent[]>(
  (value) => Array.isArray(value),
  "Expected translated thread events",
);

export const providerEnsureCommandSchema = z.object({
  type: z.literal("provider.ensure"),
  forThreadId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  context: providerThreadContextSchema.optional(),
  providerLaunch: environmentDaemonProviderLaunchWrapperSchema.optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  launchCommand: z.string().min(1).optional(),
  launchArgs: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
        placement: z.literal("home"),
      }),
    )
    .optional(),
});

export const threadStartCommandSchema = z.object({
  type: z.literal("thread.start"),
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  request: spawnThreadRequestSchema.optional(),
  context: providerThreadContextSchema.optional(),
  dynamicTools: z.array(dynamicToolSchema).optional(),
  initialize: environmentDaemonInitializeRequestSchema.optional(),
});

export const threadResumeCommandSchema = z.object({
  type: z.literal("thread.resume"),
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  providerThreadId: z.string().min(1).optional(),
  context: providerThreadContextSchema.optional(),
  options: providerExecutionOptionsSchema.optional(),
  resumePath: z.string().min(1).optional(),
  dynamicTools: z.array(dynamicToolSchema).optional(),
  initialize: environmentDaemonInitializeRequestSchema.optional(),
});

export const threadStopCommandSchema = z.object({
  type: z.literal("thread.stop"),
  threadId: z.string().min(1),
  initialize: environmentDaemonInitializeRequestSchema.optional(),
});

export const turnRunCommandSchema = z.object({
  type: z.literal("turn.run"),
  threadId: z.string().min(1),
  providerThreadId: z.string().min(1).optional(),
  requestedMode: z.enum(["auto", "steer", "start"]).optional(),
  activeTurnId: z.string().min(1).optional(),
  input: z.array(promptInputSchema),
  options: providerExecutionOptionsSchema.optional(),
  initialize: environmentDaemonInitializeRequestSchema.optional(),
});

export const threadRenameCommandSchema = z.object({
  type: z.literal("thread.rename"),
  threadId: z.string().min(1),
  providerThreadId: z.string().min(1).optional(),
  title: z.string().min(1),
  initialize: environmentDaemonInitializeRequestSchema.optional(),
});

export const providerListModelsCommandSchema = z.object({
  type: z.literal("provider.list_models"),
  providerId: z.string().min(1).optional(),
});

export const providerListCatalogCommandSchema = z.object({
  type: z.literal("provider.list_catalog"),
});

export const workspaceStatusCommandSchema = z.object({
  type: z.literal("workspace.status"),
  threadId: z.string().min(1),
});

export const workspaceDiffCommandSchema = z.object({
  type: z.literal("workspace.diff"),
  threadId: z.string().min(1),
});

export const environmentDaemonCommandSchema = z.discriminatedUnion("type", [
  providerEnsureCommandSchema,
  threadStartCommandSchema,
  threadResumeCommandSchema,
  threadStopCommandSchema,
  turnRunCommandSchema,
  threadRenameCommandSchema,
  providerListModelsCommandSchema,
  providerListCatalogCommandSchema,
  workspaceStatusCommandSchema,
  workspaceDiffCommandSchema,
]);
export type EnvironmentDaemonCommand = z.infer<
  typeof environmentDaemonCommandSchema
>;

export const environmentDaemonCommandMetadataSchema = z.object({
  protocolVersion: z.literal(ENVIRONMENT_DAEMON_PROTOCOL_VERSION),
  commandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  sentAt: z.number().int().nonnegative(),
  threadId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  expectedAfterSequence: z.number().int().nonnegative().optional(),
});
export type EnvironmentDaemonCommandMetadata = z.infer<
  typeof environmentDaemonCommandMetadataSchema
>;

export const environmentDaemonCommandEnvelopeSchema = z.object({
  meta: environmentDaemonCommandMetadataSchema,
  command: environmentDaemonCommandSchema,
});
export type EnvironmentDaemonCommandEnvelope = z.infer<
  typeof environmentDaemonCommandEnvelopeSchema
>;

export const environmentDaemonCommandDeliveryStateSchema = z.enum([
  "accepted",
  "duplicate",
  "rejected",
]);
export type EnvironmentDaemonCommandDeliveryState = z.infer<
  typeof environmentDaemonCommandDeliveryStateSchema
>;

export const environmentDaemonCommandAckSchema = z.object({
  protocolVersion: z.literal(ENVIRONMENT_DAEMON_PROTOCOL_VERSION),
  commandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  state: environmentDaemonCommandDeliveryStateSchema,
  acknowledgedAt: z.number().int().nonnegative(),
  latestSequence: z.number().int().nonnegative(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
  result: z.unknown().optional(),
});
export type EnvironmentDaemonCommandAck = z.infer<
  typeof environmentDaemonCommandAckSchema
>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getProviderThreadIdFromCommandResult(
  ack: EnvironmentDaemonCommandAck,
): string | undefined {
  const result = asRecord(ack.result);
  if (!result) {
    return undefined;
  }
  return typeof result.providerThreadId === "string"
    ? result.providerThreadId
    : undefined;
}

export const environmentDaemonEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("environment.ready"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("environment.degraded"),
    threadId: z.string().min(1),
    message: z.string(),
  }),
  z.object({
    type: z.literal("thread.started"),
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread.stopped"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("turn.started"),
    threadId: z.string().min(1),
    turnId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("turn.completed"),
    threadId: z.string().min(1),
    turnId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("provider.event"),
    threadId: z.string().min(1),
    method: z.string().min(1),
    translatedEvents: environmentDaemonThreadEventListSchema,
    providerId: z.string().min(1).optional(),
    normalizedMethod: z.string().min(1).optional(),
    shouldPersist: z.boolean().optional(),
    shouldBroadcast: z.boolean().optional(),
    nextStatus: threadStatusSchema.optional(),
    title: z.string().optional(),
    turnState: z.enum(["active", "idle"]).optional(),
    turnId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("provider.stderr"),
    threadId: z.string().min(1),
    line: z.string(),
  }),
  z.object({
    type: z.literal("provider.rpc_error"),
    threadId: z.string().min(1),
    requestId: z.union([z.string(), z.number()]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("workspace.status.changed"),
    threadId: z.string().min(1),
  }),
]);
export type EnvironmentDaemonEvent = z.infer<
  typeof environmentDaemonEventSchema
>;

export const environmentDaemonEventEnvelopeSchema = z.object({
  protocolVersion: z.literal(ENVIRONMENT_DAEMON_PROTOCOL_VERSION),
  sequence: z.number().int().nonnegative(),
  emittedAt: z.number().int().nonnegative(),
  threadId: z.string().min(1),
  event: environmentDaemonEventSchema,
});
export type EnvironmentDaemonEventEnvelope = z.infer<
  typeof environmentDaemonEventEnvelopeSchema
>;

export const environmentDaemonDeliveryReasonSchema = z.enum([
  "accepted",
  "duplicate",
  "sequence_gap",
  "transport_error",
  "thread_archived",
  "thread_inactive",
]);
export type EnvironmentDaemonDeliveryReason = z.infer<
  typeof environmentDaemonDeliveryReasonSchema
>;

export const environmentDaemonDeliveryRuntimeStateSchema = z.enum([
  "healthy",
  "retrying",
  "stalled",
  "stopped",
]);
export type EnvironmentDaemonDeliveryRuntimeState = z.infer<
  typeof environmentDaemonDeliveryRuntimeStateSchema
>;

export function decodePersistedEnvironmentDaemonCommand(args: {
  commandType: string;
  payload: unknown;
}): EnvironmentDaemonCommand {
  const payloadRecord = asRecord(args.payload);
  if (!payloadRecord) {
    throw new Error(
      `Invalid persisted environment-daemon command payload for ${args.commandType}`,
    );
  }
  const parseResult = environmentDaemonCommandSchema.safeParse({
    ...payloadRecord,
    type: args.commandType,
  });
  if (parseResult.success) {
    return parseResult.data;
  }
  const issues = parseResult.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "payload";
    return `${path}: ${issue.message}`;
  });
  throw new Error(
    `Invalid persisted environment-daemon command payload for ${args.commandType}: ${issues.join("; ")}`,
  );
}
