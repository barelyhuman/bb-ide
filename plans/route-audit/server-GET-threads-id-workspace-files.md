# `GET /api/v1/threads/:id/workspace/files` — List Files in Thread Workspace

**Route:** `apps/server/src/routes/threads/data.ts:91`
**Contract:** `PathId & { query?: ThreadWorkspaceFilesQuery } -> WorkspaceFile[]` (200)
**Complexity:** High

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Resolved to thread -> environmentId -> environment -> hostId for daemon dispatch. |
| `query` | No | Search query string. Passed through to the `workspace.list_files` daemon command. Only included in the command payload if present. |
| `limit` | No | String integer. **Accepted but never used.** Present in `threadWorkspaceFilesQuerySchema` but never read by the route handler. |

**DEAD PARAM: `limit` is accepted by the schema but never consumed.**

## Implementation Trace

1. **Sync** `requireThreadEnvironment(db, id)` (`services/entity-lookup.ts:134`):
   - Calls `requireThread(db, threadId)` -- throws 404 if thread not found.
   - Checks `thread.environmentId` -- throws 409 if null.
   - Calls `requireEnvironment(db, thread.environmentId)` -- throws 404 if environment not found.
   - Returns `{ thread, environment }`.
2. **Sync** `requireReadyWorkspaceEnvironment(environment)` (local helper, line 29):
   - Checks `environment.status === "ready"` and `environment.path` is truthy.
   - Throws 409 if not ready.
   - Returns narrowed type with `path: string` and `status: "ready"`.
3. **Async** `queueCommandAndWait(deps, { hostId, timeoutMs, command })` (`services/command-wait.ts:35`):
   - Calls `requireConnectedHostSession(deps, hostId)`:
     - Queries `host_daemon_sessions` for an active session with non-expired lease. Throws 502 if none.
   - Calls `queueCommand(db, hub, { hostId, sessionId, type, payload })` (`db/data/commands.ts:18`):
     - In a transaction: gets max cursor for host, inserts new command row with `state: "pending"`, notifies via `hub.notifyCommand`.
   - **Awaits** `hub.waitForCommandResult(commandId, timeoutMs)`:
     - Blocks up to `COMMAND_TIMEOUT_MS` (30s) waiting for the daemon to execute the command and report back.
     - Throws 504 on timeout.
   - Validates the result is a `CompletedCommandResult`. Throws 500 if malformed.
   - If `!completed.ok`, throws 502 with error details.
   - Returns `completed.result`.
4. **Sync** Parses raw result with `hostDaemonCommandResultSchemaByType["workspace.list_files"]`. Extracts `.files`.
5. Returns the files array.

> **-> HTTP 200 returns here.** The route is async due to the daemon command wait. The daemon executes `workspace.list_files` on the host and reports back.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE id = ?` | threads | PK | `requireThread` |
| 2 | `SELECT * FROM environments WHERE id = ?` | environments | PK | `requireEnvironment` |
| 3 | `SELECT * FROM host_daemon_sessions WHERE hostId = ? AND status = 'active' AND leaseExpiresAt > ?` | host_daemon_sessions | No dedicated index for this query pattern | `requireConnectedHostSession` |
| 4 | `SELECT MAX(cursor) FROM host_daemon_commands WHERE hostId = ?` | host_daemon_commands | `host_daemon_commands_host_cursor_idx` | Inside transaction |
| 5 | `INSERT INTO host_daemon_commands ...` | host_daemon_commands | -- | Insert |
| 6 | `SELECT * FROM host_daemon_commands WHERE id = ?` | host_daemon_commands | PK | Re-read after insert |

**Total: 6 queries (3 reads + 1 aggregate + 1 insert + 1 re-read). No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThreadEnvironment` | Shared with workspace/file route |
| `requireReadyWorkspaceEnvironment` | Local to this file; shared with workspace/file route |
| `queueCommandAndWait` | Shared with workspace/file, environment status/diff/actions, project files, system models/providers |
| `requireConnectedHostSession` | Used by `queueCommandAndWait` and daemon session management |

## Flags

1. **`limit` is a dead param.** Present in the query schema but never read by the handler. Per AGENTS.md: "Accepted-but-ignored route or command fields are forbidden." Should be removed from the schema or passed through to the daemon command.
2. **`requireReadyWorkspaceEnvironment` duplicates `requireReadyEnvironment`** in `entity-lookup.ts`. Both do the same `status === "ready" && path` check and throw 409. The local version in `data.ts` (line 29) is redundant -- should use the shared one from `entity-lookup.ts`.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `listThreadManagerWorkspaceFiles` (API client) | `apps/app/src/lib/api.ts:343` | Fetches workspace file list from the server |
| `useThreadManagerWorkspaceFiles` (React query hook) | `apps/app/src/hooks/useApi.ts:553` | Wraps the API call in a `useQuery` hook |
| `useManagerWorkspaceViewer` | `apps/app/src/views/useManagerWorkspaceViewer.ts:34` | Calls `useThreadManagerWorkspaceFiles` to list files for the manager workspace panel |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:218` | Calls `useManagerWorkspaceViewer` which fetches workspace files for manager threads |
| Server route test | `apps/server/test/public-thread-data.test.ts:697` | Direct HTTP request to `/api/v1/threads/:id/workspace/files?query=src` |
| Contract route definition | `packages/server-contract/src/public-api.ts:252` | Typed route definition for `/threads/:id/workspace/files` |

---

## Review Comments

<!-- Flag #1 is a policy violation. Flag #2 is a code reuse issue. -->
