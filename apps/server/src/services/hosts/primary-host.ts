import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listConnectedHostIds,
  listPublicHosts,
  type DbConnection,
} from "@bb/db";
import { HOST_ID_FILE_NAME } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  requireConnectedHostSession,
  requireNonDestroyedHostWithStatus,
} from "../lib/entity-lookup.js";

type PrimaryHostDeps = Pick<AppDeps, "config" | "db">;

export interface ReadPrimaryHostIdArgs {
  dataDir: string;
}

export interface AssertPrimaryHostIdArgs {
  hostId: string;
}

function unsupportedHostError(): ApiError {
  return new ApiError(
    400,
    "unsupported_host",
    "Only the local host daemon is supported",
  );
}

function primaryHostUnavailableError(): ApiError {
  return new ApiError(
    502,
    "host_unavailable",
    "Local host daemon is not initialized",
  );
}

export function readPrimaryHostIdFromDataDir(
  args: ReadPrimaryHostIdArgs,
): string | null {
  try {
    const value = readFileSync(
      join(args.dataDir, HOST_ID_FILE_NAME),
      "utf8",
    ).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function resolveSinglePublicHostId(db: DbConnection): string | null {
  const hosts = listPublicHosts(db);
  if (hosts.length !== 1) {
    return null;
  }
  const host = hosts[0];
  return host?.id ?? null;
}

function resolveSingleConnectedPublicHostId(db: DbConnection): string | null {
  const connectedHostIds = new Set(listConnectedHostIds(db));
  const hosts = listPublicHosts(db).filter((host) =>
    connectedHostIds.has(host.id),
  );
  if (hosts.length !== 1) {
    return null;
  }
  const host = hosts[0];
  return host?.id ?? null;
}

export function resolvePrimaryHostId(deps: PrimaryHostDeps): string | null {
  return (
    readPrimaryHostIdFromDataDir({ dataDir: deps.config.dataDir }) ??
    resolveSingleConnectedPublicHostId(deps.db) ??
    resolveSinglePublicHostId(deps.db)
  );
}

export function requirePrimaryHostId(deps: PrimaryHostDeps): string {
  const hostId = resolvePrimaryHostId(deps);
  if (!hostId) {
    throw primaryHostUnavailableError();
  }
  return hostId;
}

export function assertPrimaryHostId(
  deps: PrimaryHostDeps,
  args: AssertPrimaryHostIdArgs,
): void {
  const primaryHostId = requirePrimaryHostId(deps);
  if (args.hostId !== primaryHostId) {
    throw unsupportedHostError();
  }
}

export function requireConnectedPrimaryHostId(deps: PrimaryHostDeps): string {
  const hostId = requirePrimaryHostId(deps);
  requireNonDestroyedHostWithStatus(deps.db, hostId);
  requireConnectedHostSession(deps, hostId);
  return hostId;
}

export function assertPrimaryHostNotDeleted(
  deps: PrimaryHostDeps,
  hostId: string,
): void {
  const primaryHostId = resolvePrimaryHostId(deps);
  if (primaryHostId === hostId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Cannot delete the local host daemon",
    );
  }
}

export function rejectAdditionalHostJoin(): never {
  throw unsupportedHostError();
}
