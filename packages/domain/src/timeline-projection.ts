import { z } from "zod";
import type { ToViewMessagesOptions, ViewMessage } from "./ui-message.js";

export const viewTurnStatusValues = [
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export const viewTurnStatusSchema = z.enum(viewTurnStatusValues);
export type ViewTurnStatus = z.infer<typeof viewTurnStatusSchema>;

export const viewTurnMessageDetailValues = [
  "summary",
  "full",
] as const;
export const viewTurnMessageDetailSchema = z.enum(
  viewTurnMessageDetailValues,
);
export type ViewTurnMessageDetail = z.infer<
  typeof viewTurnMessageDetailSchema
>;

export interface ToViewProjectionOptions extends ToViewMessagesOptions {
  turnMessageDetail: ViewTurnMessageDetail;
}

export type ViewTimelineEntry =
  | ViewStandaloneTimelineEntry
  | ViewTurnTimelineEntry;

export interface ViewStandaloneTimelineEntry {
  kind: "message";
  message: ViewMessage;
}

export interface ViewTurnTimelineEntry {
  kind: "turn";
  turn: ViewTurn;
}

export interface ViewTurn {
  turnId: string;
  threadId: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  startedAt: number;
  createdAt: number;
  completedAt: number | null;
  status: ViewTurnStatus;
  summaryCount: number;
  durationMs?: number;
  terminalMessage?: ViewMessage;
  messages?: ViewMessage[];
}

export interface ViewProjection {
  entries: ViewTimelineEntry[];
}
