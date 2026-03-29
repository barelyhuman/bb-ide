# `GET /api/v1/threads/:id/timeline/tool-details` — Lazy-load Tool Call Details for a Turn

**Route:** `apps/server/src/routes/threads/data.ts:59`
**Contract:** `PathId & { query: TimelineToolDetailsQuery } -> TimelineToolDetailsResponse` (200)
**Complexity:** Medium

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Looked up via `requireThread` which throws 404 if missing. |
| `turnId` | Yes | String. **Accepted but never used.** The query schema requires it, but the route handler and `buildTimelineToolDetails` never reference it. |
| `sourceSeqStart` | Yes | String integer. Parsed via `parseOptionalInteger`, defaults to `0` via `?? 0` if `undefined`. Defines the start of the event sequence range to fetch. |
| `sourceSeqEnd` | Yes | String integer. Parsed via `parseOptionalInteger`, defaults to `0` via `?? 0` if `undefined`. Defines the end of the event sequence range to fetch. |
| `includeManagerDebugView` | No | `"true"/"false"`. When `"true"`, includes debug raw events and internal system messages. |

**DEAD PARAM: `turnId` is required in the schema but never consumed by the handler or service.**

## Implementation Trace

1. **Sync** `requireThread(db, id)` -- looks up thread by PK. Throws 404 if not found.
2. **Sync** `buildTimelineToolDetails(db, thread, options)` (`services/timeline.ts:46`):
   - Calls `listThreadEventRowsInRange(db, { threadId, seqStart, seqEnd })`:
     - Queries `events` table: `WHERE threadId = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence`.
     - Maps each row through `decodeEventRow`.
   - Calls `decodeRow(row)` from `@bb/core-ui` on each event row.
   - Calls `toViewMessages(decodedRows, options)` from `@bb/core-ui` -- same transform as the timeline route.
3. Returns `{ messages }`.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM threads WHERE id = ?` | threads | PK | `requireThread` |
| 2 | `SELECT * FROM events WHERE threadId = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence` | events | `events_thread_sequence_idx(threadId, sequence)` | Range scan on the composite unique index. |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared with |
|---|---|
| `requireThread` | Most thread routes |
| `listThreadEventRowsInRange` | Only used here |
| `decodeEventRow`, `decodeRow`, `toViewMessages` | Shared with timeline route |
| `parseOptionalInteger` | Multiple routes |

## Flags

1. **`turnId` is a dead param.** It is required in `timelineToolDetailsQuerySchema` but never used in the route handler or in `buildTimelineToolDetails`. The filtering is done entirely by `sourceSeqStart`/`sourceSeqEnd`. Per AGENTS.md: "Accepted-but-ignored route or command fields are forbidden. Delete them or implement them end to end in the same change." This should be removed from the schema.
2. **`sourceSeqStart`/`sourceSeqEnd` default to 0 via `?? 0`** -- if `parseOptionalInteger` returns `undefined` (which it cannot since the schema makes them required), the fallback produces a range query `sequence >= 0 AND sequence <= 0` which returns nothing. Harmless but the `?? 0` is misleading since the schema already enforces presence.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `getThreadTimelineToolDetails` (API client) | `apps/app/src/lib/api.ts:496` | Fetches tool detail messages for a specific turn sequence range |
| `useThreadTimelineToolDetails` (React mutation hook) | `apps/app/src/hooks/useApi.ts:642` | Wraps `getThreadTimelineToolDetails` in a `useMutation` for on-demand loading |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:240` | Calls `useThreadTimelineToolDetails` to lazy-load tool group details when expanded |
| `useThreadTimelineController` | `apps/app/src/views/useThreadTimelineController.ts:119` | Consumes the mutation to trigger tool-detail loads on tool group row expansion |
| Server route test | `apps/server/test/public-thread-data.test.ts:67,95` | Direct HTTP requests to `/api/v1/threads/:id/timeline/tool-details` (happy path and bad input) |
| Contract route definition | `packages/server-contract/src/public-api.ts:237` | Typed route definition for `/threads/:id/timeline/tool-details` |
| Contract URL test | `packages/server-contract/test/contract.test.ts:231` | Verifies URL generation for the tool-details route |

---

## Review Comments

<!-- Flag #1 is a policy violation per AGENTS.md. turnId should be deleted from the query schema. -->
