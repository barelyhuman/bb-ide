# Environment-Daemon Session Persistence

This document describes what the server persists for the environment-daemon
session model and what the environment-daemon is allowed to keep only in memory.

Source of truth:

- `packages/db/src/schema.ts`
- `packages/db/src/environment-daemon-repositories.ts`
- `apps/server/src/environment-daemon-session-service.ts`

## Durable server state

The server owns the durable record of:

- session leases and replacement/closure state
- server-applied event cursors
- queued commands and command results
- applied thread events and derived thread state
- last-known control endpoint metadata used for restart nudges

## Agent runtime state

The environment-daemon keeps best-effort in-memory state for:

- the currently bound session
- pending outbound events waiting for ack
- command receipt / result dedupe
- runtime-only worker and provider details

That state is intentionally not crash-durable.

## Operational consequences

- Agent crash can lose unsent or unacked local buffers.
- Server restart should not require any hidden agent-local replay log.
- Reconnect may resend events or command updates that the server has already
  seen, so server-side handling must stay idempotent.
- Heartbeats extend liveness; absence of heartbeat is treated as worker loss.

## Tables to check

When debugging this area, inspect:

- `environment_daemon_sessions`
- `environment_daemon_cursors`
- `environment_daemon_commands`

But treat the schema files and repository code as the authoritative definition
of fields and invariants.
