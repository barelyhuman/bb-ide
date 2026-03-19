# Environment-Daemon Session Protocol

This document explains the current durable contract between the BB server and
the per-environment environment-daemon.

Source of truth: `packages/environment-daemon/src/session-protocol.ts`.

## Why this exists

The session protocol is a real cross-process boundary. It is worth documenting
because it affects restart behavior, liveness, idempotency, and how the server
and environment-daemon recover from partial failure.

## Model

- The server is the durable source of truth.
- The environment-daemon is a best-effort runtime peer for one or more thread
  channels.
- A session is a leased relationship between one agent instance and the server.
- Ordering is per channel, not global.
- Delivery is at-least-once, so both sides must handle duplicates safely.

In v1, `channelId` maps to a BB thread id.

## Core invariants

- Sessions are identified by `sessionId`, but also carry `agentId` and
  `agentInstanceId` so the server can distinguish restarts from reconnects.
- Event progress is tracked with a `(generation, sequence)` cursor per channel.
- The server advances its durable cursor only after it has applied events.
- The agent may lose local buffered state on crash; recovery must not depend on
  hidden agent-local durability.
- Session liveness is lease-based and heartbeat-driven.
- A newer session can replace an older one for the same thread.

## Message families

Client-to-server messages:

- `session_open`
- `heartbeat`
- `event_batch`
- `command_ack`
- `command_result`
- `provider_request`
- `session_close`

Server-to-client messages:

- `session_welcome`
- `event_ack`
- `command_batch`
- `provider_response`
- `session_close`
- `session_replaced`

These message unions are `closed_internal` and should be handled
exhaustively in code.

## Capability negotiation

During `session_open`, the agent may advertise:

- supported protocol versions
- supported command families
- supported optional features
- worker metadata
- provider metadata
- an optional local control endpoint

The server selects a protocol version and may return the accepted capabilities
in `session_welcome`.

## Control endpoint

When the agent exposes a control endpoint, it is only a restart hint and
diagnostic surface. It is not the source of truth for session state.

Today the important endpoints are:

- `POST /control/status`
- `POST /control/session-sync`

## Change policy

When this protocol changes:

1. Update `packages/environment-daemon/src/session-protocol.ts` first.
2. Update the server route validation in `apps/server/src/routes/threads.ts`.
3. Update this doc only after the code-level contract is settled.

If this doc and the code disagree, the code wins.
