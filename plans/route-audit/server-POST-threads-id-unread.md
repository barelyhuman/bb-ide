# `POST /api/v1/threads/:id/unread` — Mark Thread as Unread

**Route:** `apps/server/src/routes/threads/actions.ts:269`
**Contract:** `(no body schema) -> Thread` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. |

**No body. All params consumed.**

## Implementation Trace

1. **`updateThread(db, hub, id, { lastReadAt: null })`** (sync)
   - UPDATE `threads` SET `lastReadAt = null, updatedAt = now` WHERE `id = ?`.
   - Re-selects the row.
   - Notifies hub: `notifyThread(id, ["read-state-changed"])`.
   - If thread not found (null return), throws 404.
2. Returns the full `Thread` object.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | UPDATE thread | `threads` | PK | Set lastReadAt = null |
| 2 | SELECT thread by PK | `threads` | PK | Re-read after update |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `updateThread` | PATCH /threads/:id, read route |

## Flags

None. Clean CRUD.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| Public API type `"/threads/:id/unread"` | `packages/server-contract/src/public-api.ts:230` | Typed route definition consumed by API clients |
| `api.markThreadUnread` | `apps/app/src/lib/api.ts:442` | App-level API wrapper calling `threads[":id"].unread.$post` |
| `useMarkThreadUnread` | `apps/app/src/hooks/useApi.ts:1067` | React mutation hook wrapping `api.markThreadUnread` |
| `markThreadUnread.mutate` | `apps/app/src/views/ThreadDetailView.tsx:250,900` | UI: explicit "mark unread" toggle in thread detail view header |
| Server unit tests | `apps/server/test/public-thread-data.test.ts:426` | Unit test for unread route |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
