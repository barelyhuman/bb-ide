# Plan: `GET /api/v1/threads/:id/events/wait` — Long-poll event wait endpoint

## Motivation

`bb thread wait --event <type>` currently polls `GET /threads/:id/events` in a loop, scanning history each time. This is wasteful, scales poorly with event count, and introduces false timeouts on threads with large histories.

## Endpoint Design

```
GET /api/v1/threads/:id/events/wait?type=turn/completed&afterSeq=123&waitMs=30000
```

### Query Params

| Param | Required | Notes |
|---|---|---|
| `type` | yes | Event type to wait for (e.g. `turn/completed`, `item/completed`) |
| `afterSeq` | no | Only match events after this sequence. Omit to scan from the beginning. |
| `waitMs` | no | How long to hold the connection (default: 30000, max: 60000) |

### Response

- **200** — matching event found, returns `{ event: ThreadEventRow }`
- **204** — timeout, no matching event found
- **404** — thread not found

### Server Implementation

1. `requireThread(db, threadId)` — 404 if missing
2. Query events: `SELECT * FROM events WHERE threadId = ? AND type = ? [AND sequence > afterSeq] ORDER BY sequence LIMIT 1`
3. If found → return 200 with the event
4. If not → subscribe to thread notifications via `hub.waitForThreadEvent(threadId, waitMs)`
5. On wake (new events appended) → re-query
6. On timeout → return 204

### Hub Changes

Add `waitForThreadEvent(threadId, waitMs)` to `NotificationHub`, similar to existing `waitForCommands(hostId, waitMs)`:
- Creates a promise-based waiter keyed by threadId
- `notifyThread` resolves all waiters for that thread
- Timeout auto-resolves with `false`

### CLI Changes

Replace the `--event` polling loop in `bb thread wait` with:
1. First call: `GET /threads/:id/events/wait?type=X&waitMs=30000`
2. If 200 → done, print result
3. If 204 → check deadline, retry with same params
4. No `afterSeq` management needed on the CLI side (server handles it)

Actually, `afterSeq` is still useful: after a 204 timeout, the CLI can pass the latest `afterSeq` from the server response headers (or just omit it and let the server re-scan — the query is indexed and fast).

### Contract

Add to `PublicApiSchema`:
```typescript
"/threads/:id/events/wait": {
  $get: Endpoint<{ query: ThreadEventWaitQuery }, ThreadEventRow | null>;
};
```

### Exit Criteria

- `bb thread wait --event turn/completed` uses the new endpoint (no polling loop for events)
- `bb thread wait --status idle` unchanged (still polls thread detail)
- Server holds connection up to `waitMs` and returns immediately on match
- Integration tests pass
