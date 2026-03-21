# BbProviderEvent Design — Complete Provider-Agnostic Event Union

## Goal

Define the canonical `BbProviderEvent` type — the closed, discriminated union of every event that flows from providers into bb. Every adapter's `translateEvent` maps its native events into `BbProviderEvent[]`. Downstream code (`to-ui-messages.ts`, persist, broadcast, env-daemon) works with `BbProviderEvent` directly — no more guessing field names or normalizing event types.

## Sources of Truth

1. **`to-ui-messages.ts`** — what the UI actually consumes (the demand side)
2. **Codex `ServerNotification`** — the richest provider, ~45 notification types
3. **`BridgeNotification`** — what claude-code/pi bridges currently emit (9 event types)
4. **`provider-semantics.ts` / `provider-session-controller.ts`** — what the server interprets

## Event Catalog

### Turn lifecycle

| BbProviderEvent type | Source: codex                                         | Source: claude-code bridge | Source: pi bridge | Consumed by                       |
| -------------------- | ----------------------------------------------------- | -------------------------- | ----------------- | --------------------------------- |
| `turn/started`       | `turn/started` (params: `{ threadId, turn: Turn }`)   | `turn/started`             | `turn/started`    | status → active, ui turn boundary |
| `turn/completed`     | `turn/completed` (params: `{ threadId, turn: Turn }`) | `turn/completed`           | `turn/completed`  | status → idle, ui turn boundary   |

### Thread lifecycle

| BbProviderEvent type  | Source: codex                                              | Source: claude-code bridge | Source: pi bridge | Consumed by                        |
| --------------------- | ---------------------------------------------------------- | -------------------------- | ----------------- | ---------------------------------- |
| `thread/started`      | `thread/started` (params: `{ thread: Thread }`)            | `thread/started`           | `thread/started`  | initial thread ack                 |
| `thread/identity`     | embedded in `thread/started` (thread.id)                   | `thread/identity`          | `thread/identity` | store provider thread ID           |
| `thread/name/updated` | `thread/name/updated` (params: `{ threadId, threadName }`) | — (not supported)          | —                 | ui title update, operation message |

### Items — agent messages

| BbProviderEvent type            | Source: codex                                       | Source: claude-code       | Source: pi                  | Consumed by              |
| ------------------------------- | --------------------------------------------------- | ------------------------- | --------------------------- | ------------------------ |
| `item/started` + agentMessage   | `item/started` (`ThreadItem.type = "agentMessage"`) | assistant SDK message     | agent_end (final text)      | ui: assistant text begin |
| `item/completed` + agentMessage | `item/completed`                                    | assistant SDK message     | agent_end                   | ui: assistant text final |
| `item/agentMessage/delta`       | `item/agentMessage/delta`                           | stream_event (text_delta) | message_update (text_delta) | ui: streaming text       |

### Items — command execution

| BbProviderEvent type                | Source: codex                                           | Source: claude-code | Source: pi                  | Consumed by               |
| ----------------------------------- | ------------------------------------------------------- | ------------------- | --------------------------- | ------------------------- |
| `item/started` + commandExecution   | `item/started` (`ThreadItem.type = "commandExecution"`) | tool_use (Bash)     | tool_execution_start (Bash) | ui: tool call begin       |
| `item/completed` + commandExecution | `item/completed`                                        | tool_result         | tool_execution_end          | ui: tool call end         |
| `item/commandExecution/outputDelta` | `item/commandExecution/outputDelta`                     | —                   | —                           | ui: streaming exec output |

### Items — file changes

| BbProviderEvent type          | Source: codex                                     | Source: claude-code   | Source: pi           | Consumed by                      |
| ----------------------------- | ------------------------------------------------- | --------------------- | -------------------- | -------------------------------- |
| `item/started` + fileChange   | `item/started` (`ThreadItem.type = "fileChange"`) | tool_use (Edit/Write) | tool_execution_start | ui: file edit begin              |
| `item/completed` + fileChange | `item/completed`                                  | tool_result           | tool_execution_end   | ui: file edit end                |
| `item/fileChange/outputDelta` | `item/fileChange/outputDelta`                     | —                     | —                    | ui: streaming file change output |

### Items — web search

| BbProviderEvent type         | Source: codex                                    | Source: claude-code  | Source: pi | Consumed by          |
| ---------------------------- | ------------------------------------------------ | -------------------- | ---------- | -------------------- |
| `item/started` + webSearch   | `item/started` (`ThreadItem.type = "webSearch"`) | tool_use (WebSearch) | —          | ui: web search begin |
| `item/completed` + webSearch | `item/completed`                                 | tool_result          | —          | ui: web search end   |

### Items — custom/MCP tool calls

