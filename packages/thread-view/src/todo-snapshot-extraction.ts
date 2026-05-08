import { z } from "zod";
import type {
  Thread,
  ThreadEvent,
  ThreadEventPlanStepStatus,
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import type { ThreadEventWithMeta } from "./build-event-projection.js";

const TODO_TEXT_MAX_LENGTH = 240;

const KNOWN_TODO_WRITE_STATUSES: ReadonlySet<ThreadTimelinePendingTodoItemStatus> =
  new Set(["pending", "in_progress", "completed"]);

// Tolerant at the provider boundary: each item is shape-checked but unknown
// status values drop the *item*, not the whole payload. The whole-payload
// reject only fires when the args don't have a usable `todos` array at all
// (truly malformed input from a provider) — losing the entire snapshot for a
// single new status (e.g. provider adds "cancelled") would silently kill the
// banner.
const todoWriteTodoSchema = z
  .object({
    content: z.string(),
    status: z.string(),
  })
  .passthrough();

const todoWriteArgsSchema = z.object({
  todos: z.array(z.unknown()),
});

export interface ParsedTodoWriteTodo {
  content: string;
  status: ThreadTimelinePendingTodoItemStatus;
}

export interface ParsedTodoWriteArgs {
  todos: ParsedTodoWriteTodo[];
}

function trimAndTruncate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TODO_TEXT_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, TODO_TEXT_MAX_LENGTH);
}

function isKnownTodoStatus(
  value: string,
): value is ThreadTimelinePendingTodoItemStatus {
  return KNOWN_TODO_WRITE_STATUSES.has(
    value as ThreadTimelinePendingTodoItemStatus,
  );
}

/**
 * Canonical TodoWrite arguments parser. Returns null only when the args don't
 * have a `todos` array at all. Items with unknown status values, missing
 * content, or shape mismatches are dropped individually so the snapshot
 * survives partial provider drift.
 */
export function parseTodoWriteTodos(
  rawArgs: unknown,
): ParsedTodoWriteArgs | null {
  const result = todoWriteArgsSchema.safeParse(rawArgs);
  if (!result.success) return null;
  const todos: ParsedTodoWriteTodo[] = [];
  for (const rawTodo of result.data.todos) {
    const itemResult = todoWriteTodoSchema.safeParse(rawTodo);
    if (!itemResult.success) continue;
    const todo = itemResult.data;
    if (!isKnownTodoStatus(todo.status)) continue;
    const content = trimAndTruncate(todo.content);
    if (content.length === 0) continue;
    todos.push({ content, status: todo.status });
  }
  return { todos };
}

interface SnapshotCandidate {
  seq: number;
  createdAt: number;
  /** null indicates an unparseable candidate. */
  items: ThreadTimelinePendingTodoItem[] | null;
}

function todoIdFor(seq: number, index: number): string {
  return `seq:${seq}:${index}`;
}

function extractTodoWriteCandidate(
  event: ThreadEvent,
  meta: { seq: number; createdAt: number },
): SnapshotCandidate | null {
  if (event.type !== "item/started" && event.type !== "item/completed") {
    return null;
  }
  if (event.item.type !== "toolCall" || event.item.tool !== "TodoWrite") {
    return null;
  }
  const parsed = parseTodoWriteTodos(event.item.arguments);
  if (!parsed) {
    return {
      seq: meta.seq,
      createdAt: meta.createdAt,
      items: null,
    };
  }
  const items: ThreadTimelinePendingTodoItem[] = parsed.todos.map(
    (todo, index) => ({
      id: todoIdFor(meta.seq, index),
      text: todo.content,
      status: todo.status,
    }),
  );
  return {
    seq: meta.seq,
    createdAt: meta.createdAt,
    items,
  };
}

// Exhaustive over `ThreadEventPlanStepStatus`. `null` means "drop the step
// from the snapshot" (failed steps are dropped per
// plans/thread-prompt-context-banner.md Decision 3). Adding a new plan-step
// status to the domain enum will fail this map at typecheck time, forcing a
// deliberate decision here.
const PLAN_STEP_STATUS_MAP: Record<
  ThreadEventPlanStepStatus,
  ThreadTimelinePendingTodoItemStatus | null
> = {
  active: "in_progress",
  pending: "pending",
  completed: "completed",
  failed: null,
};

function extractTurnPlanCandidate(
  event: ThreadEvent,
  meta: { seq: number; createdAt: number },
): SnapshotCandidate | null {
  if (event.type !== "turn/plan/updated") return null;
  const items: ThreadTimelinePendingTodoItem[] = [];
  for (let index = 0; index < event.plan.length; index += 1) {
    const step = event.plan[index]!;
    const text = trimAndTruncate(step.step);
    if (text.length === 0) continue;
    const rawStatus: ThreadEventPlanStepStatus = step.status ?? "pending";
    const status = PLAN_STEP_STATUS_MAP[rawStatus];
    if (status === null) continue;
    items.push({
      id: todoIdFor(meta.seq, index),
      text,
      status,
    });
  }
  return {
    seq: meta.seq,
    createdAt: meta.createdAt,
    items,
  };
}

/**
 * Walks decoded thread events and emits the latest valid TODO snapshot.
 * Treated like `activeThinking`: only meaningful while the thread has an
 * active turn. Returns null when the thread is idle/errored/etc., when no
 * candidate event was observed, or when every candidate failed to parse.
 *
 * Single pass over events tracking the highest-seq valid candidate — no full
 * sort required.
 */
export function extractThreadTimelinePendingTodos(
  threadStatus: Thread["status"],
  events: readonly ThreadEventWithMeta[],
): ThreadTimelinePendingTodos | null {
  if (threadStatus !== "active") return null;

  let best: SnapshotCandidate | null = null;
  for (const { event, meta } of events) {
    const candidate =
      extractTodoWriteCandidate(event, meta) ??
      extractTurnPlanCandidate(event, meta);
    if (!candidate || candidate.items === null) continue;
    if (best === null || candidate.seq > best.seq) {
      best = candidate;
    }
  }
  if (best === null || best.items === null) return null;
  return {
    sourceSeq: best.seq,
    updatedAt: best.createdAt,
    items: best.items,
  };
}
