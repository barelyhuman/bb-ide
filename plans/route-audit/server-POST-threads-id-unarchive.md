# `POST /api/v1/threads/:id/unarchive` — Unarchive Thread

**Route:** `apps/server/src/routes/threads/actions.ts:254`
**Contract:** `(no body schema) -> { ok: true }` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. |

**No body. All params consumed.**

## Implementation Trace

1. **`unarchiveThread(db, hub, id)`** (sync)
   - UPDATE `threads` SET `archivedAt = null, updatedAt = now` WHERE `id = ?` (RETURNING).
   - If found, notifies hub: `notifyThread(id, ["archived-changed"])`.
   - Return value is not checked by the route.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | UPDATE thread (RETURNING) | `threads` | PK | Set archivedAt = null |

> **Updated 2026-03-29:** DB functions now use RETURNING — post-write re-reads eliminated.

**Total: 1 query. No N+1.**

## Code Reuse

`unarchiveThread` is a DB-level function, not shared with any other route.

## Flags

1. **No 404 check.** If the thread ID does not exist, `unarchiveThread` updates zero rows and RETURNING yields null, but the route still returns `{ ok: true }`. The caller gets a false positive.
2. **No idempotency guard.** Unarchiving an already-unarchived thread succeeds silently (sets `archivedAt` to null again, which is already null). Harmless.
3. **No environment re-provisioning.** If the environment was destroyed during archive (via `maybeCleanupEnvironment`), unarchiving does not re-provision it. The thread would be in a broken state with a destroyed or null environment. The client would need to handle this.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| Public API type `"/threads/:id/unarchive"` | `packages/server-contract/src/public-api.ts:224` | Typed route definition consumed by API clients |
| `api.unarchiveThread` | `apps/app/src/lib/api.ts:430` | App-level API wrapper calling `threads[":id"].unarchive.$post` |
| `useUnarchiveThread` | `apps/app/src/hooks/useApi.ts:949` | React mutation hook wrapping `api.unarchiveThread` |
| `unarchiveThread.mutate` | `apps/app/src/views/ThreadDetailView.tsx:248,459,1179` | UI: unarchive button in thread detail view (header + archived banner) |
| `unarchiveThread.mutate` | `apps/app/src/views/ProjectArchivedThreadsView.tsx:16,59` | UI: unarchive from the project archived-threads list view |
| CLI `unarchive` command | `apps/cli/src/commands/thread/actions.ts:159` | CLI: `bb thread unarchive [id]` calls `threads[":id"].unarchive.$post` |
| `unarchiveThread` (integration helper) | `tests/integration/helpers/api.ts:353` | Integration test helper wrapping `threads[":id"].unarchive.$post` |
| Integration tests (fake) | `tests/integration/fake/smoke.test.ts:529,723`, `multi-thread.test.ts:280` | Fake-provider tests via `unarchiveThread` helper |
| Server unit tests | `apps/server/test/public-threads.test.ts:727` | Unit test for unarchive route |
| DB-level tests | `packages/db/test/data/threads.test.ts:13` | Direct `unarchiveThread` DB function tests (imported) |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
