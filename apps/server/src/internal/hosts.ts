import { createHostId, getHost, upsertHost } from "@bb/db";
import { isLoopbackAddress } from "@bb/config/loopback";
import {
  hostDaemonEnrollKeyRequestSchema,
  hostDaemonEnrollRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { getTrustedRemoteAddress } from "../request-context.js";
import { assertMatchingExistingHostType } from "../services/hosts/host-type-guard.js";
import { requireBearerToken } from "./auth.js";

function resolvePendingHostName(hostId: string): string {
  return `pending-${hostId.slice(-8)}`;
}

function assertLoopbackRequest(remoteAddress: string | undefined): void {
  if (remoteAddress && isLoopbackAddress(remoteAddress)) {
    return;
  }
  throw new ApiError(
    400,
    "unsupported_host",
    "Only the local host daemon is supported",
  );
}

export function registerInternalHostRoutes(app: Hono, deps: AppDeps): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });

  post(
    "/hosts/enroll-key",
    hostDaemonEnrollKeyRequestSchema,
    async (context, payload) => {
      assertLoopbackRequest(getTrustedRemoteAddress(context));
      const hostId = payload.hostId ?? createHostId();
      const existing = getHost(deps.db, hostId);
      assertMatchingExistingHostType({
        existingHost: existing,
        requestedHostType: "persistent",
      });

      upsertHost(deps.db, deps.hub, {
        id: hostId,
        name: existing?.name ?? resolvePendingHostName(hostId),
        type: "persistent",
      });

      const enrollKey = await deps.machineAuth.issueHostEnrollKey({
        hostId,
        hostType: "persistent",
      });

      return context.json(
        {
          enrollKey: enrollKey.key,
          expiresAt: enrollKey.expiresAt,
          hostId,
        },
        201,
      );
    },
  );

  post(
    "/hosts/enroll",
    hostDaemonEnrollRequestSchema,
    async (context, payload) => {
      const token = requireBearerToken(context.req.header("authorization"));
      const enrollment = await deps.machineAuth.enrollHost({
        hostId: payload.hostId,
        hostType: payload.hostType,
        token,
      });

      if (!enrollment) {
        throw new ApiError(401, "unauthorized", "Unauthorized");
      }
      assertMatchingExistingHostType({
        existingHost: getHost(deps.db, enrollment.metadata.hostId),
        requestedHostType: enrollment.metadata.hostType,
      });

      upsertHost(deps.db, deps.hub, {
        id: enrollment.metadata.hostId,
        name: payload.hostName,
        type: enrollment.metadata.hostType,
      });

      return context.json(
        {
          hostId: enrollment.metadata.hostId,
          hostKey: enrollment.hostKey,
        },
        201,
      );
    },
  );
}
