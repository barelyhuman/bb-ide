# `DELETE /api/v1/threads/:id` — Delete a thread and maybe destroy its environment

**Route:** `apps/server/src/routes/threads/base.ts:75`
**Contract:** `{ id: string (path param) } -> { ok: true }` (200)
**Complexity:** Medium (conditional async side-effect: environment cleanup)

## Request Params

| Field | Required | Notes |
|---|---|---|
| `id` | Yes (path) | Thread ID extracted via `context.req.param("id")`. Passed to `requireThread`, then `deleteThread`. |

**All 1 field consumed. No dead params.**

## Implementation Trace

1. (sync) `requireThread(deps.db, id)` -- fetches thread. 404 if missing.
2. (sync) `deleteThread(deps.db, deps.hub, thread.id)` from `@bb/db`:
   - Re-selects the thread to confirm it exists (defensive; could race with concurrent delete).
   - If not found, returns `false` (but route doesn't check this -- the prior `requireThread` already confirmed existence).
   - `DELETE FROM threads WHERE id = ?`.
   - Cascading FK deletes: `events` rows for this thread are cascade-deleted by the DB.
   - Fires `notifyThread(id, ["thread-deleted"])` and `notifyProject(projectId, ["threads-changed"])`.
3. (async) `await maybeCleanupEnvironment(deps, thread.environmentId)`:
   - If `environmentId` is null/undefined, returns immediately.
   - Fetches environment via `getEnvironment`.
   - Skips if environment is not `managed`, or already `destroying`/`destroyed`.
   - Counts live (non-archived) threads still pointing to this environment:
     - `SELECT count(*) FROM threads WHERE environment_id = ? AND archived_at IS NULL`.
     - Uses `threads_environment_idx` for the `environment_id` filter.
   - If count > 0, another thread still uses this environment -- returns without destroying.
   - If count == 0:
     - `updateEnvironment(db, hub, id, { status: "destroying" })`.
     - If environment has a `path`, queues `environment.destroy` command to daemon:
       - `getActiveSession` for host (nullable, fire-and-forget).
       - Inserts into `host_daemon_commands`.
4. (sync) Returns `{ ok: true }` as JSON 200.

> **-> HTTP 200 returns here.** Environment destroy command (if queued) executes asynchronously on the daemon.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE id = ?` | `threads` | PK | `requireThread` |
| 2 | `SELECT * FROM threads WHERE id = ?` | `threads` | PK | Inside `deleteThread` (defensive re-read) |
| 3 | `DELETE FROM threads WHERE id = ?` | `threads` | PK | Actual delete |
| 4 | `SELECT * FROM environments WHERE id = ?` | `environments` | PK | `maybeCleanupEnvironment` (only if environmentId present) |
| 5 | `SELECT count(*) FROM threads WHERE environment_id = ? AND archived_at IS NULL` | `threads` | `threads_environment_idx` | Check for remaining live threads |
| 6 | `UPDATE environments SET status = 'destroying' ...` | `environments` | PK | Only if no live threads remain |
| 7 | `SELECT * FROM host_daemon_sessions WHERE ...` | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | Only if destroy needed |
| 8 | `INSERT INTO host_daemon_commands ...` | `host_daemon_commands` | -- | Only if destroy needed |

**Total: 3 queries (base, no environment), up to 8 queries (with environment destroy). No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThread` | GET /:id, PATCH /:id, message routes, action routes |
| `deleteThread` | Only public caller is this route |
| `maybeCleanupEnvironment` | Also called from archive-thread route and potentially other cleanup paths |
| `queueEnvironmentDestroyCommand` | Called from `maybeCleanupEnvironment` (shared) |
| `queueCommand` | Shared command-queue primitive |

## Flags

1. **`deleteThread` return value is ignored.** The route calls `requireThread` first, then `deleteThread`. If a concurrent request deletes the thread between the two calls, `deleteThread` returns `false` but the route still proceeds to `maybeCleanupEnvironment` and returns `{ ok: true }`. This is benign (idempotent-ish) but technically the response claims success for a no-op delete.
2. **Redundant SELECT in `deleteThread`.** `deleteThread` re-reads the thread (to get `projectId` for the notification), but the route already has the full thread object from `requireThread`. The `projectId` could be passed in to avoid the extra read. Minor inefficiency.
3. **Cascade deletes are DB-level.** The `events` table has `onDelete: "cascade"` on `threadId`, so event rows are deleted by SQLite automatically. The `queuedThreadMessages` table also cascades. No explicit cleanup needed, but worth noting these are invisible side-effects of the DELETE.
4. **No thread-status guard.** An `active` thread (agent currently running) can be deleted. The running agent session on the daemon will encounter a missing thread on its next event write. Consider requiring the thread be stopped first, or queuing a `thread.stop` before delete.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `api.deleteThread()` | `apps/app/src/lib/api.ts:434` | Frontend API client — wraps `apiClient.threads[":id"].$delete()` |
| `useDeleteThread()` hook | `apps/app/src/hooks/useApi.ts:1003` | React Query mutation hook wrapping `api.deleteThread` |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:251,1277` | Delete button in thread detail header triggers `deleteThread.mutate()` |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:123,322` | Delete thread via context menu in sidebar |
| `ThreadDeleteDialog` | `apps/app/src/components/thread/ThreadDeleteDialog.tsx:12` | Confirmation dialog for thread deletion (renders title/type info) |
| CLI `thread delete` | `apps/cli/src/commands/thread/actions.ts:199` | Deletes thread by ID after confirmation prompt |
| CLI `manager delete` | `apps/cli/src/commands/manager.ts:137` | Deletes a manager thread by ID (same underlying DELETE route) |
| Server internal (cleanup) | `apps/server/src/services/thread-create.ts:110` | `deleteThread` called on thread-start failure to clean up the partially-created thread |
| `deleteThread()` integration helper | `tests/integration/helpers/api.ts:199` | Integration test helper wrapping `api.threads[":id"].$delete()` |
| Integration test (fake) | `tests/integration/fake/smoke.test.ts:585` | Tests thread deletion and verifies cleanup |
| DB unit test | `packages/db/test/data/threads.test.ts:99,101` | Tests `deleteThread` DB function (success + idempotent re-delete) |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
