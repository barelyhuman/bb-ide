import { promptInputSchema, threadQueuedMessageSchema } from "@bb/domain";
import type { PermissionMode, PromptInput, ThreadQueuedMessage } from "@bb/domain";
import { z } from "zod";
import { ApiError } from "../../errors.js";

interface StoredDraftRow {
  content: string;
  createdAt: number;
  id: string;
  model: string;
  reasoningLevel: string;
  permissionMode: PermissionMode;
  serviceTier: string;
  threadId: string;
  updatedAt: number;
}

function parseStoredDraftContent(
  row: Pick<StoredDraftRow, "content" | "id" | "threadId">,
): PromptInput[] {
  let content: unknown;
  try {
    content = JSON.parse(row.content);
  } catch {
    throw new ApiError(
      500,
      "internal_error",
      `Stored draft ${row.id} for thread ${row.threadId} is not valid JSON`,
    );
  }

  const parsed = z.array(promptInputSchema).min(1).safeParse(content);
  if (!parsed.success) {
    throw new ApiError(
      500,
      "internal_error",
      `Stored draft ${row.id} for thread ${row.threadId} is malformed`,
    );
  }

  return parsed.data;
}

export function toQueuedMessage(row: StoredDraftRow): ThreadQueuedMessage {
  return threadQueuedMessageSchema.parse({
    id: row.id,
    content: parseStoredDraftContent(row),
    model: row.model,
    reasoningLevel: row.reasoningLevel,
    permissionMode: row.permissionMode,
    serviceTier: row.serviceTier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
