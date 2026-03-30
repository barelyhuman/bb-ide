# `POST /api/v1/threads/:id/drafts/:draftId/send` — Send Draft

**Route:** `apps/server/src/routes/threads/actions.ts:168`
**Contract:** `sendDraftRequestSchema -> SendDraftResponse` (200)
**Complexity:** High

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Thread ID. Used to look up thread and validate draft ownership. |
| `:draftId` (path) | Yes | Draft ID. Identifies the draft to claim and send. |
| (body) | -- | `sendDraftRequestSchema` is `z.object({})` -- empty object, no body fields. |

**All params consumed. No dead params.**

## Implementation Trace

1. **`requireThreadEnvironment(db, id)`** (sync) -- fetches thread + environment.
2. **`ensureThreadIsWritable(thread)`** (sync) -- rejects if archived.
3. **`sendQueuedDraft(deps, { draftId, threadId })`** (async) -- the main flow:
   - **3a. `claimDraftForSend(deps, { draftId, threadId })`** (sync)
     - `getDraft(db, draftId)` -- SELECT by PK.
     - Validates `draft.threadId === threadId` (404 if mismatch).
     - `claimDraft(db, hub, draftId)` -- transactional: SELECT + UPDATE `claimedAt` WHERE `claimedAt IS NULL`. Notifies `["queue-changed"]`.
     - If claim fails (already claimed): re-reads draft, returns 404 if gone or 409 "Draft is already being sent".
   - **3b. `sendClaimedDraft(deps, { draft, threadId })`** (async) -- wrapped in try/catch that releases claim on error:
     - `toQueuedMessage(draft)` -- parses stored content back to `PromptInput[]`.
     - `requireThreadEnvironment(db, threadId)` -- **second fetch of thread + environment** (re-reads to get fresh status).
     - `buildExecutionOptions(deps, queuedMessage, ...)` -- resolves execution from draft's stored model/tier/etc against last event.
     - **Reprovision check:** `queueTurnDuringReprovision({...})` -- if environment needs reprovision:
       - Queues reprovision, appends event, calls `onQueued` callback which **deletes the draft**.
       - Returns the `queuedMessage` immediately.
     - **Ready path:** `requireReadyThreadEnvironment(environment)`.
     - `appendClientTurnEvent(deps, {...})` -- inserts `client/turn/requested` event.
     - **Mode resolution:** `resolveQueuedDraftSendMode(thread.status)`:
       - `"active"` -> steer
       - anything else -> start
       - Note: no explicit "start"/"steer" user control (always "auto").
     - **If start:** `queueReadyThreadTurnCommand` + `tryTransition` to "active" (same as send route).
     - **If steer:** `getLastTurnId` + `queueTurnSteerCommand` (same as send route).
     - **`deleteDraft(db, hub, draft.id)`** -- removes the draft after successful dispatch.
   - **Error handling:** If `sendClaimedDraft` throws, `releaseDraftClaim(db, hub, draft.id)` resets `claimedAt` to null, making the draft available again.

> **-> HTTP 200 returns here** with `{ ok: true, queuedMessage }`. The daemon command is queued for async execution.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT thread by PK | `threads` | PK | First `requireThreadEnvironment` (route level) |
| 2 | SELECT environment by PK | `environments` | PK | First `requireThreadEnvironment` |
| 3 | SELECT draft by PK | `queued_thread_messages` | PK | `getDraft` in `claimDraftForSend` |
| 4 | SELECT + UPDATE draft (txn, RETURNING) | `queued_thread_messages` | PK | `claimDraft` |
| 5 | SELECT thread by PK | `threads` | PK | Second `requireThreadEnvironment` (inside `sendClaimedDraft`) |
| 6 | SELECT environment by PK | `environments` | PK | Second `requireThreadEnvironment` |
| 7 | SELECT latest execution event | `events` | `events_thread_sequence_idx` | `getLastExecutionOptions` |
| 8 | SELECT MAX(seq) + INSERT event (txn) | `events` | `events_thread_sequence_idx` | `appendClientTurnEvent` |
| 9 | SELECT latest providerThreadId | `events` | `events_thread_sequence_idx` | start mode |
| 10 | SELECT project | `projects` | PK | `resolveThreadRuntimeCommandConfig` |
| 11 | SELECT default source | `project_sources` | `project_sources_project_idx` | `getDefaultProjectSource` |
| 12 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | `requireConnectedHostSession` |
| 13 | SELECT MAX(cursor) + INSERT command (txn) | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | `queueCommand` |
| 14 | SELECT + UPDATE thread status | `threads` | PK | `transitionThreadStatus` (start mode) |
| 15 | SELECT + DELETE draft | `queued_thread_messages` | PK | `deleteDraft` |

