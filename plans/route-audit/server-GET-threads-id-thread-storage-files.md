# `GET /api/v1/threads/:id/thread-storage/files` — List Durable Thread Storage Files

**Route:** `apps/server/src/routes/threads/data.ts`
**Contract:** `PathId & { query?: ThreadStorageFilesQuery } -> WorkspaceFileListResponse` (200)
**Complexity:** Medium

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Must resolve to a thread with an environment. |
| `query` | No | Case-insensitive substring filter passed through to `host.list_files`. |
| `limit` | No | Positive integer string. Defaults to `1000`, capped at `10000`. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. `requireThreadStorageTarget(deps, { threadId })`:
   - `requireThread(db, id)` -> 404 if missing
   - rejects threads without an environment with 409
   - `requireEnvironment(db, environmentId)` -> 404 if missing
   - `requireThreadStoragePath(deps, { hostId, threadId })`:
     - `requireConnectedHostSession(deps, hostId)` -> 502 if disconnected
     - reads the active session `dataDir`
     - builds `<dataDir>/thread-storage/<threadId>`
2. Parses `limit` with default `1000` and max `10000`.
3. Calls `queueCommandAndWait(...)` with `host.list_files` rooted at the durable thread storage path.
4. Parses the daemon result as `host.list_files` and returns `{ files, truncated }`.
5. Special case: daemon `ENOENT` is treated as empty thread storage and returns `{ files: [], truncated: false }`.

## DB Query Summary

| # | Query | Table | Notes |
|---|---|---|---|
| 1 | `SELECT * FROM threads WHERE id = ?` | `threads` | `requireThread` |
| 2 | `SELECT * FROM environments WHERE id = ?` | `environments` | `requireEnvironment` |
| 3 | `SELECT * FROM host_daemon_sessions WHERE hostId = ? ...` | `host_daemon_sessions` | `requireConnectedHostSession` |

**Total: 3 synchronous DB lookups before the daemon command is queued.**

## Flags

1. **Thread storage requires an environment.** Threads without an environment receive 409 rather than reading any host path.
2. **Server owns the durable storage root.** The client cannot choose an arbitrary host path; it only supplies `:id`, `query`, and `limit`.
3. **Missing storage is not an error.** A thread that has never written durable files yet gets an empty list instead of a 404.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `listThreadStorageFiles` | `apps/app/src/lib/api.ts` | Fetches the file list for the thread storage viewer |
| `useThreadStorageFiles` | `apps/app/src/hooks/useApi.ts` | React Query wrapper for the same route |
| `useThreadStorageViewer` | `apps/app/src/views/useThreadStorageViewer.ts` | Loads durable thread storage file names for the thread detail side panel |

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
