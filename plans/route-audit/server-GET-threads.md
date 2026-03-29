# `GET /api/v1/threads` — List threads with optional filters

**Route:** `apps/server/src/routes/threads/base.ts:28`
**Contract:** `ThreadListQuery → Thread[]` (200)
**Complexity:** Simple CRUD

## Request Params (query string)

| Field | Required | Notes |
|---|---|---|
| `projectId` | No | Filters by `threads.projectId` via `eq()`. Uses `threads_project_updated_idx` (leading column). |
| `type` | No | Filters by `threads.type`. No dedicated index; scans or piggybacks on other filters. |
| `parentThreadId` | No | Filters by `threads.parentThreadId`. Uses `threads_parent_idx`. |
| `archived` | No | String `"true"`/`"false"`. Converted to boolean. `true` -> `isNotNull(archivedAt)`, `false` -> `isNull(archivedAt)`. Uses `threads_archived_status_idx` (leading column). `undefined` means no filter. |

**All 4 fields consumed. No dead params.**

## Implementation Trace

1. (sync) Zod validates query params via `threadListQuerySchema` (all fields optional, `.partial()`).
2. (sync) Route builds `ListThreadsOptions` object, spreading only present fields.
   - `archived` string is coerced to boolean (`"true"` -> `true`, else `false`), or left `undefined`.
3. (sync) Calls `listThreads(deps.db, options)` from `@bb/db`.
   - Builds a dynamic `filters` array from present options.
   - If no filters, returns `db.select().from(threads).all()` (full table scan).
   - Otherwise, applies `and(...filters)`.
4. (sync) Returns the result array as JSON 200.

> **-> HTTP 200 returns here.** Fully synchronous, no background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE <dynamic filters>` | `threads` | Varies by filter combination | Full table scan when no filters provided |

**Total: 1 query. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `listThreads` | Only caller of this DB function from routes (also used internally) |
| `threadListQuerySchema` | Route-specific; not shared |

## Flags

1. **No pagination.** `listThreads` returns `.all()` with no `LIMIT`/`OFFSET`. If a project has thousands of threads, this returns all of them in one response.
2. **No ORDER BY.** Results come back in insertion order (SQLite default), not sorted by `updatedAt` or any other column. Clients likely expect newest-first.
3. **`type` filter has no index.** Filtering by `type` alone will table-scan. Low risk if always combined with `projectId`, but the contract allows `type` as the sole filter.
4. **Full table scan when no params.** Calling `GET /threads` with no query params dumps the entire table. Consider requiring at least `projectId`.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `api.listThreads()` | `apps/app/src/lib/api.ts:311` | Frontend API client — wraps `apiClient.threads.$get()` with typed filters |
| `useThreads()` hook | `apps/app/src/hooks/useApi.ts:509` | React Query hook wrapping `api.listThreads`; used by views and components below |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:117` | Sidebar thread list — `useThreads()` with no filters to show all threads |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:222` | Fetches sibling threads for a project (filters by `projectId`) |
| `ProjectArchivedThreadsView` | `apps/app/src/views/ProjectArchivedThreadsView.tsx:9` | Lists archived threads for a project (`archived: true, projectId`) |
| `usePromptMentions()` | `apps/app/src/hooks/usePromptMentions.ts:66` | Fetches threads for `@`-mention suggestions in the prompt input (filters by `projectId`) |
| CLI `thread list` | `apps/cli/src/commands/thread/list.ts:41` | Lists threads filtered by project, parentThread, archived |
| CLI `manager list` | `apps/cli/src/commands/manager.ts:92` | Lists manager threads (`type: "manager"`) for a project |
| CLI `manager status` | `apps/cli/src/commands/manager.ts:173` | Fetches managed (child) threads by `parentThreadId` |
| CLI `status` | `apps/cli/src/commands/status.ts:113` | Fetches managed threads when current thread is a manager (`parentThreadId` filter) |
| `listThreads()` (DB) | `apps/server/src/routes/threads/base.ts:30` | Route handler implementation — calls DB function directly |
| Server test | `apps/server/test/public-thread-lifecycle-regressions.test.ts:140,282` | Verifies thread list state after create/delete operations |
| DB unit test | `packages/db/test/data/threads.test.ts:52-78` | Tests `listThreads` DB function with various filter combinations |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
