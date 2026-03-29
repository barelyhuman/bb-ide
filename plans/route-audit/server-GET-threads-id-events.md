# `GET /api/v1/threads/:id/events` — Raw Thread Events with Pagination

**Route:** `apps/server/src/routes/threads/data.ts:77`
**Contract:** `PathId & { query?: ThreadEventsQuery } -> ThreadEventRow[]` (200)
**Complexity:** Simple CRUD

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Passed directly to `listThreadEventRows` -- **no `requireThread` guard**, so a missing thread returns `[]` rather than 404. |
| `afterSeq` | No | String integer. Cursor-based pagination: only returns events with `sequence > afterSeq`. |
| `limit` | No | String integer. Caps the number of rows returned. Defaults to `Number.MAX_SAFE_INTEGER` if omitted. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. **Sync** `listThreadEventRows(db, { threadId, afterSeq, limit })` (`services/thread-data.ts:31`):
   - Builds WHERE clause: `threadId = ?` and optionally `AND sequence > ?` if `afterSeq` is provided.
   - `ORDER BY sequence ASC`, `LIMIT ?`.
   - Maps each row through `decodeEventRow` (JSON.parse on `data`).
2. Returns the array directly.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM events WHERE threadId = ? [AND sequence > ?] ORDER BY sequence LIMIT ?` | events | `events_thread_sequence_idx(threadId, sequence)` | Fully covered by the composite unique index for both the filter and the ORDER BY. |

**Total: 1 query. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `listThreadEventRows` | Only used by this route |
| `decodeEventRow` | Shared with `listRecentThreadEventRows`, `listThreadEventRowsInRange` |
| `parseOptionalInteger` | Multiple routes |

## Flags

1. **No `requireThread` guard.** Same as the `/output` route -- a request for a nonexistent thread returns `[]` instead of 404. Inconsistent with `/timeline` which calls `requireThread`.
2. **`limit` defaults to `Number.MAX_SAFE_INTEGER`.** Without a limit, all events for a thread are loaded into memory. Should have a sane server-side default cap.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `bb thread show` (CLI command) | `apps/cli/src/commands/thread/show.ts:115,288` | Fetches events via `client.api.v1.threads[":id"].events.$get` for CLI display (event list and log modes) |
| `bb thread wait` (CLI command) | `apps/cli/src/commands/thread/wait.ts:90` | Polls events with `afterSeq` cursor while waiting for thread completion |
| `getThreadEvents` (integration helper) | `tests/integration/helpers/api.ts:279` | Shared test helper that calls the events endpoint |
| `readThreadEvents` (assertion helper) | `tests/integration/helpers/assertions.ts:53` | Internal assertion helper that reads events for verification |
| Provider smoke tests | `tests/integration/real/provider-smoke.test.ts:234,247,268,293,399,539,544,588` | Uses `getThreadEvents` to inspect event sequences across provider tests |
| Fake smoke tests | `tests/integration/fake/smoke.test.ts:297,326,346,384,614` | Uses `getThreadEvents` to verify event content and ordering |
| Fake multi-thread tests | `tests/integration/fake/multi-thread.test.ts:88,89,121,122,156,157,185,186,454,455,520,524,528` | Uses `getThreadEvents` to verify per-thread event isolation |
| Fake recovery tests | `tests/integration/fake/recovery.test.ts:189,215,230,330` | Uses `getThreadEvents` to verify events before/after recovery |
| CLI output tests | `apps/cli/src/__tests__/command-output.test.ts:1442,1497,1523` | Mocks events `$get` to test CLI event/log rendering |
| Server route tests | `apps/server/test/public-threads.test.ts:859`, `apps/server/test/public-thread-data.test.ts` (implicit) | Direct HTTP requests to `/api/v1/threads/:id/events` |
| Server integration test | `apps/server/test/integration.test.ts:112` | Uses typed client `publicClient.threads[":id"].events.$get` to verify events |
| Contract route definition | `packages/server-contract/src/public-api.ts:244` | Typed route definition for `/threads/:id/events` |

---

## Review Comments

<!-- Two issues: missing 404 guard and unbounded default limit. -->
