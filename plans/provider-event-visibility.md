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
later).

Do **not** treat the entire `provider-visibility-helpers.ts` module as summarization-only.
Some helpers used during summarization (`isRecord`, `getRecordProperty`,
`getStringProperty`, `getRawSdkMessage`) are also used by visibility code and shared
adapter utilities at real provider boundaries. Remove only the unhandled-summary-specific
helpers from `provider-unhandled-event.ts`; keep or narrow the generic boundary helpers
until typed raw-event parsing replaces their remaining callers.

**Files:**
- `packages/agent-runtime/src/shared/provider-unhandled-event.ts` — remove lossy summary-building and pass through raw event
- `packages/agent-runtime/src/shared/provider-visibility-helpers.ts` — keep generic boundary helpers still used elsewhere; optionally split out/delete only summarization-only helpers
- `packages/domain/src/provider-event.ts` — update `ProviderUnhandledEvent` schema to carry raw payload instead of `detailEntries`
- UI rendering of `provider/unhandled` — preserve a readable top-line summary, but render the raw payload for inspection

**Validation:** Replay fixtures via `agent-provider-audit` — unhandled events should carry full payload. Existing snapshot tests will need updating.

### 2. Translate thinking events for Claude Code and Pi without duplicate rendering

The domain model already supports `item/reasoning/textDelta` and
`item/reasoning/summaryTextDelta`. Codex maps to these. Claude Code and Pi should too.

This work needs one canonical reasoning rendering path per provider. Streamed reasoning
deltas and completed reasoning payloads must share stable item identity so the UI finalizes
the streaming row instead of rendering a duplicate completed row.

**Claude Code:** Map `content_block_start:thinking` + `content_block_delta:thinking_delta`
stream events to `item/reasoning/textDelta`. Completed thinking blocks from `assistant`
messages must finalize that same reasoning item. If a completed assistant payload contains
thinking without prior streamed deltas, emit one completed reasoning item instead of both
stream + final copies.

**Pi:** Map `message_update:thinking_start/delta/end` to reasoning delta/final events with
stable per-turn/per-scope item IDs so the streamed reasoning row is finalized cleanly.

**Files:**
- `packages/agent-runtime/src/claude-code/adapter.ts` — add thinking translation
- `packages/agent-runtime/src/claude-code/visibility.ts` — reclassify thinking as normalized
- `packages/agent-runtime/src/pi/adapter.ts` — add thinking translation
- `packages/agent-runtime/src/pi/visibility.ts` — reclassify thinking as normalized

**Validation:** Replay fixtures — reasoning events should appear in translated output with
no duplicate reasoning rows per provider turn. Verify `ReasoningRow` renders them in the
UI via Ladle stories or focused projection tests.

### 3. Revisit Pi turn ownership before promoting `turn_start`

Pi's `turn_start` fires reliably in fixtures, but it is **not** a drop-in replacement for
the current bb turn lifecycle. The current adapter starts one bb turn on `agent_start` and
completes it on `agent_end`; the fixture corpus shows many more `turn_start`/`turn_end`
pairs than `agent_start`/`agent_end`, which suggests they may represent internal provider
subturns rather than user-visible turns.

First determine what Pi's `turn_start`/`turn_end` mean semantically and whether switching
bb turn ownership to them would fragment one user turn into many smaller turns. Only move
bb turn start/completion to `turn_start`/`turn_end` if fixture replay shows that assistant
messages, tool activity, token usage, and completion semantics still group into the
intended user-visible turns. Otherwise keep `agent_start`/`agent_end` as canonical and
reclassify `turn_start` only if it adds useful metadata.

**Files:**
- `packages/agent-runtime/src/pi/adapter.ts` — evaluate `turn_start`/`turn_end` handling against the current `agent_start`/`agent_end` lifecycle
- `packages/agent-runtime/src/pi/visibility.ts` — update classification once the ownership decision is explicit

**Validation:** Replay fixtures — bb turns should preserve intended boundaries, with no
fragmentation of assistant/tool sequences and stable token/context-window attribution.
If the adapter switches to `turn_start`/`turn_end`, verify turn IDs remain stable.

### 4. Introduce typed provider raw-event boundaries before claiming exhaustiveness

Each adapter already has Zod schemas for handled events. Extend to cover the full SDK
vocabulary so visibility/classification runs on typed provider-specific raw-event unions
instead of generic `JsonRpcMessage` with `unknown` params. Only after that typed boundary
exists does a `switch` become meaningfully exhaustive against provider event growth.

**Approach:**
- Parse raw notifications into provider-specific discriminated unions (or equivalent typed
  descriptors) that cover the full known SDK vocabulary
- Keep generic `JsonRpcMessage` at the runtime/process boundary only; parse once at the
  provider boundary, then pass typed values through visibility/classification code
- Replace `if` chains in visibility files with `switch` statements over those typed unions
- Treat compile-time exhaustiveness as a goal only once provider-specific typed unions flow
  into all classification paths

**Files:**
- `packages/agent-runtime/src/provider-visibility.ts`
- `packages/agent-runtime/src/provider-adapter.ts`
- `packages/agent-runtime/src/codex/visibility.ts`
- `packages/agent-runtime/src/claude-code/visibility.ts`
- `packages/agent-runtime/src/pi/visibility.ts`

**Note:** The `codex/investigate-permission-support` branch (not yet landed) adds 4 new Codex
event methods (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
`item/tool/requestUserInput`, `item/permissions/requestApproval`) plus a new
`decodeInteractiveRequest` path on the adapter interface. Claude Code also gets interactive
request support. These are JSON-RPC *requests* (have an `id`), not notifications — the
runtime routes them through `decodeInteractiveRequest`, not `translateEvent`, so they don't
hit the visibility layer. However, they demonstrate that the event vocabulary is actively
growing, reinforcing the need for exhaustive typing across all dispatch paths.

**Validation:** Keep the existing fixture replay coverage assertions in
`agent-provider-audit`, and tighten them if needed so the checked-in corpus continues to
report zero providers with unhandled translated events and zero unknown raw-event kinds.

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
- Thinking/reasoning events translated for all three providers without duplicate UI rows
- Pi turn lifecycle ownership is explicit and replay-validated; no accidental fragmentation from `turn_start`/`turn_end`
- Provider raw-event classification runs from typed provider-specific boundaries, so exhaustiveness checks apply at the real classification layer
- Fixture replay tests pass with zero unexpected unhandled events
- `isRecord`/`getStringProperty` chains used only at genuine provider boundaries; unhandled-event summarization-specific chains removed
