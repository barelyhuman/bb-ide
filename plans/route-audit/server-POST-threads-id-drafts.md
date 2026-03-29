# `POST /api/v1/threads/:id/drafts` — Create Draft

**Route:** `apps/server/src/routes/threads/actions.ts:146`
**Contract:** `createDraftRequestSchema -> ThreadQueuedMessage` (201)
**Complexity:** Medium

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `input` | Yes | `PromptInput[]` (min 1). JSON-encoded via `encodeDraftContent` and stored in `queued_thread_messages.content`. |
| `model` | No | Resolved via `buildExecutionOptions` (falls back to last execution event, then errors). Stored on the draft row. |
| `serviceTier` | No | Resolved via `buildExecutionOptions`. Defaults to `"flex"`. Stored on the draft row. |
| `reasoningLevel` | No | Resolved via `buildExecutionOptions`. Defaults to `"medium"`. Stored on the draft row. |
| `sandboxMode` | No | Resolved via `buildExecutionOptions`. Defaults to `"danger-full-access"`. Stored on the draft row. |

**All 5 fields consumed. No dead params.**

## Implementation Trace

1. **`requireThreadEnvironment(db, id)`** (sync) -- fetches thread + environment. Throws 404/409.
   - Note: only `thread` is destructured; `environment` is discarded. The lookup still validates the environment exists.
2. **`ensureThreadIsWritable(thread)`** (sync) -- rejects if archived.
3. **`buildExecutionOptions(deps, payload, { threadId }, "client/turn/requested")`** (async)
   - Resolves model/tier/reasoning/sandbox against last stored execution options.
4. **`createDraft(db, hub, {...})`** (sync)
   - Inserts into `queued_thread_messages` with `claimedAt: null`.
   - Re-selects the inserted row.
   - Notifies hub: `notifyThread(threadId, ["queue-changed"])`.
5. **`toQueuedMessage(draft)`** (sync)
   - Parses the stored `content` JSON back into `PromptInput[]` and validates via `threadQueuedMessageSchema.parse`.
   - Returns the `ThreadQueuedMessage` domain object.

> **-> HTTP 201 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT thread by PK | `threads` | PK | `getThread` |
| 2 | SELECT environment by PK | `environments` | PK | `getEnvironment` |
| 3 | SELECT latest execution event | `events` | `events_thread_sequence_idx` | `getLastExecutionOptions` |
| 4 | INSERT draft | `queued_thread_messages` | -- | `createDraft` |
| 5 | SELECT draft by PK | `queued_thread_messages` | PK | re-read after insert |

**Total: 5 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThreadEnvironment` | send, drafts/send, stop, archive |
| `ensureThreadIsWritable` | send, drafts/send |
| `buildExecutionOptions` | send, queued-drafts |
| `encodeDraftContent` | one-off (only used here) |
| `toQueuedMessage` | queued-drafts (sendClaimedDraft) |

## Flags

1. **Environment is fetched but unused.** `requireThreadEnvironment` loads the environment, but only `thread` is destructured. The environment lookup serves as a guard (thread must have an environment), but the environment data itself is discarded. This is a minor redundancy -- if the goal is just "thread must have an environmentId", a simpler check would suffice.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createDraftRequestSchema` / `CreateDraftRequest` | `packages/server-contract/src/api-types.ts:96` | Contract definition for the request body |
| Public API type `"/threads/:id/drafts"` | `packages/server-contract/src/public-api.ts:199` | Typed route definition consumed by API clients |
| `api.createThreadDraft` | `apps/app/src/lib/api.ts:382` | App-level API wrapper calling `threads[":id"].drafts.$post` |
| `useCreateThreadDraft` | `apps/app/src/hooks/useApi.ts:808` | React mutation hook wrapping `api.createThreadDraft` |
| `createDraft.mutateAsync` | `apps/app/src/views/ThreadDetailView.tsx:242,926` | UI: queue a draft message from thread detail view |
| Server unit tests | `apps/server/test/public-thread-data.test.ts:479,550,594` | Unit tests for draft creation |
| Contract tests | `packages/server-contract/test/contract.test.ts:192,251` | Schema parse tests and export verification |
| DB-level tests | `packages/db/test/data/drafts.test.ts` | Direct `createDraft` DB function tests |
| Server test seed helper | `apps/server/test/helpers/seed.ts:131` | Seeds draft rows for other tests |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