| BbProviderEvent type        | Source: codex                                      | Source: claude-code                 | Source: pi           | Consumed by                  |
| --------------------------- | -------------------------------------------------- | ----------------------------------- | -------------------- | ---------------------------- |
| `item/started` + toolCall   | `item/started` (`ThreadItem.type = "mcpToolCall"`) | custom_tool_call bridge item        | tool_execution_start | ui: tool call begin          |
| `item/completed` + toolCall | `item/completed`                                   | custom_tool_call_output bridge item | tool_execution_end   | ui: tool call end            |
| `item/mcpToolCall/progress` | `item/mcpToolCall/progress`                        | —                                   | —                    | ui: operation (MCP progress) |

### Items — user messages (provider-reported)

| BbProviderEvent type           | Source: codex                                      | Source: claude-code | Source: pi | Consumed by                    |
| ------------------------------ | -------------------------------------------------- | ------------------- | ---------- | ------------------------------ |
| `item/started` + userMessage   | `item/started` (`ThreadItem.type = "userMessage"`) | user SDK message    | —          | ui: user message from provider |
| `item/completed` + userMessage | `item/completed`                                   | —                   | —          | ui: user message               |

### Reasoning

| BbProviderEvent type              | Source: codex                                    | Source: claude-code | Source: pi | Consumed by                   |
| --------------------------------- | ------------------------------------------------ | ------------------- | ---------- | ----------------------------- |
| `item/started` + reasoning        | `item/started` (`ThreadItem.type = "reasoning"`) | —                   | —          | ui: reasoning begin           |
| `item/completed` + reasoning      | `item/completed`                                 | —                   | —          | ui: reasoning final           |
| `item/reasoning/summaryTextDelta` | `item/reasoning/summaryTextDelta`                | —                   | —          | ui: streaming reasoning       |
| `item/reasoning/textDelta`        | `item/reasoning/textDelta`                       | —                   | —          | ui: streaming reasoning (raw) |
| `item/reasoning/summaryPartAdded` | `item/reasoning/summaryPartAdded`                | —                   | —          | ignored noise currently       |

### Plan updates

| BbProviderEvent type | Source: codex       | Source: claude-code | Source: pi | Consumed by                  |
| -------------------- | ------------------- | ------------------- | ---------- | ---------------------------- |
| `item/plan/delta`    | `item/plan/delta`   | —                   | —          | ui: ignored currently        |
| `turn/plan/updated`  | `turn/plan/updated` | —                   | —          | ui: operation (plan updated) |
| `turn/diff/updated`  | `turn/diff/updated` | —                   | —          | ui: operation (turn diff)    |

### Token usage

| BbProviderEvent type        | Source: codex               | Source: claude-code | Source: pi | Consumed by   |
| --------------------------- | --------------------------- | ------------------- | ---------- | ------------- |
| `thread/tokenUsage/updated` | `thread/tokenUsage/updated` | result SDK message  | agent_end  | token display |

### Context compaction

| BbProviderEvent type                 | Source: codex                               | Source: claude-code | Source: pi | Consumed by              |
| ------------------------------------ | ------------------------------------------- | ------------------- | ---------- | ------------------------ |
| `item/started` + contextCompaction   | `item/started` (type = "contextCompaction") | —                   | —          | ui: compaction begin     |
| `item/completed` + contextCompaction | `item/completed`                            | —                   | —          | ui: compaction end       |
| `thread/compacted`                   | `thread/compacted`                          | —                   | —          | ui: compaction completed |

### Errors

| BbProviderEvent type | Source: codex                                              | Source: claude-code                  | Source: pi   | Consumed by                      |
| -------------------- | ---------------------------------------------------------- | ------------------------------------ | ------------ | -------------------------------- |
| `error`              | `error` (params: `{ error: TurnError, threadId, turnId }`) | error events, auth failure detection | error events | status → error, ui error message |

### Warnings

| BbProviderEvent type | Source: codex                          | Source: claude-code | Source: pi | Consumed by                                   |
| -------------------- | -------------------------------------- | ------------------- | ---------- | --------------------------------------------- |
| `warning`            | `deprecationNotice`, `configWarning`   | —                   | —          | ui: operation (deprecation or config warning)  |

Note: `account/rateLimits/updated` is dropped — it was persisted but never consumed by the UI or any downstream logic.

## BbProviderEventItem Design

`BbProviderEventItem` is the discriminated union for items within `item/started` and `item/completed` events. It covers all item types that any provider can emit:

```ts
type BbProviderEventItem =
  | { type: "userMessage"; id: string; content: BbProviderEventUserContent[] }
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: BbProviderEventItemStatus;
      aggregatedOutput?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | {
      type: "fileChange";
      id: string;
      changes: BbProviderEventFileChange[];
      status: BbProviderEventItemStatus;
    }
  | { type: "webSearch"; id: string; query: string; action?: string }
  | {
      type: "toolCall";
      id: string;
      server?: string;
      tool: string;
      arguments?: unknown;
      status: BbProviderEventItemStatus;
      result?: unknown;
      error?: string;
      durationMs?: number;
    }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "plan"; id: string; text: string }
  | { type: "contextCompaction"; id: string };
```

Key changes from current `BridgeItem`:

