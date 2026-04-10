# Provider Event Visibility: Typing & Coverage

## Context

Investigation into `isRecord`/`toRecord` usage revealed that the provider visibility layer
uses defensive `unknown` parsing because `JsonRpcMessage.params` is typed as `unknown`.
Digging deeper, we found gaps in event coverage and inconsistencies across providers.

## Findings

### Transport Envelope

`JsonRpcMessage` has `params?: unknown`. Each provider has typed event vocabularies
(Codex via ts-rs generated types, Claude Code via SDK types, Pi via SDK types) but the
shared transport throws that away. Visibility/unhandled-event code does best-effort field
extraction with `isRecord`/`getStringProperty` chains instead of typed access.

### Event Coverage by Provider

| Provider    | SDK Event Types | Distinct Types in Fixtures | Normalized | Noise | Unhandled |
|-------------|-----------------|---------------------------|------------|-------|-----------|
| Codex       | ~48             | 15                        | 13         | 2     | 0         |
| Claude Code | ~22             | 20                        | 6          | 14    | 0         |
| Pi          | 14              | 23                        | 6          | 16    | 1         |

Fixture data from `packages/agent-provider-audit/fixtures/excalidraw/` — full raw SDK
captures (not filtered). 7 fixtures per provider.

### Classification Uses String-Matching, Not Exhaustive Types

All three visibility files use `if` chains on `string` values with a default
`return { kind, coverage: "unknown" }`. No discriminated unions, no `switch` with
exhaustiveness checking. New provider event types silently fall through to unhandled.

### Reasoning/Thinking Events

The domain model has provider-agnostic reasoning support:
- `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`
- `ThreadEventItem` type `reasoning` with `summary` and `content`
- UI renders these via `ReasoningRow`

Codex maps its reasoning events into these. **Claude Code and Pi both drop thinking
as noise**, even though the domain model supports it.

### Turn Lifecycle Differs by Provider

Codex sends `turn/started` with a provider-assigned `turn.id` — adapter reads it directly.
Pi sends `agent_start` with no turn ID — adapter synthesizes turn IDs via
`turnState.ensureTurnStarted()` (`turn-1`, `turn-2`, ...). Pi's SDK-level `turn_start`
fires reliably (169 times in fixtures) but is classified as noise.

Claude Code has no SDK-level turn concept — turns are implicit message sequences ending
with a `result` message. Synthesizing turn IDs is unavoidable for Claude Code.

### Unhandled Event Summarization Is Brittle

When an event has no translation, the visibility layer digs into `unknown` params with
`isRecord`/`getStringProperty`/`getRecordProperty` chains to extract up to 4
`detailEntries` like `{ label: "status", value: "pending" }`. This is:
- **Lossy** — the actual event payload is discarded
- **Brittle** — hand-picked field paths that may not exist per provider
- **Low value** — the summarized output is barely more useful than showing raw JSON

### Potentially Valuable "Noise" Events Being Dropped

**Claude Code:**
- `system:init` — version, config, available models, session ID
- `task_started` — subagent launch: task_id, description, prompt
- `task_progress` — subagent cost: total_tokens, tool_uses, duration_ms (298 events in fixtures — 5th most common event type)
- `task_notification` — subagent completion: status, summary, usage
- `thinking` — model reasoning content (156 thinking_delta events in fixtures)
- `rate_limit_event` — rate limiting visibility

**Pi:**
- `auto_compaction_start/end` — context window management
- `auto_retry_start/end` — retry visibility
- Thinking events: `thinking_start/delta/end` (117 thinking_delta events in fixtures)

**Codex:**
- Approval workflows, MCP OAuth, skill changes, model rerouting

## Work Items

### 1. Store unhandled events raw

Replace the brittle `detailEntries` summarization with storing the full `rawEvent` payload
on `provider/unhandled` events. Render as collapsible JSON (or a provider-aware formatter
later). Delete the shared summarization helpers in `provider-visibility-helpers.ts` and
`provider-unhandled-event.ts` that exist only for this purpose (`getRecordProperty`,
`getStringProperty`, `buildSummaryCandidates`, `buildUnhandledDetailEntries`, etc.).

**Files:**
- `packages/agent-runtime/src/shared/provider-unhandled-event.ts` — simplify to just pass through raw event
- `packages/agent-runtime/src/shared/provider-visibility-helpers.ts` — remove helpers only used by summarization
- `packages/domain/src/provider-event.ts` — update `ProviderUnhandledEvent` schema to carry raw payload instead of `detailEntries`
- UI rendering of `provider/unhandled` — update to render raw payload

