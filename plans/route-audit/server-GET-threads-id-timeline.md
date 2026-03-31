# `GET /api/v1/threads/:id/timeline` — Thread Timeline for UI Rendering

**Route:** `apps/server/src/routes/threads/data.ts:49`
**Contract:** `PathId & { query?: ThreadTimelineQuery } -> ThreadTimelineResponse` (200)
**Complexity:** High

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Looked up via `requireThread` which throws 404 if missing. |
| `includeManagerDebugView` | No | `"true"/"false"`. When `"true"`, includes raw debug events and internal system messages in the view message transform. |
| `includeToolGroupMessages` | No | `"true"/"false"`. When `"true"`, includes tool group messages in the timeline row builder. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. **Sync** `requireThread(db, id)` -- looks up thread by PK. Throws 404 if not found.
2. **Sync** `buildThreadTimeline(db, thread, options)` (`services/timeline.ts:18`):
   - Calls `listRecentThreadEventRows(db, { threadId })`:
     - Queries `events` table: `WHERE threadId = ? ORDER BY sequence ASC`.
     - Maps each row through `decodeEventRow` (JSON.parse on `data` column).
   - Calls `decodeRow(row)` from `@bb/core-ui` on each event row (further decoding/normalization).
   - Calls `toViewMessages(decodedRows, options)` from `@bb/core-ui` -- transforms raw events into UI view messages. Filters based on `includeDebugRawEvents`, `includeInternalSystemMessages`, `threadStatus`, `threadType`.
   - Calls `buildTimelineRows(messages, { includeToolGroupMessages })` from `@bb/core-ui` -- groups view messages into timeline rows (turn groups, tool groups, etc.).
   - Calls `extractThreadContextWindowUsage(eventRows)` from `@bb/core-ui` -- scans event rows for context window usage data; returns `undefined` if none found.
3. Returns `{ rows, contextWindowUsage }`.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE id = ?` | threads | PK | `requireThread` |
| 2 | `SELECT * FROM events WHERE threadId = ? ORDER BY sequence ASC` | events | `events_thread_sequence_idx(threadId, sequence)` | Covered by the composite unique index. |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThread` | Most thread routes |
| `listRecentThreadEventRows` | Only used by timeline route |
| `decodeEventRow` | `listThreadEventRows`, `listThreadEventRowsInRange`, `listRecentThreadEventRows` |
| ~~`parseOptionalInteger`~~ | ~~No longer used by this route~~ |
| `buildTimelineRows`, `toViewMessages`, `decodeRow`, `extractThreadContextWindowUsage` | `@bb/core-ui` -- shared with tool-details route |
| `parseOptionalInteger` | Multiple routes |

## Flags

1. ~~**`limit` defaults to `Number.MAX_SAFE_INTEGER`**~~ -- **Resolved.** `limit` param removed entirely. It operated on raw events, which made the downstream state machine produce broken timelines for partial windows. No caller ever passed it.
2. ~~**DESC + reverse pattern**~~ -- **Resolved.** Query now uses `ORDER BY sequence ASC` directly.
3. **No response caching** -- the pre-rebuild daemon had an in-memory `ThreadTimelineCacheEntry` cache keyed by `(threadId, latestSeq, threadStatus, requestKey)`. If `latestSeq` and `threadStatus` hadn't changed since the last call, it returned the cached `ThreadTimelineResponse` without re-querying or reprocessing. The rebuild dropped this entirely. Every poll reconstructs from scratch.
4. **No noise-event filtering at the DB level** -- the pre-rebuild daemon excluded `TIMELINE_NOISE_EVENT_TYPES` (`thread/started`, `account/rateLimits/updated`, `thread/tokenUsage/updated`, `item/reasoning/summaryPartAdded`) from the query itself via `NOT IN (...)`. The current implementation fetches all events including noise, then filters in `toViewMessages`. This means noise events consume memory and processing time for no purpose.
5. **Context-window extraction scans all fetched events** -- `extractThreadContextWindowUsage` walks the full `eventRows` array backward looking for token-usage events. The pre-rebuild daemon fetched the latest `thread/tokenUsage/updated` event with a separate targeted query (`getLatestByType`), which is O(1) instead of O(N).
6. **Heavy per-event processing** -- every fetched event goes through: `decodeEventRow` (JSON.parse), `decodeRow` (Zod parse via `threadEventSchema.safeParse` + legacy normalization), `toViewMessages` (1860-line state machine), and `buildTimelineRows` (479-line grouper). With no caching, this runs on every poll for the full event history.
7. **No noise-event pruning** -- the pre-rebuild daemon had automatic noise-event pruning (deleting old noise events based on `IDLE_NOISE_EVENT_KEEP_RECENT=300`, `ARCHIVED_NOISE_EVENT_KEEP_RECENT=120`, `ACTIVE_NOISE_EVENT_KEEP_RECENT=1000`). The rebuild has no equivalent, so the events table grows without bound for noise types.

