import { z } from "zod";
import type { ActiveThinking } from "./active-thinking.js";
import { activeThinkingSchema } from "./active-thinking.js";
import type { ToViewMessagesOptions, ViewMessage } from "./ui-message.js";

export const viewTurnStatusValues = [
  "pending",
  "completed",
  "error",
  "interrupted",
] as const;
export const viewTurnStatusSchema = z.enum(viewTurnStatusValues);
export type ViewTurnStatus = z.infer<typeof viewTurnStatusSchema>;

export const viewTurnMessageDetailValues = ["summary", "full"] as const;
export const viewTurnMessageDetailSchema = z.enum(viewTurnMessageDetailValues);
/**
 * Controls how eagerly completed turns include their message arrays.
 * Summary projections may still include messages when row ordering,
 * ungroupable messages, or nested delegation projections need them.
 */
export type ViewTurnMessageDetail = z.infer<typeof viewTurnMessageDetailSchema>;

export interface ViewProjectionState {
  /**
   * Root-projection-only ephemeral state that should not be modeled as a
   * timeline row. Nested child projections always expose `activeThinking` as
   * null because only the thread-level timeline owns live thinking state.
   */
  activeThinking: ActiveThinking | null;
}

export const viewProjectionStateSchema = z.object({
  activeThinking: activeThinkingSchema.nullable(),
});

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
  /** Present for completed turns; non-positive measured durations are clamped to 0. */
  durationMs?: number;
  terminalMessage?: ViewMessage;
  messages?: ViewMessage[];
}

export interface ViewProjection {
  entries: ViewTimelineEntry[];
  /** Projection-owned live state derived during the same event pass as entries. */
  state: ViewProjectionState;
}
