# `POST /api/v1/threads/:id/archive` — Archive Thread

**Route:** `apps/server/src/routes/threads/actions.ts:204`
**Contract:** `archiveThreadRequestSchema -> { ok: true }` (200)
**Complexity:** High

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. |
| `force` | Yes | Boolean. If `true`, skips workspace dirty-state checks and archives immediately. If `false`, checks for uncommitted/unmerged changes and rejects with 409 if found. |

**All 1 body field consumed. No dead params.**

## Implementation Trace

1. **`requireThreadEnvironment(db, id)`** (sync) -- fetches thread + environment.
2. **Workspace status check (conditional):** if `!force && environment.status === "ready" && environment.path`:
   - Resolves `mergeBaseBranch` from `thread.mergeBaseBranch ?? environment.defaultBranch`.
   - If no `mergeBaseBranch` and `environment.isGitRepo` -> 409 error.
   - If `mergeBaseBranch` exists:
     - **`queueCommandAndWait(..., "workspace.status")`** (async, blocks up to 30s)
       - Sends `workspace.status` command to daemon.
       - Parses result with `hostDaemonCommandResultSchemaByType["workspace.status"]`.
       - If `hasUncommittedChanges || hasCommittedUnmergedChanges` -> 409 error.
3. **Stop active thread (conditional):** if `thread.status === "active"`:
   - **`queueCommandAndWait(..., "thread.stop")`** (async, blocks up to 30s)
     - Same pattern as the stop route.
4. **`archiveThread(db, hub, thread.id)`** (sync)
   - UPDATE `threads` SET `archivedAt = now, updatedAt = now`.
   - Re-selects. Notifies `["archived-changed"]`.
5. **`maybeCleanupEnvironment(deps, thread.environmentId)`** (async)
   - `getEnvironment(db, environmentId)` -- re-reads environment.
   - Bails if not managed, or already destroying/destroyed.
   - Counts non-archived threads for this environment: `SELECT COUNT(*) FROM threads WHERE environmentId = ? AND archivedAt IS NULL`.
   - If count > 0: no-op (other live threads still using it).
   - If count === 0:
     - `updateEnvironment(db, hub, environmentId, { status: "destroying" })`.
     - If `environment.path` exists: `queueEnvironmentDestroyCommand(deps, ...)` -- queues `environment.destroy` command.

> **-> HTTP 200 returns here.** The `environment.destroy` command (if queued) executes asynchronously.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT thread by PK | `threads` | PK | `requireThreadEnvironment` |
| 2 | SELECT environment by PK | `environments` | PK | `requireThreadEnvironment` |
| 3 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | `requireConnectedHostSession` (workspace.status cmd) |
| 4 | INSERT command (txn) | `host_daemon_commands` | -- | `queueCommand` for workspace.status |
| 5 | (wait for result) | -- | -- | hub.waitForCommandResult |
| 6 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | `requireConnectedHostSession` (thread.stop cmd) |
| 7 | INSERT command (txn) | `host_daemon_commands` | -- | `queueCommand` for thread.stop |
| 8 | (wait for result) | -- | -- | hub.waitForCommandResult |
| 9 | UPDATE thread (archive) | `threads` | PK | `archiveThread` |
| 10 | SELECT thread by PK | `threads` | PK | Re-read after archive |
| 11 | SELECT environment by PK | `environments` | PK | `maybeCleanupEnvironment` |
| 12 | SELECT COUNT threads | `threads` | `threads_environment_idx` | Count live threads for env |
| 13 | UPDATE environment | `environments` | PK | Set status "destroying" |
| 14 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | For environment.destroy |
| 15 | INSERT command (txn) | `host_daemon_commands` | -- | `queueCommand` for environment.destroy |

**Total: 5-15 queries depending on path (force=true + idle skips most). No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThreadEnvironment` | send, drafts, drafts/send, stop |
| `queueCommandAndWait` | stop |
| `archiveThread` | DB-level, used only from this route |
| `maybeCleanupEnvironment` | Also used from thread delete route |

## Flags

1. **Two sequential blocking waits.** If `!force` and thread is active, this route blocks for `workspace.status` (up to 30s) then `thread.stop` (up to 30s) -- potentially 60s total. This is correct behavior but worth noting for timeout configuration.
2. **No idempotency guard.** If the thread is already archived, the route still runs `archiveThread` (setting `archivedAt` again) and `maybeCleanupEnvironment`. Harmless but wasteful.
3. **`maybeCleanupEnvironment` uses `threads_environment_idx` for the count query** -- `WHERE environmentId = ? AND archivedAt IS NULL`. The index is on `environmentId` only, so the `archivedAt IS NULL` filter is applied in-row. This is fine for a COUNT but not optimal if a single environment has many archived threads.
4. **Race condition with concurrent archive.** If two archive requests arrive simultaneously for different threads on the same environment, both could see count > 0 (before the other's archive commits) and neither would trigger cleanup. This is a low-risk edge case; the environment would be orphaned until the next cleanup cycle (if one exists).

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `archiveThreadRequestSchema` / `ArchiveThreadRequest` | `packages/server-contract/src/api-types.ts:114` | Contract definition for the request body |
| Public API type `"/threads/:id/archive"` | `packages/server-contract/src/public-api.ts:215` | Typed route definition consumed by API clients |
| `api.archiveThread` | `apps/app/src/lib/api.ts:418` | App-level API wrapper calling `threads[":id"].archive.$post` |
| `useArchiveThread` | `apps/app/src/hooks/useApi.ts:903` | React mutation hook wrapping `api.archiveThread` |
| `archiveThread.mutate` | `apps/app/src/views/ThreadDetailView.tsx:245,464,490` | UI: archive action in thread detail view (header button + work-status guard with force option) |
| CLI `archive` command | `apps/cli/src/commands/thread/actions.ts:133` | CLI: `bb thread archive [id] [--force]` calls `threads[":id"].archive.$post` |
| `archiveThread` (integration helper) | `tests/integration/helpers/api.ts:112` | Integration test helper wrapping `threads[":id"].archive.$post` |
| Integration tests (fake) | `tests/integration/fake/smoke.test.ts:516,551,711`, `multi-thread.test.ts:235,267,268` | Fake-provider tests via `archiveThread` helper |
| Server unit tests | `apps/server/test/public-threads.test.ts:674,705,1053` | Unit tests for archive route (dirty-workspace reject, clean archive, manager archive) |
| Environment actions route (internal) | `apps/server/src/routes/environments.ts:117,146` | `archiveThread(db, hub, actingThread.id)` called when `autoArchiveOnSuccess` is set on environment action |
| DB-level tests | `packages/db/test/data/threads.test.ts:73,110` | Direct `archiveThread` DB function tests |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
