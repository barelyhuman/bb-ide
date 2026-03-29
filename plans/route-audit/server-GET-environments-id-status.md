# `GET /api/v1/environments/:id/status` — Get Workspace Git Status

**Route:** `apps/server/src/routes/environments.ts:40`
**Contract:** `PathId & { query: EnvironmentStatusQuery } -> EnvironmentStatusResponse` (200)
**Complexity:** Medium (dispatches daemon command, awaits result)

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Environment ID. Looked up via `requireReadyEnvironment`. |
| `mergeBaseBranch` (query) | Yes | Passed directly into the `workspace.status` daemon command. Used by the daemon to compute merge-base-relative status. |

**All 2 fields consumed. No dead params.**

## Implementation Trace

1. (sync) `requireReadyEnvironment(deps.db, id)` — PK lookup on `environments`. Throws 404 if missing, 409 if `status !== "ready"` or `path` is null.
2. (async) `queueCommandAndWait(deps, {...})` — queues a `workspace.status` command to the host daemon and awaits the result:
   - (sync) `requireConnectedHostSession(deps, hostId)` — queries `host_daemon_sessions` for an active session. Throws 502 if host is disconnected.
   - (sync) `queueCommand(db, hub, {...})` — inserts a row into `host_daemon_commands` inside a transaction (computes next cursor, inserts, notifies via hub).
   - (async) `hub.waitForCommandResult(commandId, 30_000)` — awaits the daemon's response or times out (504).
   - Validates the result is a well-formed `CompletedCommandResult`. Throws 502 if `ok === false`.
3. (sync) Parses raw result with `hostDaemonCommandResultSchemaByType["workspace.status"]`.
4. Returns `{ workspace: result.workspaceStatus }`.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM environments WHERE id = ?` | `environments` | PK | |
| 2 | `SELECT * FROM host_daemon_sessions WHERE hostId = ? AND status = 'active' AND leaseExpiresAt > ?` | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | |
| 3 | `SELECT max(cursor) FROM host_daemon_commands WHERE hostId = ?` | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | Inside transaction |
| 4 | `INSERT INTO host_daemon_commands ...` | `host_daemon_commands` | — | Inside same transaction |

**Total: 4 queries (2 reads + 1 aggregate + 1 write). No N+1.**

## Code Reuse

| Function | Shared? | Other callers |
|---|---|---|
| `requireReadyEnvironment` | Shared | diff, diff/branches, actions routes |
| `queueCommandAndWait` | Shared | All daemon-proxying routes (status, diff, diff/branches, actions, system/providers, system/models) |
| `requireConnectedHostSession` | Shared | Called inside `queueCommandAndWait` |

## Flags

None. Straightforward daemon proxy with validated query params.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `getEnvironmentWorkStatus` API wrapper | `apps/app/src/lib/api.ts:450` | Fetches workspace status for an environment, returns `workspace` field |
| `useEnvironmentWorkStatus` hook | `apps/app/src/hooks/useApi.ts:587` | React Query hook wrapping `getEnvironmentWorkStatus` |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:368` | Polls workspace status to show uncommitted/unmerged changes |
| CLI `thread show --work-status` | `apps/cli/src/commands/thread/show.ts:156` | Fetches workspace status when `--work-status` flag is passed |
| `getEnvironmentStatus` test helper | `tests/integration/helpers/api.ts:247` | Integration test helper wrapping `api.environments[":id"].status.$get` |
| `smoke.test.ts` | `tests/integration/fake/smoke.test.ts:401` | Verifies workspace status (clean/dirty) after file changes and commits |
| `provider-smoke.test.ts` | `tests/integration/real/provider-smoke.test.ts:425` | Verifies workspace status in real provider tests |
| `public-environments-system.test.ts` | `apps/server/test/public-environments-system.test.ts:41` | Tests validation (missing mergeBaseBranch) and success responses |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
