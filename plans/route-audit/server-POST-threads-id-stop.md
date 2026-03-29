# `POST /api/v1/threads/:id/stop` — Stop Thread

**Route:** `apps/server/src/routes/threads/actions.ts:190`
**Contract:** `(no body schema) -> { ok: true }` (200)
**Complexity:** Medium

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. |

**No body. All params consumed.**

## Implementation Trace

1. **`requireThreadEnvironment(db, id)`** (sync) -- fetches thread + environment. Throws 404/409.
2. **`queueCommandAndWait(deps, { hostId, timeoutMs, command })`** (async)
   - `requireConnectedHostSession(deps, environment.hostId)` -- validates active daemon session.
   - `queueCommand(db, hub, { hostId, sessionId, type: "thread.stop", payload })` -- transactional insert into `host_daemon_commands`.
   - `hub.waitForCommandResult(commandId, COMMAND_TIMEOUT_MS)` -- **blocks up to 30s** waiting for daemon to report result.
   - On timeout: throws 504.
   - On error result: throws 502.
   - On success: returns result (unused).

> **-> HTTP 200 returns here** after the daemon confirms the stop. This is a synchronous wait, not fire-and-forget.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT thread by PK | `threads` | PK | `getThread` |
| 2 | SELECT environment by PK | `environments` | PK | `getEnvironment` |
| 3 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | `requireConnectedHostSession` |
| 4 | SELECT MAX(cursor) + INSERT command (txn) | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | `queueCommand` |

**Total: 4 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThreadEnvironment` | send, drafts, drafts/send, archive |
| `queueCommandAndWait` | archive (for workspace.status and thread.stop) |

## Flags

1. **No status check.** The route does not verify `thread.status === "active"` before sending `thread.stop`. If the thread is idle or in error state, the daemon still receives the stop command. The daemon presumably handles this gracefully, but the server does not guard against it.
2. **No `ensureThreadIsWritable` guard.** You can stop an archived thread. This may be intentional (stopping a daemon process regardless of archive state) but differs from send/draft routes.
3. **Synchronous wait pattern.** Unlike send routes which are fire-and-forget, stop blocks for up to 30s. This is correct -- the caller needs confirmation the turn actually stopped.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| Public API type `"/threads/:id/stop"` | `packages/server-contract/src/public-api.ts:212` | Typed route definition consumed by API clients |
| `api.stopThread` | `apps/app/src/lib/api.ts:414` | App-level API wrapper calling `threads[":id"].stop.$post` |
| `useStopThread` | `apps/app/src/hooks/useApi.ts:868` | React mutation hook wrapping `api.stopThread` |
| `stopThread.mutate` | `apps/app/src/views/ThreadDetailView.tsx:247,1086` | UI: stop button in thread detail view |
| CLI `stop` command | `apps/cli/src/commands/thread/actions.ts:240` | CLI: `bb thread stop [id]` calls `threads[":id"].stop.$post` |
| `stopThread` (integration helper) | `tests/integration/helpers/api.ts:343` | Integration test helper wrapping `threads[":id"].stop.$post` |
| Integration tests (fake) | `tests/integration/fake/smoke.test.ts:382` | Fake-provider test via `stopThread` helper |
| Integration tests (real) | `tests/integration/real/provider-smoke.test.ts:391` | Real-provider test via `stopThread` helper |
| Archive route (internal) | `apps/server/src/routes/threads/actions.ts:204` | Archive route calls `queueCommandAndWait("thread.stop")` when thread is active (same command, different code path) |
| Server unit tests | `apps/server/test/public-threads.test.ts:661` | Unit test for stop route |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
