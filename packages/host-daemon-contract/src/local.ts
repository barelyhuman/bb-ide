import type { Hono } from "hono";
import { hc } from "hono/client";
import { z } from "zod";
import type { EmptyInput, Endpoint } from "./common.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const hostIdResponseSchema = z.object({
  hostId: z.string().min(1),
});
export type HostIdResponse = z.infer<typeof hostIdResponseSchema>;

export const openRequestSchema = z.object({
  path: z.string().min(1),
});
export type OpenRequest = z.infer<typeof openRequestSchema>;

export const statusResponseSchema = z.object({
  connected: z.boolean(),
  serverUrl: z.string(),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

// ---------------------------------------------------------------------------
// Route type definition for Hono typed client
// ---------------------------------------------------------------------------

export type HostDaemonLocalSchema = {
  "/host-id": {
    $get: Endpoint<EmptyInput, HostIdResponse>;
  };
  "/open": {
    $post: Endpoint<{ json: OpenRequest }, Record<string, never>>;
  };
  "/status": {
    $get: Endpoint<EmptyInput, StatusResponse>;
  };
  "/restart": {
    $post: Endpoint<EmptyInput, Record<string, never>>;
  };
};

export type HostDaemonLocalRoutes = Hono<{}, HostDaemonLocalSchema, "/">;

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Create a typed Hono client for the daemon's local API.
 *
 * No auth — the local API is bound to 127.0.0.1 only.
 */
export function createHostDaemonLocalClient(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return hc<HostDaemonLocalRoutes>(normalizedBaseUrl);
}
