# Daemon Versioning + Client Compatibility Plan

## Goal

Eliminate frontend/daemon drift by adding an explicit compatibility contract, so:

1. The daemon can force stale clients to reload when protocol/API expectations change.
2. The client never runs "ahead" of the daemon.
3. Development has a reliable sync story when web HMR updates faster than daemon code.

## Problem Snapshot (Current State)

- Web dev uses Vite HMR (`apps/web/vite.config.ts`) and updates in-place.
- Daemon dev currently runs once (`apps/daemon/package.json` -> `tsx src/index.ts`) and does not auto-restart on code changes.
- REST currently exposes no compatibility metadata (`apps/daemon/src/routes/system.ts` only returns thread counts/uptime).
- WebSocket protocol only supports `"changed"` messages (`packages/core/src/protocol.ts`).
- Client requests do not send any protocol/build identity (`apps/web/src/lib/api.ts`), so daemon cannot detect client version drift.

Result: in dev, frontend can hot-reload to newer assumptions while daemon still runs old behavior.

## Requirements

### Functional

- Daemon can signal "client behind, reload now" through both HTTP and WebSocket paths.
- Daemon can reject "client ahead" requests and provide a clear recovery action.
- Compatibility checks happen before normal API/WS behavior.

### Developer Experience

- Dev workflow should restart daemon when daemon/core protocol code changes.
- Client should recover automatically when safe (`reload`) and block clearly when unsafe (`daemon restart needed`).

## Non-Goals

- Multi-daemon rolling upgrade orchestration.
- Backward compatibility across many historical versions.
- Service-worker-driven asset versioning (not currently used).

## Versioning Model

Add a shared compatibility contract in `packages/core`:

- `protocolVersion: number`
- `minClientProtocolVersion: number`
- `daemonVersion: string` (package version + optional commit suffix)
- `daemonInstanceId: string` (new UUID per daemon boot)
- `clientBuildId: string` (web build identity; in dev this can be Vite timestamp/hash)

Proposed location:

- `packages/core/src/compatibility.ts`

Proposed exported types:

- `CompatibilityInfo`
- `CompatibilityMismatchCode = "client_behind_daemon" | "client_ahead_of_daemon"`

## Compatibility Rules

Given `clientProtocol` and daemon values:

- `clientProtocol < minClientProtocolVersion`:
  - client is behind
  - action: reload client
- `clientProtocol > protocolVersion`:
  - client is ahead
  - action: restart daemon
- otherwise compatible

This gives a strict "never ahead" guarantee once enforced.

## Transport Design

### HTTP

Client sends on every request:

- `x-beanbag-client-protocol`
- `x-beanbag-client-build` (optional but recommended)

Daemon includes on every response (success and error):

- `x-beanbag-daemon-protocol`
- `x-beanbag-daemon-min-client-protocol`
- `x-beanbag-daemon-version`
- `x-beanbag-daemon-instance-id`

On mismatch, daemon returns structured error payload:

- `code: "client_behind_daemon"` with status `426`
- `code: "client_ahead_of_daemon"` with status `409`
- `details` includes daemon compatibility info + suggested action

Implementation areas:

- `apps/daemon/src/domain-errors.ts` (new error codes/helpers)
- `apps/daemon/src/routes/error-response.ts` (status mapping)
- New compatibility middleware at API root in `apps/daemon/src/routes/index.ts` (or server-level API wrapper)
- `apps/web/src/lib/api.ts` request wrapper (send headers + parse mismatch responses)

### WebSocket

Extend `packages/core/src/protocol.ts` with control-plane messages:

- Client -> daemon:
  - `hello` with `clientProtocol` and `clientBuildId`
- Daemon -> client:
  - `hello_ack` with daemon compatibility info
  - `reload_required` (`client_behind_daemon`)
  - `daemon_restart_required` (`client_ahead_of_daemon`)
  - existing `changed`

Daemon WS behavior:

1. Require `hello` before processing `subscribe`/`unsubscribe`.
2. On mismatch, send control message then close socket.
3. On compatibility success, allow subscriptions and normal events.

Implementation areas:

- `packages/core/src/protocol.ts`
- `apps/daemon/src/ws.ts`
- `apps/web/src/lib/ws.ts`
- `apps/web/src/hooks/useWebSocket.ts`

## Client Behavior (Simple Banner)

Use one global compatibility banner instead of complex state-specific UI surfaces.

Banner behavior:

- `client_behind_daemon`:
  - message: "Client is out of date. Reload to upgrade."
  - actions: `Reload` button (and optional one-time auto reload)
- `client_ahead_of_daemon`:
  - message: "Daemon is out of date. Restart Beanbag daemon."
  - actions: show command hint (`bb daemon stop && bb daemon start`)

Banner properties:

- sticky at top of app shell
- blocking for write actions while mismatch is active
- driven by a single error-code field from HTTP/WS mismatch responses

Suggested UI mounting point:

- top-level in `apps/web/src/App.tsx` or `apps/web/src/components/layout/AppLayout.tsx`

## Current Restart Semantics (Today)

This section documents what happens now (before compatibility work lands):

