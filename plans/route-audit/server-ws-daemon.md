# `GET /internal/ws` — Daemon WebSocket

**Route:** `apps/server/src/server.ts:88-107`
**Protocol:** `apps/server/src/ws/daemon-protocol.ts`
**Contract:** WebSocket upgrade. Auth via `token` query param.
**Complexity:** Medium

## Connection

| Aspect | Detail |
|---|---|
| Path | `/internal/ws` |
| Auth | `token` query param must equal `deps.config.authToken`. Also requires valid `sessionId` query param pointing to an active, non-expired session. Validated during upgrade (before onOpen). |
| Upgrade | Hono `upgradeWebSocket` via `@hono/node-ws`. Context is captured in `validateDaemonWebSocket` closure before socket opens. |

## Query Params

| Param | Required | Notes |
|---|---|---|
| `token` | Yes | Bearer auth token. Compared to `deps.config.authToken`. |
| `sessionId` | Yes | Must reference an active session (status="active", leaseExpiresAt > now). Resolved to `{ sessionId, hostId }` context. |

## Message Types (Daemon -> Server)

| Type | Fields | Notes |
|---|---|---|
| `heartbeat` | (none) | Daemon sends periodically. Parsed via `hostDaemonDaemonWsMessageSchema`. The message exists only to renew the session lease. |

## Message Types (Server -> Daemon)

| Type | Fields | Notes |
|---|---|---|
| `commands-available` | (none) | Sent when new commands are queued for the daemon's host. Triggers the daemon to poll `GET /session/commands`. |
| `session-close` | `reason` | Sent when the session is being closed. `reason` is one of: `"replaced"` (new session opened), `"expired"` (lease timeout), `"daemon-disconnect"` (cleanup). |

## Implementation Trace

### Upgrade / Validation (sync, before WebSocket opens)

`validateDaemonWebSocket(deps, { sessionId, token })`:
1. If `sessionId` is null or `token` doesn't match: throws `ApiError(401, "unauthorized", "Unauthorized")`.
2. `requireActiveSession(db, sessionId)` — SELECT from `host_daemon_sessions` with active+lease check. Throws `ApiError(401)` if invalid.
3. Returns `{ sessionId, hostId }`.

### onOpen

`onDaemonSocketOpen(deps, { hostId, sessionId, socket })`:
1. `hub.registerDaemon(sessionId, hostId, socket)`:
   - If a different session already exists for this `hostId`, unregisters it first.
   - Stores `{ hostId, socket }` keyed by `sessionId`.
   - Stores `sessionId` keyed by `hostId` (reverse lookup).

### onMessage

`onDaemonSocketMessage(deps, sessionId, raw)`:
1. Decode payload via `decodeSocketPayload`.
2. `JSON.parse` inside a try/catch.
3. Parse via `hostDaemonDaemonWsMessageSchema` (validates `type: "heartbeat"`).
4. If invalid: `socket.close(1008, "invalid-message")`.
5. `requireActiveSession(db, sessionId)` — re-validates session is still active.
6. `heartbeatSession(db, sessionId, Date.now() + session.leaseTimeoutMs)`:
   - UPDATE `host_daemon_sessions` SET `lastHeartbeatAt`, `leaseExpiresAt`, `updatedAt`.

### onClose

`onDaemonSocketClose(deps, sessionId)`:
1. `hub.unregisterDaemon(sessionId)` — removes daemon from both maps.
2. `hub.scheduleDaemonDisconnect(sessionId, 5000, ...)` — starts a 5s grace timer.
3. When the timer expires:
   - SELECT session by PK. If not found or not "active", return.
   - `closeSession(db, hub, sessionId, "daemon-disconnect")`.
   - **Interrupt active threads** — SELECT threads JOIN environments WHERE `environments.hostId = session.hostId` AND `threads.status IN ("active", "provisioning")`.
   - Batch INSERT one `system/error` event per interrupted thread with code `"host_daemon_disconnected"`.
   - Batch UPDATE interrupted threads to `status="error"`.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| **Upgrade** | | | | |
