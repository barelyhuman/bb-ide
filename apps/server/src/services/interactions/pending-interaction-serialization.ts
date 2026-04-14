import {
  pendingInteractionPayloadSchema,
  pendingInteractionResolutionSchema,
  type PendingInteraction,
} from "@bb/domain";
import type { PendingInteractionRow } from "@bb/db";
import { ApiError } from "../../errors.js";

export class PendingInteractionSerializationError extends ApiError {
  readonly interactionId: string;
  readonly field: "payload" | "resolution";

  constructor(
    interactionId: string,
    field: "payload" | "resolution",
  ) {
    super(
      500,
      "internal_error",
      `Stored pending interaction ${field} is invalid`,
    );
    this.interactionId = interactionId;
    this.field = field;
  }
}

function parseStoredPendingInteractionJson(
  row: PendingInteractionRow,
  field: "payload" | "resolution",
): unknown {
  const value = field === "payload" ? row.payload : row.resolution;
  if (value === null) {
    throw new PendingInteractionSerializationError(row.id, field);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new PendingInteractionSerializationError(row.id, field);
  }
}

export function toPendingInteraction(row: PendingInteractionRow): PendingInteraction {
  let payload: PendingInteraction["payload"];
  try {
    payload = pendingInteractionPayloadSchema.parse(
      parseStoredPendingInteractionJson(row, "payload"),
    );
  } catch (error) {
    if (error instanceof PendingInteractionSerializationError) {
      throw error;
    }
    throw new PendingInteractionSerializationError(row.id, "payload");
  }

  let resolution: PendingInteraction["resolution"];
  try {
    resolution = row.resolution === null
      ? null
      : pendingInteractionResolutionSchema.parse(
          parseStoredPendingInteractionJson(row, "resolution"),
        );
  } catch (error) {
    if (error instanceof PendingInteractionSerializationError) {
      throw error;
    }
    throw new PendingInteractionSerializationError(row.id, "resolution");
  }

  return {
    id: row.id,
    threadId: row.threadId,
    turnId: row.turnId,
    providerId: row.providerId,
    providerThreadId: row.providerThreadId,
    providerRequestId: row.providerRequestId,
    status: row.status,
    payload,
    resolution,
    statusReason: row.statusReason,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}