- **`id` on every item** — codex has it, bridges should too
- **`toolCall` replaces `custom_tool_call`/`custom_tool_call_output`** — unified tool call type for MCP, dynamic tools, etc.
- **`userMessage`** — provider-reported user messages
- **`reasoning`, `plan`, `contextCompaction`** — new item types that codex has
- **`fileChange` (not `filechange`)** — consistent casing
- **`BbProviderEventItemStatus`** — `"pending" | "completed" | "failed" | "interrupted"` (consistent with `BbProviderEventTurnStatus`)
- **`BbProviderEventFileChange`** — properly typed with `BbProviderEventFileChangeKind`
- **`BbProviderEventUserContent`** — discriminated union for text, image, localImage, localFile

## BbProviderEvent Full Union

```ts
type BbProviderEvent =
  // --- Turn lifecycle ---
  | { type: "turn/started"; threadId: string; turnId: string }
  | {
      type: "turn/completed";
      threadId: string;
      turnId: string;
      status: BbProviderEventTurnStatus;
      error?: { message: string };
    }

  // --- Thread lifecycle ---
  | { type: "thread/started"; threadId: string }
  | { type: "thread/identity"; threadId: string; providerThreadId: string }
  | { type: "thread/name/updated"; threadId: string; threadName: string }
  | { type: "thread/compacted"; threadId: string }

  // --- Items ---
  | { type: "item/started"; threadId: string; turnId: string; item: BbProviderEventItem }
  | { type: "item/completed"; threadId: string; turnId: string; item: BbProviderEventItem }

  // --- Streaming deltas ---
  | {
      type: "item/agentMessage/delta";
      threadId: string;
      turnId: string;
      itemId?: string;
      delta: string;
    }
  | {
      type: "item/commandExecution/outputDelta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "item/fileChange/outputDelta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "item/reasoning/summaryTextDelta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "item/reasoning/textDelta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "item/plan/delta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "item/mcpToolCall/progress";
      threadId: string;
      turnId: string;
      itemId: string;
      message?: string;
    }

  // --- Token usage ---
  | {
      type: "thread/tokenUsage/updated";
      threadId: string;
      turnId: string;
      tokenUsage: BbProviderEventTokenUsage;
    }

  // --- Plan/diff ---
  | {
      type: "turn/plan/updated";
      threadId: string;
      turnId: string;
      plan: BbProviderEventPlanStep[];
      explanation?: string;
    }
  | {
      type: "turn/diff/updated";
      threadId: string;
      turnId: string;
      diff?: string;
    }

  // --- Errors ---
  | {
      type: "error";
      threadId: string;
      turnId?: string;
      message: string;
      detail?: string;
      willRetry?: boolean;
    }

  // --- Warnings ---
  | {
      type: "warning";
      threadId: string;
      category: BbProviderEventWarningCategory;
      summary?: string;
      details?: string;
    };
```

## Supporting Types

```ts
type BbProviderEventItemStatus = "pending" | "completed" | "failed" | "interrupted";

/** Why a turn ended. Only appears on turn/completed — no "inProgress" because if it's completed, it's not in progress. */
type BbProviderEventTurnStatus = "completed" | "failed" | "interrupted";

type BbProviderEventFileChangeKind = "add" | "delete" | "update";

interface BbProviderEventFileChange {
  path: string;
  kind: BbProviderEventFileChangeKind;
  /** Target path for renames/moves. Only present when kind is "update". */
  movePath?: string;
  /** Unified diff content. */
  diff?: string;
}

type BbProviderEventPlanStepStatus = "pending" | "active" | "completed" | "failed";

interface BbProviderEventPlanStep {
  step: string;
  status?: BbProviderEventPlanStepStatus;
}

type BbProviderEventUserContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "localFile"; path: string };

interface BbProviderEventTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface BbProviderEventTokenUsage {
  total: BbProviderEventTokenUsageBreakdown;
  last: BbProviderEventTokenUsageBreakdown;
  modelContextWindow: number | null;
}

type BbProviderEventWarningCategory = "deprecation" | "config" | "general";
```

## What This Replaces

- `BridgeNotification` in `bb-shapes.ts` — superseded by `BbProviderEvent`
- `BridgeItem` in `bb-shapes.ts` — superseded by `BbProviderEventItem`
- `ProviderNotificationResult` — superseded by bb-side policy functions on `BbProviderEvent.type`
- The defensive parsing in `to-ui-messages.ts` (`normalizeToken`, `getFirstStringField` with fallbacks, `eventTypeMatchesAny` with slash/dot variants) — `BbProviderEvent` has a fixed discriminant, no normalization needed

## Resolved Questions

1. **`item/started` + `item/completed` wrap ALL item types** — yes, consistent envelope for all items.
2. **`turn/completed.status` uses bb-defined `BbProviderEventTurnStatus`** — `"completed" | "failed" | "interrupted"`. No `"inProgress"` — if the turn completed, it's not in progress. Adapters map provider-specific statuses into these three.
3. **`account/rateLimits/updated` dropped** — never consumed. Can add back if needed.
