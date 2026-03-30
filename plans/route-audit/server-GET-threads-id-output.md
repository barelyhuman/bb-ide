# `GET /api/v1/threads/:id/output` — Last Thread Output Text

**Route:** `apps/server/src/routes/threads/data.ts:73`
**Contract:** `PathId -> { output: string | null }` (200)
**Complexity:** Medium

## Request Params

| Field | Required | Notes                                                                                                                                                      |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:id` | Yes      | Thread ID. Passed directly to `getLastThreadOutput` -- note: **no `requireThread` guard**, so a missing thread returns `{ output: null }` rather than 404. |

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

| #   | Query                                                                                       | Table  | Index                                            | Notes                                                                                                        |
| --- | ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | `SELECT * FROM events WHERE threadId = ? AND type IN (...) ORDER BY sequence DESC LIMIT 20` | events | `events_thread_sequence_idx(threadId, sequence)` | Uses the threadId prefix of the composite index. The `type IN (...)` filter is applied after the index seek. |

**Total: 1 query. No N+1.**

## Code Reuse

| Function              | Shared with                                                |
| --------------------- | ---------------------------------------------------------- |
| `getLastThreadOutput` | Only used here                                             |
| `decodeEventRow`      | Not used here -- this function does its own parsing inline |

## Flags

1. ~~**No `requireThread` guard.**~~ Fixed: added `requireThread(deps.db, context.req.param("id"))` at the start of the handler. Nonexistent threads now return 404 consistent with the other routes.
2. **Throws 500 on malformed stored events.** If a stored event has invalid JSON or fails schema validation, the route throws `ApiError(500, ...)`. This is arguably correct (data corruption), but it means a single bad event poisons the endpoint for that thread.
3. **`LIMIT 20` is insufficient.** The DB query fetches all `item/completed` variants (not just `agentMessage`), so 20 rows can be exhausted by tool calls and file changes. An agent that edits 20+ files before responding will have its output missed. The fix: filter by `json_extract(data, '$.item.type') = 'agentMessage'` at the DB level so only text items are fetched, then LIMIT 1 is sufficient.

## Usages

| Caller                                 | Location                                                                  | Purpose                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bb thread output` (CLI command)       | `apps/cli/src/commands/thread/show.ts:325`                                | Fetches last output via `client.api.v1.threads[":id"].output.$get` for CLI display |
| `getThreadOutput` (integration helper) | `tests/integration/helpers/api.ts:290`                                    | Shared test helper that calls the output endpoint                                  |
| Provider smoke tests                   | `tests/integration/real/provider-smoke.test.ts:269,294,459,531,535,593`   | Uses `getThreadOutput` to verify thread produced expected output                   |
| Fake smoke tests                       | `tests/integration/fake/smoke.test.ts:311,538,691`                        | Uses `getThreadOutput` to assert output content after turns                        |
| Fake multi-thread tests                | `tests/integration/fake/multi-thread.test.ts:132,133,245,304,458,461,531` | Uses `getThreadOutput` to verify per-thread output isolation                       |
| Fake recovery tests                    | `tests/integration/fake/recovery.test.ts:114,146,197,305,376`             | Uses `getThreadOutput` to verify output after recovery scenarios                   |
| CLI output tests                       | `apps/cli/src/__tests__/command-output.test.ts:1599`                      | Mocks output `$get` to test `bb thread output --json` rendering                    |
| Server route test                      | `apps/server/test/public-thread-data.test.ts:175,242`                     | Direct HTTP requests to `/api/v1/threads/:id/output`                               |
| Contract route definition              | `packages/server-contract/src/public-api.ts:241`                          | Typed route definition for `/threads/:id/output`                                   |

---

## Review Comments

<!-- Flag #1 is the main issue -- should add requireThread for consistency and correct 404 behavior. -->

Can we compare this route with its implementation pre-rebuilt.

> **Pre-rebuild comparison:** The old implementation (daemon `ThreadManager.getOutput()`) walked backward through ALL events, calling `provider.outputFromEvent()` on each. It checked for `message/assistant` first (legacy format), then `item/completed` with `agentMessage`. The current implementation is functionally equivalent but drops `message/assistant` (legacy) and adds `system/manager/user_message` (new). It also limits to the last 20 events instead of scanning all — a performance improvement.

its surprising to me that we use 'item/completed' as a qualifying event. isn't that going to be very low in signal to noise ratio for the actual content we want?

> **You're right — the signal-to-noise ratio is bad at the DB level.** The query fetches ALL `item/completed` events (tool calls, file changes, reasoning, web searches, agentMessages — everything), LIMIT 20, then filters in JS for `item.type === "agentMessage"`. If an agent does 20+ tool calls or file edits before responding with text, the LIMIT 20 is exhausted by non-text items and the actual output is missed.
>
> The `item/completed` event type itself is correct — that's where agent text lives (in `item.type === "agentMessage"`). But the filtering should happen at the DB level, not in JS. Options: (1) use `json_extract(data, '$.item.type') = 'agentMessage'` in the WHERE clause so LIMIT 1 is sufficient, or (2) increase the limit significantly, or (3) scan without limit (what the pre-rebuild did). This is a real bug for threads with many consecutive tool operations.