> **Updated 2026-03-29:** DB functions now use RETURNING — post-write re-reads eliminated.

**Total: 13-15 queries depending on mode. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThreadEnvironment` | send, drafts, stop, archive |
| `ensureThreadIsWritable` | send, drafts |
| `sendQueuedDraft` | Also called from `sendNextQueuedDraftIfPresent` (auto-send after turn completion) |
| `buildExecutionOptions` | send, drafts |
| `queueReadyThreadTurnCommand` | send |
| `queueTurnSteerCommand` | send |
| `tryTransition` | send |

## Flags

1. **Double `requireThreadEnvironment` call.** The route calls it at line 169, then `sendClaimedDraft` calls it again at line 76 of `queued-drafts.ts`. The second call is necessary to get a fresh `thread.status` for mode resolution (thread status could change between claim and send), but the first call's only purpose is the `ensureThreadIsWritable` guard. Consider whether the first call could be replaced with a simpler thread-only fetch.
2. **Claim mechanism is solid.** The `claimDraft` uses a transactional SELECT + UPDATE WHERE claimedAt IS NULL pattern. On failure, the error path calls `releaseDraftClaim`. On success in the reprovision path, the draft is deleted via the `onQueued` callback.
3. **No explicit mode control.** Unlike the `send` route which accepts `mode: "auto" | "start" | "steer"`, the draft send always uses "auto" semantics via `resolveQueuedDraftSendMode`. This means you cannot force-start a turn from a draft if the thread happens to be active.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `sendDraftRequestSchema` / `SendDraftResponse` | `packages/server-contract/src/api-types.ts:105,108` | Contract definitions for request/response |
| Public API type `"/threads/:id/drafts/:draftId/send"` | `packages/server-contract/src/public-api.ts:202` | Typed route definition consumed by API clients |
| `api.sendThreadDraft` | `apps/app/src/lib/api.ts:391` | App-level API wrapper calling `threads[":id"].drafts[":draftId"].send.$post` |
| `useSendThreadDraft` | `apps/app/src/hooks/useApi.ts:832` | React mutation hook wrapping `api.sendThreadDraft` |
| `sendDraft.mutateAsync` | `apps/app/src/views/ThreadDetailView.tsx:243,963` | UI: send a queued draft from thread detail view |
| `sendNextQueuedDraftIfPresent` (internal auto-send) | `apps/server/src/internal/events.ts:110` | Server-internal: auto-sends next queued draft after a turn completes with status "completed" |
| `sendQueuedDraft` (service) | `apps/server/src/services/queued-drafts.ts:149` | Shared service called by route handler and by `sendNextQueuedDraftIfPresent` |
| Server unit tests | `apps/server/test/public-threads.test.ts:883,1117` | Unit tests for draft send (including manager draft send) |
| Server unit tests | `apps/server/test/public-thread-data.test.ts:621,774` | Unit tests for draft send flow and reprovision path |
| Contract tests | `packages/server-contract/test/contract.test.ts:257` | Export verification for `sendDraftResponseSchema` |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
