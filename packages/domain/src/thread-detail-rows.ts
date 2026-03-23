import { z } from "zod";
import { uiMessageSchema, type UIMessage } from "./ui-message.js";

export interface ThreadDetailMessageRow {
  kind: "message";
  id: string;
  message: UIMessage;
}

export const threadDetailToolGroupStatusValues = [
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export const threadDetailToolGroupStatusSchema = z.enum(
  threadDetailToolGroupStatusValues,
);
export type ThreadDetailToolGroupStatus = z.infer<
  typeof threadDetailToolGroupStatusSchema
>;

export interface ThreadDetailToolGroupRow {
  kind: "tool-group";
  id: string;
  turnId: string;
  summaryCount: number;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  startedAt: number;
  createdAt: number;
  durationMs?: number;
  status: ThreadDetailToolGroupStatus;
  messages: UIMessage[];
}

export type ThreadDetailRow = ThreadDetailMessageRow | ThreadDetailToolGroupRow;

export const threadDetailMessageRowSchema = z.object({
  kind: z.literal("message"),
  id: z.string(),
  message: uiMessageSchema,
});
export const threadDetailToolGroupRowSchema = z.object({
  kind: z.literal("tool-group"),
  id: z.string(),
  turnId: z.string(),
  summaryCount: z.number().int(),
  sourceSeqStart: z.number().int(),
  sourceSeqEnd: z.number().int(),
  startedAt: z.number(),
  createdAt: z.number(),
  durationMs: z.number().optional(),
  status: threadDetailToolGroupStatusSchema,
  messages: z.array(uiMessageSchema),
});
export const threadDetailRowSchema = z.discriminatedUnion("kind", [
  threadDetailMessageRowSchema,
  threadDetailToolGroupRowSchema,
]);
