# `DELETE /api/v1/threads/:id/drafts/:draftId` — Delete Draft

**Route:** `apps/server/src/routes/threads/actions.ts:178`
**Contract:** `(no body schema) -> { ok: true }` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. Used only to validate the draft belongs to this thread. |
| `:draftId` (path) | Yes | Draft ID. Identifies the draft to delete. |

**All params consumed. No dead params.**

## Implementation Trace

1. **`getDraft(db, draftId)`** (sync) -- SELECT by PK from `queued_thread_messages`.
2. **Ownership check:** `draft.threadId !== id` -> 404.
3. **`deleteDraft(db, hub, draftId)`** (sync)
   - SELECT by PK (existence check).
   - DELETE by PK.
   - Notifies hub: `notifyThread(threadId, ["queue-changed"])`.
   - Returns `false` if not found -> 404.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT draft by PK | `queued_thread_messages` | PK | `getDraft` |
| 2 | SELECT draft by PK | `queued_thread_messages` | PK | `deleteDraft` existence check |
| 3 | DELETE draft by PK | `queued_thread_messages` | PK | `deleteDraft` |

**Total: 3 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `getDraft` | queued-drafts (claimDraftForSend) |
| `deleteDraft` | queued-drafts (sendClaimedDraft) |

## Flags

1. **No `ensureThreadIsWritable` guard.** Unlike the create-draft and send-draft routes, this route does not check `thread.archivedAt`. You can delete a draft on an archived thread. This is probably correct -- allowing cleanup of stale drafts on archived threads -- but it is inconsistent with the other draft routes.
2. **No `requireThreadEnvironment` call.** The route does its own lighter validation: fetch draft, check `threadId` match. It does not verify the thread or environment exist. If the thread has been deleted (CASCADE would have deleted the draft too), this is fine. But if somehow the draft outlives its thread, the `getDraft` will return it and the `deleteDraft` will succeed, which is harmless.
3. **Double PK read.** `getDraft` reads the draft, then `deleteDraft` reads it again to check existence before deleting. Minor inefficiency but trivial for a PK lookup.
4. **Can delete a claimed draft.** There is no check for `claimedAt` -- a draft currently being sent can be deleted out from under the send flow. However, the send flow's `deleteDraft` call after success would then return `false` (no-op), which is harmless. The bigger concern is if the draft is deleted between claim and command dispatch, but the send flow already has the draft data in memory, so this is safe.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| Public API type `"/threads/:id/drafts/:draftId"` | `packages/server-contract/src/public-api.ts:209` | Typed route definition consumed by API clients |
| `api.deleteThreadDraft` | `apps/app/src/lib/api.ts:403` | App-level API wrapper calling `threads[":id"].drafts[":draftId"].$delete` |
| `useDeleteThreadDraft` | `apps/app/src/hooks/useApi.ts:852` | React mutation hook wrapping `api.deleteThreadDraft` |
| `deleteDraft.mutateAsync` | `apps/app/src/views/ThreadDetailView.tsx:244,987,1011` | UI: delete a queued draft from thread detail view (two call sites: explicit delete and discard) |
| Server unit tests | `apps/server/test/public-thread-data.test.ts:499` | Unit test for draft deletion |
| Server authorization tests | `apps/server/test/public-authorization-regressions.test.ts:179` | Cross-thread draft ownership validation test |
| DB-level tests | `packages/db/test/data/drafts.test.ts:96,98` | Direct `deleteDraft` DB function tests |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
