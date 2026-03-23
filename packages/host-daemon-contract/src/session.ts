import type { Hono } from "hono";
import { hc } from "hono/client";
import {
  hostTypeSchema,
  threadEventSchema,
  toolCallRequestSchema,
  toolCallResponseSchema,
} from "@bb/domain";
import { z } from "zod";
import type { Endpoint } from "./common.js";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonCommandEnvelopeSchema,
  hostDaemonCommandResultReportSchema,
} from "./commands.js";

export const HOST_DAEMON_SESSION_ID_HEADER = "x-bb-session-id" as const;

export const hostDaemonActiveThreadSchema = z.object({
  environmentId: z.string().min(1),
  threadId: z.string().min(1),
  providerThreadId: z.string().min(1).optional(),
});
export type HostDaemonActiveThread = z.infer<typeof hostDaemonActiveThreadSchema>;

export const hostDaemonSessionOpenRequestSchema = z.object({
  hostId: z.string().min(1),
  instanceId: z.string().min(1),
  hostName: z.string().min(1),
  hostType: hostTypeSchema,
  protocolVersion: z.literal(HOST_DAEMON_PROTOCOL_VERSION),
  activeThreads: z.array(hostDaemonActiveThreadSchema).optional(),
});
export type HostDaemonSessionOpenRequest = z.infer<
  typeof hostDaemonSessionOpenRequestSchema
>;

export const hostDaemonSessionOpenResponseSchema = z.object({
  sessionId: z.string().min(1),
  heartbeatIntervalMs: z.number().int().positive(),
  leaseTimeoutMs: z.number().int().positive(),
});
export type HostDaemonSessionOpenResponse = z.infer<
  typeof hostDaemonSessionOpenResponseSchema
>;

export const hostDaemonCommandsQuerySchema = z.object({
  afterCursor: z.string().optional(),
  limit: z.string().optional(),
  waitMs: z.string().optional(),
});
export type HostDaemonCommandsQuery = z.infer<
  typeof hostDaemonCommandsQuerySchema
>;

export const hostDaemonCommandBatchSchema = z.object({
  commands: z.array(hostDaemonCommandEnvelopeSchema),
});
export type HostDaemonCommandBatch = z.infer<typeof hostDaemonCommandBatchSchema>;

export const hostDaemonEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  environmentId: z.string().min(1),
  threadId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  event: threadEventSchema,
});
export type HostDaemonEventEnvelope = z.infer<
  typeof hostDaemonEventEnvelopeSchema
>;

export const hostDaemonEventBatchRequestSchema = z.object({
  events: z.array(hostDaemonEventEnvelopeSchema),
});
export type HostDaemonEventBatchRequest = z.infer<
  typeof hostDaemonEventBatchRequestSchema
>;

export const hostDaemonEventBatchResponseSchema = z.object({
  highWaterMarks: z.array(
    z.object({
      threadId: z.string().min(1),
      sequence: z.number().int().nonnegative(),
    }),
  ),
});
export type HostDaemonEventBatchResponse = z.infer<
  typeof hostDaemonEventBatchResponseSchema
>;

export const hostDaemonHeartbeatPayloadSchema = z.object({
  bufferDepth: z.number().int().nonnegative(),
  lastCommandCursor: z.number().int().nonnegative().optional(),
});
export type HostDaemonHeartbeatPayload = z.infer<
  typeof hostDaemonHeartbeatPayloadSchema
>;

export const hostDaemonServerWsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("commands-available"),
  }),
  z.object({
    type: z.literal("session-close"),
    reason: z.enum(["replaced", "expired", "shutdown"]),
  }),
]);
export type HostDaemonServerWsMessage = z.infer<
  typeof hostDaemonServerWsMessageSchema
>;

export const hostDaemonDaemonWsMessageSchema = z.object({
  type: z.literal("heartbeat"),
  payload: hostDaemonHeartbeatPayloadSchema,
});
export type HostDaemonDaemonWsMessage = z.infer<
  typeof hostDaemonDaemonWsMessageSchema
>;

export type HostDaemonInternalSchema = {
  "/session/open": {
    $post: Endpoint<
      { json: HostDaemonSessionOpenRequest },
      HostDaemonSessionOpenResponse,
      201
    >;
  };
  "/session/commands": {
    $get:
      | Endpoint<{ query: HostDaemonCommandsQuery }, HostDaemonCommandBatch, 200>
      | Endpoint<{ query: HostDaemonCommandsQuery }, undefined, 204>;
  };
  "/session/command-result": {
    $post: Endpoint<
      { json: z.infer<typeof hostDaemonCommandResultReportSchema> },
      { ok: true }
    >;
  };
  "/session/events": {
    $post: Endpoint<
      { json: HostDaemonEventBatchRequest },
      HostDaemonEventBatchResponse
    >;
  };
  "/session/tool-call": {
    $post: Endpoint<
      { json: z.infer<typeof toolCallRequestSchema> },
      z.infer<typeof toolCallResponseSchema>
    >;
  };
};

export type HostDaemonInternalRoutes = Hono<{}, HostDaemonInternalSchema, "/">;

export function createHostDaemonClient(
  baseUrl: string,
  authToken: string,
  options: {
    sessionId?: string;
  } = {},
) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const internalBaseUrl = normalizedBaseUrl.endsWith("/internal")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/internal`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${authToken}`,
  };
  if (options.sessionId) {
    headers[HOST_DAEMON_SESSION_ID_HEADER] = options.sessionId;
  }
  return hc<HostDaemonInternalRoutes>(internalBaseUrl, { headers });
}
