# `GET /api/v1/threads/:id/timeline` — Thread Timeline for UI Rendering

**Route:** `apps/server/src/routes/threads/data.ts:49`
**Contract:** `PathId & { query?: ThreadTimelineQuery } -> ThreadTimelineResponse` (200)
**Complexity:** High

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Looked up via `requireThread` which throws 404 if missing. |
| `limit` | No | String integer. Parsed via `parseOptionalInteger`. Limits the number of **most recent** events fetched (DESC + LIMIT + reverse). Passed to `listRecentThreadEventRows`. |
| `includeManagerDebugView` | No | `"true"/"false"`. When `"true"`, includes raw debug events and internal system messages in the view message transform. |
| `includeToolGroupMessages` | No | `"true"/"false"`. When `"true"`, includes tool group messages in the timeline row builder. |

**All 4 fields consumed. No dead params.**

## Implementation Trace

1. **Sync** `requireThread(db, id)` -- looks up thread by PK. Throws 404 if not found.
2. **Sync** `buildThreadTimeline(db, thread, options)` (`services/timeline.ts:18`):
   - Calls `listRecentThreadEventRows(db, { threadId, limit })`:
     - Queries `events` table: `WHERE threadId = ? ORDER BY sequence DESC LIMIT ?`, then `.reverse()` to get ascending order.
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
| 2 | `SELECT * FROM events WHERE threadId = ? ORDER BY sequence DESC LIMIT ?` | events | `events_thread_sequence_idx(threadId, sequence)` | Covered by the composite unique index. |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThread` | Most thread routes |
| `listRecentThreadEventRows` | Only used by timeline route |
| `decodeEventRow` | `listThreadEventRows`, `listThreadEventRowsInRange`, `listRecentThreadEventRows` |
| `buildTimelineRows`, `toViewMessages`, `decodeRow`, `extractThreadContextWindowUsage` | `@bb/core-ui` -- shared with tool-details route |
| `parseOptionalInteger` | Multiple routes |

## Flags

1. **`limit` defaults to `Number.MAX_SAFE_INTEGER`** -- if no limit is provided, it loads every event for the thread into memory. For long-running threads this could be very large. Consider a sane server-side default.
2. **DESC + reverse pattern** -- `listRecentThreadEventRows` fetches in DESC order then reverses in JS. This is correct for "last N events in ascending order" but allocates a full array copy. Fine for reasonable sizes, wasteful if no limit is set (see #1).

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

<!-- Flag #1 is the main concern -- unbounded event loading with no server default limit. -->
