# Protocol Boundary Contracts

## Goal

Every protocol boundary has a Zod-first contract package. Validation happens at boundaries, not inside business logic. Internal code works with typed data — no `unknown`, no defensive parsing, no normalization.

## Principles

- **Single source of truth** — each boundary has one contract package with Zod schemas, inferred types, and typed client
- **Validate at the edge** — request AND response validation at protocol boundaries
- **No unknowns internally** — after crossing a boundary, data is typed. No `toRecord()`, `getStringField()`, or fallback key chains inside business logic
- **No type duplication** — types are derived from schemas via `z.infer<>`, not maintained in parallel

## Completed

### Part 1: Create `@bb/env-daemon-contract` ✅

New package `packages/env-daemon-contract/` with:
- Zod schemas for all session messages (moved from `session-protocol.ts`)
- TypeScript types (hand-written interfaces alongside schemas)
- Typed HTTP client (`EnvironmentDaemonSessionClient`)
- Generic `pullCommands<TCommand>()` so callers specify expected command type

`@bb/environment-daemon` re-exports from contract with narrowed generics (defaults to `EnvironmentDaemonEvent`/`EnvironmentDaemonCommand` instead of `Record<string, unknown>`).

### Part 2: Move env-daemon routes to `/internal/*` ✅

- Session mutation routes (open, commands, messages) on `/internal/*` with bearer token auth
- Read-only debug routes (status, sessions) remain on `/api/v1` for CLI access
- Daemon prefers `BB_ENV_DAEMON_SESSION_URL` over `BB_SERVER_URL`
- Session mutation stubs removed from `@bb/api-contract`

### Part 3: Strengthen `@bb/api-contract` ✅

- `shutdownServer`/`restartServer` use typed client responses via `isShutdownBlocked()` type guard — no manual JSON parsing
- `wire-decoders.ts` deleted entirely (both `decodeSystemShutdownBlockedResponse` and `decodeThreadIdFromWireValue`)
- `getProviderThreadIdFromCommandResult()` added to protocol.ts as proper typed accessor

### Part 4: Rename `agent*` → `environmentDaemon*` ✅

- `agentId` → `environmentDaemonId`, `agentInstanceId` → `environmentDaemonInstanceId`
- `agentObservedAt` → `environmentDaemonObservedAt`, `agent_shutdown` → `daemon_shutdown`
- DB migration `0007_rename_agent_to_daemon_columns.sql`
- 33 files updated

### Part 6: Eliminate defensive parsing on typed data ✅

- ~20 `toRecord()`/`getStringField()` slop sites in `orchestrator.ts` replaced with direct typed access
- `provider-event-utils.ts` and `thread-context-window-usage.ts` fixed
- `unknown-helpers.ts` kept for legitimate boundary uses (`extractErrorMessage`, provider-semantics, manager-tools)

### Part 7: Clean up dead types ✅

- `ProviderEventEnvelope`, `ProviderEventEnvelopeMetadata`, constants deleted
- `PersistedThreadEventData` alias removed
- `LEGACY_INFERRED_COMMANDS` deleted

## Remaining

### Part 5: Remove `channelId` abstraction — DEFERRED

**Reason:** The environment channel (`environment:<environmentId>`) is actively used. The session supervisor initializes an environment channel at startup, and the orchestrator uses `getEnvironmentDaemonEnvironmentChannelId()` to route environment-level operations (like listing models) separately from thread operations. This is not a dead abstraction — it's live routing infrastructure.

**Investigation needed:**
- Can environment-level operations (provider.list_models, provider.list_catalog, provider.ensure) route through a thread channel instead?
- What happens if a daemon session opens with `channels: []` and threads attach dynamically?
- Is the environment channel actually carrying events, or just serving as a command routing key?

### Remaining `unknown-helpers.ts` slop

These files still use `toRecord()`/`getStringField()` on typed data:
- `packages/db/src/repositories.ts` — `parseThreadExecutionOptions()` treats `ThreadEventData` as unknown
- `packages/core/src/to-ui-messages.ts` — legitimate boundary (fallback key iteration)

### Route handler `as` casts

`apps/server/src/routes/environment-daemon.ts` has 6 `as` casts on discriminated union payloads (lines 233-270). These exist because Zod-inferred types and hand-written interfaces diverge. Fix requires deriving interfaces from `z.infer<>` — separate effort.

### Client response validation

The contract client (`env-daemon-contract/src/client.ts`) casts `Promise<unknown>` to typed messages without runtime validation. The Zod schemas exist — the client could validate responses with them. Low priority since the server is trusted, but would close the loop on "validate at the edge."

## Validation

- `pnpm exec turbo run typecheck` — all 21 tasks pass
- Session tests (protocol, sync, supervisor) — 24/24 pass
- Core tests — 113/113 pass