- Graceful daemon restart:
  - daemon calls `threadManager.stopAll()` on shutdown
  - provider child processes are terminated
  - active thread rows are marked `idle`
  - in-memory runtime maps (`providerThreadIds`, `activeTurnIds`, pending requests) are cleared
- Boot reconciliation:
  - `created` threads are reprovisioned
  - `provisioning` threads become `provisioning_failed`
  - `active` threads may be resumed only when persisted provider thread + lifecycle state support it
- Persisted data:
  - SQLite thread/event history remains
  - only in-memory, in-flight process state is lost

Implication: a turn that was mid-flight at restart may be interrupted; subsequent user actions can resume if provider session metadata was persisted.

## Mid-Flight Turn Protection Plan

To avoid hitting interrupted turns during upgrades/restarts:

1. Add a `restart_pending` mode in daemon when compatibility mismatch is detected.
2. While `restart_pending` is active:
   - reject new write operations (`spawn`, `tell`) with a dedicated error code
   - allow in-flight active turns to finish
3. Trigger daemon restart only when there are no active turns (or after explicit force-restart).
4. On boot, reconcile sessions as today (`thread/resume`) and append an explicit app event for any turn that could not be resumed.
5. In web, keep the single compatibility banner and show a clear state:
   - "Update pending; waiting for active turn to finish"
   - or "Last turn was interrupted by daemon restart; resend prompt"

Important rule: do not auto-replay interrupted `turn/start` requests unless we add an idempotency key handshake; blind replay can duplicate work.

## Daemon Metadata Endpoint

Add a focused endpoint so client can bootstrap compatibility before heavy queries:

- `GET /api/v1/system/compatibility`

Response:

- full `CompatibilityInfo`

This avoids overloading `SystemStatus` and keeps compatibility checks explicit.

Implementation areas:

- `packages/core/src/api-types.ts` (new response type)
- `apps/daemon/src/routes/system.ts`
- `apps/web/src/lib/api.ts`

## Development Workflow Story

### 1. Daemon auto-restart in dev

Update daemon dev script to watch mode:

- `apps/daemon/package.json`
  - from: `tsx src/index.ts`
  - to: `tsx watch src/index.ts` (or equivalent watcher that also tracks shared protocol files)

If direct dependency watching misses shared package edits, add explicit watch roots for:

- `apps/daemon/src/**`
- `packages/core/src/protocol.ts`
- `packages/core/src/api-types.ts`
- `packages/core/src/compatibility.ts`

### 2. Client recovery on daemon restart

- When WS reconnects and daemon instance id changes:
  - if compatibility is still valid, refetch core queries
  - if mismatch appears, follow mismatch actions above

### 3. Dev strictness

In `import.meta.env.DEV`, optionally auto-reload on daemon instance change to reduce stale local state during iterative backend edits.

## Rollout Plan

### Phase 1: Shared contract + HTTP checks

- Add compatibility types/constants in core.
- Add daemon compatibility metadata + HTTP headers.
- Add client request headers and mismatch handling in API wrapper.

### Phase 2: WebSocket handshake + control messages

- Add `hello`/`hello_ack` and mismatch WS control messages.
- Require hello before subscriptions.
- Wire client blocking/reload logic from WS path.

### Phase 3: Dev ergonomics

- Enable daemon watch-restart script.
- Add daemon-instance-aware reload/refetch behavior in web.
- Update README dev notes.

### Phase 4: Enforcement hardening

- Remove any permissive fallback that allows requests without protocol headers.
- Treat all missing/invalid protocol headers as incompatibility.

## Testing Plan

### Daemon

- `apps/daemon/src/__tests__/routes/system.test.ts`
  - includes `/system/compatibility` response shape.
- Add middleware tests:
  - compatible request passes
  - behind client -> `426 client_behind_daemon`
  - ahead client -> `409 client_ahead_of_daemon`
- `apps/daemon/src/__tests__/ws-manager.test.ts`
  - requires hello before subscribe
  - emits mismatch control message and closes on mismatch

### Web

- Add API wrapper tests for mismatch handling in `apps/web/src/lib/api.test.ts`.
- Add WS manager tests for hello flow and control messages (`apps/web/src/lib/ws.test.ts`).
- Add one integration test for blocking UI state in `apps/web/src/App.test.tsx` or layout-level test.

### Manual Dev Verification

1. Run `pnpm dev`.
2. Change web-only code; confirm HMR still works.
3. Change daemon compatibility rule; confirm daemon restarts.
4. Confirm stale client receives reload or restart-daemon guidance.
5. Confirm client cannot continue normal actions when ahead.

## Acceptance Criteria

- Daemon can force client reload when client is behind.
- Client is prevented from running against an older daemon when ahead.
- Dev workflow auto-restarts daemon on backend/protocol edits.
- Mismatch behavior is deterministic and user-visible (no silent partial failures).
- Existing thread/task realtime invalidation still works when compatible.

## Open Decision

Whether to expose compatibility mismatches as dedicated HTTP statuses (`426`/`409`) or unify on `409` with distinct `code` values. Recommendation: keep dedicated statuses for clearer observability and simpler debugging.