| 1 | SELECT session by PK + status + lease | `host_daemon_sessions` | PK | validateDaemonWebSocket |
| **Per Heartbeat** | | | | |
| 2 | SELECT session by PK + status + lease | `host_daemon_sessions` | PK | requireActiveSession |
| 3 | UPDATE session lease/heartbeat | `host_daemon_sessions` | PK | heartbeatSession |
| **On Close (after 5s grace)** | | | | |
| 4 | SELECT session by PK | `host_daemon_sessions` | PK | Check status |
| 5 | UPDATE session -> closed | `host_daemon_sessions` | PK | closeSession |
| 6 | SELECT active/provisioning threads for host | `threads`, `environments` | `threads_environment_idx` | Interrupt detection |
| 7 | SELECT max event sequence per interrupted thread | `events` | `events_thread_sequence_idx` | Batch event sequencing |
| 8 | Batch INSERT system/error events | `events` | `events_thread_sequence_idx` | One row per interrupted thread |
| 9 | Batch UPDATE thread status -> error | `threads` | PK | One statement for all interrupted threads |

**Heartbeat: 2 queries per heartbeat (every ~5s). Close finalization now happens only after a 5s grace period, and the event insert + status update are batched rather than N individual writes.**

## Code Reuse

- `validateDaemonWebSocket` — local to daemon-protocol.ts.
- `requireActiveSession` — shared guard.
- `heartbeatSession` / `closeSession` — shared DB functions.
- `decodeSocketPayload` — shared with client WebSocket.
- `appendSystemErrorEvent` — shared service function.
- `tryTransition` — shared utility.
- `hub.registerDaemon` / `hub.unregisterDaemon` — hub methods specific to daemon sockets.

## Flags

1. **Session re-validated on every heartbeat**: `requireActiveSession` does a full DB read on each heartbeat message (~every 5s). This is correct for safety but adds query load. Could cache the session in-memory and only re-validate periodically.
2. **No graceful shutdown notification**: When the server itself shuts down, there's no mechanism to send `session-close` to all connected daemons. The daemons will only discover the disconnect via WebSocket close/error.
3. **Disconnect fallout is delayed by design**: The route now waits 5s before closing the session and erroring threads. This improves resilience to brief network blips, but it also means true daemon failures are reflected slightly later.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `ServerConnection.buildWebSocketUrl` | `apps/host-daemon/src/server-connection.ts:287` | Builds `ws://<host>/internal/ws?sessionId=...&token=...` URL for daemon WS |
| `ServerConnection.connectWebSocket` | `apps/host-daemon/src/server-connection.ts:120` | Creates `ReconnectingWebSocket` to `/internal/ws` after session open |
| `ServerConnection.handleWebSocketMessage` | `apps/host-daemon/src/server-connection.ts:210` | Handles `commands-available` and `session-close` messages from the server |
| `ServerConnection.resetHeartbeat` | `apps/host-daemon/src/server-connection.ts:234` | Sends periodic `heartbeat` messages over the daemon WS |
| `createDaemonApp` | `apps/host-daemon/src/app.ts:178` | Wires `ServerConnection` with callbacks, establishing WS on daemon start |
| Server route registration | `apps/server/src/server.ts:89` | Registers the `/internal/ws` upgrade handler via `upgradeWebSocket` |
| Server auth middleware | `apps/server/src/server.ts:52` | Checks `context.req.path === "/internal/ws"` to skip JSON auth for WS upgrade |
| Test: fake test-server | `apps/host-daemon/test/helpers/test-server.ts:222` | Fake WS upgrade handler at `/internal/ws` for host-daemon unit tests |
| Test: heartbeat lease renewal | `apps/server/test/internal-session-correctness.test.ts:266` | Connects raw WS to `/internal/ws` and tests heartbeat-based lease extension |
| Test: session close on disconnect | `apps/server/test/internal-session-correctness.test.ts:314` | Tests that closing the daemon WS transitions threads to error |
| Test: thread interruption on close | `apps/server/test/internal-session-correctness.test.ts:364` | Tests that active threads are interrupted when daemon WS closes |
| Test: session replacement via WS | `apps/server/test/integration.test.ts:573` | Tests that opening a new session sends `session-close` to old daemon WS |

---

## Review Comments

<!-- Flag 1 is now query-load/operational. Flag 3 is an intentional product tradeoff: better reconnect tolerance in exchange for a slightly slower failure signal. -->
