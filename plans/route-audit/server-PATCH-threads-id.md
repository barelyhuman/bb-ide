# `PATCH /api/v1/threads/:id` — Update thread fields, optionally rename on host

**Route:** `apps/server/src/routes/threads/base.ts:47`
**Contract:** `UpdateThreadRequest -> Thread` (200)
**Complexity:** Medium (conditional side-effect: queues daemon command)

## Request Body

| Field | Required | Notes |
|---|---|---|
| `title` | No | `string.min(1).nullable()`. If present and changed from current title, and thread has a ready environment, queues a `thread.rename` daemon command. Passed to `updateThread` which sets `threads.title`. |
| `mergeBaseBranch` | No | `string.min(1).nullable()`. Passed through to `updateThread` which sets `threads.merge_base_branch`. |
| `parentThreadId` | No | `string.min(1).nullable()`. Passed through to `updateThread` which sets `threads.parent_thread_id`. |

Schema has a `.refine()`: at least one field must be provided. All three fields are `.partial()` + individually nullable (can set to `null` to clear).

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. (sync) Zod validates body via `updateThreadRequestSchema`. Rejects if no fields present.
2. (sync) `requireThread(deps.db, id)` -- fetches current thread state. 404 if missing.
3. (sync) `updateThread(deps.db, deps.hub, thread.id, payload)` from `@bb/db`:
   - Builds a `set` object from present `"in"` checks on input keys.
   - Always sets `updatedAt = Date.now()`.
   - Runs `UPDATE threads SET ... WHERE id = ?`.
   - Re-selects the row to return updated state.
   - Fires `notifyThread` with change kinds: `"title-changed"` if title present, `"read-state-changed"` if lastReadAt present.
   - Returns updated thread or `null`.
4. (sync) If `updateThread` returns `null`, throws 404 (race condition: deleted between steps 2-3).
5. (sync) **Conditional rename side-effect:** if `payload.title` is truthy AND differs from old title AND thread has an `environmentId`:
   - `requireEnvironment(deps.db, environmentId)` -- fetches environment. 404 if missing.
   - If environment `status === "ready"` and `path` is set:
     - `queueThreadRenameCommand(deps, ...)` -- queues `thread.rename` command to daemon.
       - Gets active session for host (may be null -- rename is fire-and-forget).
       - Inserts into `host_daemon_commands`.
       - Notifies hub.
6. (sync) Returns updated thread as JSON 200.

> **-> HTTP 200 returns here.** The rename command is queued (fire-and-forget); actual rename happens asynchronously on the daemon.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE id = ?` | `threads` | PK | `requireThread` |
| 2 | `UPDATE threads SET ... WHERE id = ?` | `threads` | PK | `updateThread` |
| 3 | `SELECT * FROM threads WHERE id = ?` | `threads` | PK | Re-read after update (inside `updateThread`) |
| 4 | `SELECT * FROM environments WHERE id = ?` | `environments` | PK | Only if title changed + environmentId present |
| 5 | `SELECT * FROM host_daemon_sessions WHERE ...` | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | Only if rename needed; `getActiveSession` |
| 6 | `INSERT INTO host_daemon_commands ...` | `host_daemon_commands` | -- | Only if rename needed |

**Total: 3 queries (base case), up to 6 queries (with rename). No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThread` | GET /:id, DELETE /:id, message routes, action routes |
| `updateThread` | Internal callers (e.g., environment setup flows) |
| `requireEnvironment` | Many routes that need environment data |
| `queueThreadRenameCommand` | Only caller is this PATCH route |
| `queueCommand` | Shared command-queue primitive across all daemon commands |

## Flags

1. **`updateThread` accepts fields not exposed by the route contract.** The DB-level `UpdateThreadInput` includes `environmentId`, `lastReadAt`, and `titleFallback`, but the route contract only exposes `title`, `mergeBaseBranch`, and `parentThreadId`. This is fine -- the route acts as a filter -- but the mismatch means internal callers using `updateThread` directly can set fields that the public API cannot.
2. **Rename fires even when setting title to a new non-null value on a ready environment, regardless of thread status.** If the thread is `active` (agent running), the rename command will still be queued. This is probably fine but worth noting.
3. **`queueThreadRenameCommand` uses `getActiveSession` (nullable) not `requireConnectedHostSession`.** If no active session, `sessionId` is `null` in the command row. The command will sit in the queue until a session picks it up. This is intentional fire-and-forget behavior, unlike `thread.start` which requires a connected host.
4. **Double-read pattern.** `requireThread` reads the thread, then `updateThread` does UPDATE + SELECT. The initial read is needed to compare the old title, so the double-read is justified.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `api.updateThread()` | `apps/app/src/lib/api.ts:363` | Frontend API client — wraps `apiClient.threads[":id"].$patch()` |
| `useUpdateThread()` hook | `apps/app/src/hooks/useApi.ts:880` | React Query mutation hook wrapping `api.updateThread` |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:252,443,603` | Renames thread (title dialog) and sets `mergeBaseBranch` from merge-base selector |
| `useThreadMergeBase()` | `apps/app/src/views/useThreadMergeBase.ts:79` | Calls `updateThread.mutate` to persist the selected merge base branch |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:121,303` | Inline thread rename via context menu in sidebar |
| CLI `thread update` | `apps/cli/src/commands/thread/actions.ts:109` | Updates thread title, mergeBaseBranch, or parentThreadId from CLI |
| `updateThread()` integration helper | `tests/integration/helpers/api.ts:363` | Integration test helper wrapping `api.threads[":id"].$patch()` |
| Integration test (fake) | `tests/integration/fake/smoke.test.ts:464` | Tests thread rename via PATCH |
| Server test | `apps/server/test/public-threads.test.ts:839` | Tests PATCH thread (title update + rename command verification) |
| Contract test | `packages/server-contract/test/contract.test.ts:68-70,271` | Validates `updateThreadRequestSchema` optional field semantics |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
