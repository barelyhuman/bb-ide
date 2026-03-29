# `GET /api/v1/threads/:id/output` — Last Thread Output Text

**Route:** `apps/server/src/routes/threads/data.ts:73`
**Contract:** `PathId -> { output: string | null }` (200)
**Complexity:** Medium

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Passed directly to `getLastThreadOutput` -- note: **no `requireThread` guard**, so a missing thread returns `{ output: null }` rather than 404. |

**All 1 field consumed. No dead params.**

## Implementation Trace

1. **Sync** `getLastThreadOutput(db, threadId)` (`services/thread-data.ts:97`):
   - Queries `events` table: `WHERE threadId = ? AND type IN ('item/completed', 'system/manager/user_message') ORDER BY sequence DESC LIMIT 20`.
   - Iterates through up to 20 rows in reverse-chronological order:
     - For `system/manager/user_message`: parses JSON `data`, validates with `systemManagerUserMessageEventDataSchema`. Returns `text` if non-empty, otherwise continues.
     - For `item/completed`: validates `providerThreadId` and `turnId` are present on the row. Parses JSON `data`, reconstructs a full provider event object, validates with `providerEventSchema`. Returns `item.text` if the item is an `agentMessage` with non-empty text.
   - Returns `null` if no qualifying output found.
2. Route wraps result in `{ output: result }`.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM events WHERE threadId = ? AND type IN (...) ORDER BY sequence DESC LIMIT 20` | events | `events_thread_sequence_idx(threadId, sequence)` | Uses the threadId prefix of the composite index. The `type IN (...)` filter is applied after the index seek. |

**Total: 1 query. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `getLastThreadOutput` | Only used here |
| `decodeEventRow` | Not used here -- this function does its own parsing inline |

## Flags

1. **No `requireThread` guard.** Unlike every other thread data route, this one does not call `requireThread` first. A request for a nonexistent thread silently returns `{ output: null }` instead of 404. This is inconsistent with the other routes.
2. **Throws 500 on malformed stored events.** If a stored event has invalid JSON or fails schema validation, the route throws `ApiError(500, ...)`. This is arguably correct (data corruption), but it means a single bad event poisons the endpoint for that thread.
3. **`LIMIT 20` is hardcoded.** The function scans up to 20 recent events looking for output text. If the last 20 qualifying events are all empty-text or non-agentMessage items, it returns null even if older events have output. This is a reasonable heuristic but could miss output in edge cases with many tool-only completions.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `bb thread output` (CLI command) | `apps/cli/src/commands/thread/show.ts:325` | Fetches last output via `client.api.v1.threads[":id"].output.$get` for CLI display |
| `getThreadOutput` (integration helper) | `tests/integration/helpers/api.ts:290` | Shared test helper that calls the output endpoint |
| Provider smoke tests | `tests/integration/real/provider-smoke.test.ts:269,294,459,531,535,593` | Uses `getThreadOutput` to verify thread produced expected output |
| Fake smoke tests | `tests/integration/fake/smoke.test.ts:311,538,691` | Uses `getThreadOutput` to assert output content after turns |
| Fake multi-thread tests | `tests/integration/fake/multi-thread.test.ts:132,133,245,304,458,461,531` | Uses `getThreadOutput` to verify per-thread output isolation |
| Fake recovery tests | `tests/integration/fake/recovery.test.ts:114,146,197,305,376` | Uses `getThreadOutput` to verify output after recovery scenarios |
| CLI output tests | `apps/cli/src/__tests__/command-output.test.ts:1599` | Mocks output `$get` to test `bb thread output --json` rendering |
| Server route test | `apps/server/test/public-thread-data.test.ts:175,242` | Direct HTTP requests to `/api/v1/threads/:id/output` |
| Contract route definition | `packages/server-contract/src/public-api.ts:241` | Typed route definition for `/threads/:id/output` |

---

## Review Comments

<!-- Flag #1 is the main issue -- should add requireThread for consistency and correct 404 behavior. -->
