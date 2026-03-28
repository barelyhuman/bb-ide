import { promptInputSchema, threadQueuedMessageSchema } from "@bb/domain";
import type { PromptInput, ThreadQueuedMessage } from "@bb/domain";
import { z } from "zod";

interface StoredDraftRow {
  content: string;
  createdAt: number;
  id: string;
  model: string;
  reasoningLevel: string;
  sandboxMode: string;
  serviceTier: string;
  threadId: string;
  updatedAt: number;
}

export function encodeDraftContent(input: PromptInput[]): string {
  return JSON.stringify(input);
}

export function decodeDraftContent(content: string): PromptInput[] {
  const parsed = z.array(promptInputSchema).safeParse(JSON.parse(content));
  return parsed.success ? parsed.data : [];
}

export function toQueuedMessage(row: StoredDraftRow): ThreadQueuedMessage {
  return threadQueuedMessageSchema.parse({
    id: row.id,
    content: decodeDraftContent(row.content),
    model: row.model,
    reasoningLevel: row.reasoningLevel,
    sandboxMode: row.sandboxMode,
    serviceTier: row.serviceTier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