**Validation:** Replay fixtures via `agent-provider-audit` — unhandled events should carry full payload. Existing snapshot tests will need updating.

### 2. Translate thinking events for Claude Code and Pi

The domain model already supports `item/reasoning/textDelta` and
`item/reasoning/summaryTextDelta`. Codex maps to these. Claude Code and Pi should too.

**Claude Code:** Map `content_block_start:thinking` + `content_block_delta:thinking_delta`
stream events to `item/reasoning/textDelta`. Map completed thinking blocks from `assistant`
messages to reasoning items.

**Pi:** Map `message_update:thinking_start/delta/end` to `item/reasoning/textDelta`.

**Files:**
- `packages/agent-runtime/src/claude-code/adapter.ts` — add thinking translation
- `packages/agent-runtime/src/claude-code/visibility.ts` — reclassify thinking as normalized
- `packages/agent-runtime/src/pi/adapter.ts` — add thinking translation
- `packages/agent-runtime/src/pi/visibility.ts` — reclassify thinking as normalized

**Validation:** Replay fixtures — reasoning events should appear in translated output. Verify `ReasoningRow` renders them in the UI via Ladle stories.

### 3. Use Pi's `turn_start` instead of synthesizing

Pi's `turn_start` fires reliably (169 times in fixtures). Use it as the turn boundary
instead of deriving turns from `agent_start`. Check whether `turn_start` carries a turn ID
or other metadata we should preserve.

**Files:**
- `packages/agent-runtime/src/pi/adapter.ts` — handle `turn_start`, stop using `ensureTurnStarted` on `agent_start`
- `packages/agent-runtime/src/pi/visibility.ts` — reclassify `turn_start` as normalized

**Validation:** Replay fixtures — `turn/started` events should still appear with correct boundaries. Verify turn IDs are stable.

### 4. Type the event vocabulary per provider

Each adapter already has Zod schemas for handled events. Extend to cover the full SDK
vocabulary so the classification is exhaustive at compile time.

**Approach:**
- Define a discriminated union (or exhaustive enum) of all known event methods per provider
- Replace `if` chains in visibility files with `switch` statements that TypeScript can exhaustively check
- New event types from SDK upgrades produce compile errors, forcing explicit classification

**Files:**
- `packages/agent-runtime/src/codex/visibility.ts`
- `packages/agent-runtime/src/claude-code/visibility.ts`
- `packages/agent-runtime/src/pi/visibility.ts`
- Possibly `packages/agent-runtime/src/provider-adapter.ts` — consider whether `JsonRpcMessage` should become provider-specific

**Note:** The `codex/investigate-permission-support` branch (not yet landed) adds 4 new Codex
event methods (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
`item/tool/requestUserInput`, `item/permissions/requestApproval`) plus a new
`decodeInteractiveRequest` path on the adapter interface. Claude Code also gets interactive
request support. These are JSON-RPC *requests* (have an `id`), not notifications — the
runtime routes them through `decodeInteractiveRequest`, not `translateEvent`, so they don't
hit the visibility layer. However, they demonstrate that the event vocabulary is actively
growing, reinforcing the need for exhaustive typing across all dispatch paths.

**Validation:** Add a fixture replay test that asserts zero unknown-coverage events for the fixture corpus. This already exists in `agent-provider-audit` — verify it catches regressions.

### 5. Evaluate remaining noise events for promotion

After items 1-4, revisit the remaining noise events with fresh eyes:
- **Claude Code `task_*` events** — subagent lifecycle and cost tracking. May need new domain-level ThreadEvent types.
- **Claude Code `system:init`** — version/config metadata. Useful for debugging.
- **Claude Code `rate_limit_event`** — user-facing rate limit visibility.
- **Pi `auto_compaction_start/end`** — context window management visibility.
- **Pi `auto_retry_start/end`** — retry visibility.

This is a product decision — which of these provide value to users vs. which are internal bookkeeping? Defer until items 1-4 are done and we can see the full translated event stream.

## Exit Criteria

- Unhandled events store full raw payload, no lossy summarization
- Thinking/reasoning events translated for all three providers
- Pi uses SDK `turn_start` instead of synthesized turns
- Every provider event type is explicitly classified with exhaustive type checking
- Fixture replay tests pass with zero unexpected unhandled events
- `isRecord`/`getStringProperty` chains in visibility layer eliminated or restricted to genuine boundaries
