# `POST /api/v1/threads/:id/read` — Mark Thread as Read

**Route:** `apps/server/src/routes/threads/actions.ts:259`
**Contract:** `(no body schema) -> Thread` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. |

**No body. All params consumed.**

## Implementation Trace

1. **`updateThread(db, hub, id, { lastReadAt: Date.now() })`** (sync)
   - UPDATE `threads` SET `lastReadAt = now, updatedAt = now` WHERE `id = ?`.
   - Re-selects the row.
   - Notifies hub: `notifyThread(id, ["read-state-changed"])`.
   - If thread not found (null return), throws 404.
2. Returns the full `Thread` object.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | UPDATE thread | `threads` | PK | Set lastReadAt |
| 2 | SELECT thread by PK | `threads` | PK | Re-read after update |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `updateThread` | PATCH /threads/:id, unread route |

## Flags

None. Clean CRUD.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| Public API type `"/threads/:id/read"` | `packages/server-contract/src/public-api.ts:227` | Typed route definition consumed by API clients |
| `api.markThreadRead` | `apps/app/src/lib/api.ts:438` | App-level API wrapper calling `threads[":id"].read.$post` |
| `useMarkThreadRead` | `apps/app/src/hooks/useApi.ts:1056` | React mutation hook wrapping `api.markThreadRead` |
| `markThreadRead.mutate` | `apps/app/src/views/ThreadDetailView.tsx:249,903` | UI: explicit "mark read" toggle in thread detail view header |
| `useThreadReadTracking` | `apps/app/src/views/useThreadReadTracking.ts:30` | Auto-marks thread as read when the thread detail view mounts/focuses |
| Server unit tests | `apps/server/test/public-thread-data.test.ts:415` | Unit test for read route |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
