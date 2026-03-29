# `GET /api/v1/threads/:id` — Get a single thread by ID

**Route:** `apps/server/src/routes/threads/base.ts:43`
**Contract:** `{ id: string (path param) } -> Thread` (200)
**Complexity:** Simple CRUD

## Request Params

| Field | Required | Notes |
|---|---|---|
| `id` | Yes (path) | Thread ID extracted via `context.req.param("id")`. Passed directly to `requireThread`. |

**All 1 field consumed. No dead params.**

## Implementation Trace

1. (sync) No body/query validation schema -- path param only.
2. (sync) Calls `requireThread(deps.db, id)` from `entity-lookup.ts`.
   - Calls `getThread(db, id)` which does `SELECT * FROM threads WHERE id = ?`.
   - If `null`, throws `ApiError(404, "thread_not_found", ...)`.
3. (sync) Returns the thread object as JSON 200.

> **-> HTTP 200 returns here.** Fully synchronous, no background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE id = ?` | `threads` | PK (`id`) | Single row lookup by primary key |

**Total: 1 query. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThread` | Used by PATCH, DELETE, and many other thread routes (messages, actions, etc.) |
| `getThread` | Core DB accessor, used throughout |

## Flags

None. Clean CRUD.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `api.getThread()` | `apps/app/src/lib/api.ts:334` | Frontend API client — wraps `apiClient.threads[":id"].$get()` |
| `useThread()` hook | `apps/app/src/hooks/useApi.ts:521` | React Query hook wrapping `api.getThread`; used by views and components below |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:205,208` | Fetches the current thread and optionally its parent thread |
| `AppLayout` | `apps/app/src/components/layout/AppLayout.tsx:254` | Fetches thread for breadcrumb/title display in the app shell |
| CLI `thread show` | `apps/cli/src/commands/thread/show.ts:108` | Displays thread details and optionally recent events |
| CLI `thread wait` | `apps/cli/src/commands/thread/wait.ts:73` | Polls thread status until a target status is reached |
| CLI `thread delete` | `apps/cli/src/commands/thread/actions.ts:185` | Fetches thread before delete confirmation prompt |
| CLI `thread stop` | `apps/cli/src/commands/thread/actions.ts:249` | Fetches thread to check status before issuing stop |
| CLI `status` | `apps/cli/src/commands/status.ts:79` | Fetches current thread by `BB_THREAD_ID` for status display |
| CLI `manager status/delete` | `apps/cli/src/commands/manager.ts:151` | `getThreadById()` helper — fetches a thread for manager commands |
| `getThread()` integration helper | `tests/integration/helpers/api.ts:268` | Integration test helper wrapping `api.threads[":id"].$get()` |
| Integration tests (fake) | `tests/integration/fake/smoke.test.ts:517,530` | Verifies archive/unarchive state via `getThread()` |
| Integration tests (fake) | `tests/integration/fake/recovery.test.ts:263` | Checks thread state after daemon reconnection |
| Integration tests (real) | `tests/integration/real/provider-smoke.test.ts:246,267` | Verifies thread state after provider interactions |
| CLI unit test | `apps/cli/src/__tests__/command-output.test.ts:1496` | Mocks `threads[":id"].$get` to test CLI `thread log` output |
| Server test | `apps/server/test/public-threads.test.ts:756,794` | Tests GET thread by ID (success and PATCH verification) |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
