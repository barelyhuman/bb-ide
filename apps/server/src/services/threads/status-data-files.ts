import {
  statusDataKeySchema,
  type JsonValue,
  type StatusDataKey,
} from "@bb/domain";
import type { ThreadStatusDataGetResponse } from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export const STATUS_DATA_NO_STORE_CACHE_CONTROL = "no-store";
export const STATUS_STATE_CLIENT_HEADER = "x-bb-status-state-client";
export const STATUS_STATE_OPERATION_HEADER = "x-bb-status-state-operation";

interface StatusDataEntry {
  key: StatusDataKey;
  value: JsonValue;
  version: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

export function parseStatusDataKey(rawKey: string): StatusDataKey {
  const parsed = statusDataKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid status-data key");
  }
  return parsed.data;
}

export function createStatusDataGetResponse(
  entry: StatusDataEntry,
): ThreadStatusDataGetResponse {
  return {
    key: entry.key,
    value: entry.value,
    version: entry.version,
    sizeBytes: entry.sizeBytes,
    modifiedAtMs: entry.modifiedAtMs,
  };
}

export function createStatusDataEtag(version: string): string {
  return `"${version}"`;
}