## Performance Summary (vs. Pre-rebuild)

| Aspect | Pre-rebuild daemon | Current server | Gap |
|---|---|---|---|
| Response cache | In-memory, keyed by `(threadId, latestSeq, status, requestKey)` | None | Missing |
| Noise filtering | DB-level `NOT IN (...)` exclusion | None; filtered in JS | Missing |
| Context-window lookup | Separate `getLatestByType` query (O(1)) | Linear scan of all fetched events (O(N)) | Missing |
| Noise pruning | Automatic periodic deletion of old noise events | None | Missing |
| Default limit | Caller-provided; daemon exposed it | No limit param (loads all events) | Removed -- see Flags #1 |
| Processing cost | Same `toUIMessages` + `buildThreadDetailRows` pipeline | Same pipeline (now `toViewMessages` + `buildTimelineRows`) | Equivalent |
**Net effect:** For a thread with N events, every timeline poll does: 1 unbounded SELECT, N JSON.parse calls, N Zod safeParse calls, a ~1860-line state machine pass, a grouping pass, and a linear context-window scan. The pre-rebuild version would short-circuit with a cache hit for repeated polls, exclude noise rows from the query, and fetch context-window data with a targeted index lookup.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `getThreadTimeline` (API client) | `apps/app/src/lib/api.ts:478` | Fetches timeline data from the server |
| `useThreadTimeline` (React query hook) | `apps/app/src/hooks/useApi.ts:612` | Wraps `getThreadTimeline` in a `useQuery` hook with caching/refetch |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:230` | Calls `useThreadTimeline` to load timeline rows for the thread detail page |
| `bb thread log` (CLI command) | `apps/cli/src/commands/thread/show.ts:300` | Fetches timeline via `client.api.v1.threads[":id"].timeline.$get` for CLI log output |
| `getThreadTimeline` (integration helper) | `tests/integration/helpers/api.ts:302` | Shared test helper that calls the timeline endpoint |
| Provider smoke tests | `tests/integration/real/provider-smoke.test.ts:270,329` | Uses `getThreadTimeline` helper to verify timeline after thread execution |
| Fake smoke tests | `tests/integration/fake/smoke.test.ts:310` | Uses `getThreadTimeline` helper to verify timeline content |
| CLI output tests | `apps/cli/src/__tests__/command-output.test.ts:1524` | Mocks timeline `$get` to test `bb thread log` rendering |
| Server route test | `apps/server/test/public-thread-data.test.ts:53` | Direct HTTP request to `/api/v1/threads/:id/timeline` |
| Contract route definition | `packages/server-contract/src/public-api.ts:233` | Typed route definition for `/threads/:id/timeline` |

---

## Review Comments

<!-- Flags #1 and #2 resolved.
  Remaining concerns:
  #3: Lost response cache means every poll recomputes the full timeline.
  #4: Noise events are fetched from DB and processed for nothing.
  #5: Context-window extraction is O(N) when it should be O(1).
  #7: No noise pruning means unbounded table growth.
  Priority ordering: #3 (cache) > #4 (noise filtering) > #5 (context-window) > #7 (pruning). -->
