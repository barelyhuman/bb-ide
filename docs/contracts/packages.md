# Package Contracts

This document is the Phase 5 contract catalog for package boundaries.

## Dependency Direction (Allowed)

- `@beanbag/agent-core`: no internal runtime dependencies.
- `@beanbag/ui-core`: no internal runtime dependencies.
- `@beanbag/agent-server` -> `@beanbag/agent-core`.
- `@beanbag/db` -> `@beanbag/agent-core`.
- `@beanbag/daemon` -> `@beanbag/agent-core`, `@beanbag/agent-server`, `@beanbag/db`.
- `@beanbag/app` -> `@beanbag/agent-core`, `@beanbag/ui-core`.
- `@beanbag/cli` -> `@beanbag/agent-core`, `@beanbag/daemon`.

No other cross-package runtime imports are allowed.

## Public API Inventory

### `@beanbag/agent-core`

- Domain types: project, thread, event, protocol, API payloads.
- Runtime contracts: provider/environment/orchestrator/scheduler interfaces.
- Guards/helpers: `assertNever`, `toRecord`, `getStringField`.
- Event normalization helpers:
  - `createProviderEventEnvelope`
  - `decodeProviderEventEnvelope`
  - `unwrapProviderEventPayload`
  - `resolveProviderEventMethod`
  - `normalizeThreadEventType`
  - `extractTurnIdFromPersistedEventData`
  - `extractProviderThreadIdFromPersistedEventData`
- UI projection: `toUIMessages`.

### `@beanbag/agent-server`

- Provider adapter registry and implementations (`codex`, `pi-mono`, `claude-code`).
- Provider runtime (`ProviderRuntime`) and RPC lifecycle errors.
- Environment adapter registry and implementations (`local`, `worktree`).

### `@beanbag/db`

- Database connection and migration entrypoints.
- Repositories: `ProjectRepository`, `ThreadRepository`, `EventRepository`.
- Schema exports for `projects`, `threads`, `events`.

### `@beanbag/daemon`

- HTTP + WS host app composition (`createServer`).
- Thread orchestration implementation (`ThreadManager`).
- Route layer for projects, threads, system APIs.

### `@beanbag/ui-core`

- Reusable ADE primitives for shell/layout, timeline, composer, and context surfaces.

### `@beanbag/app`

- Product composition shell over `agent-core` + `ui-core` contracts.

## Boundary Ownership

- `closed_internal` (Beanbag-owned, exhaustive handling expected):
  - app-defined thread events (`client/thread/start`, `client/turn/start`, `system/error`)
  - thread status unions
  - API error code unions
- `open_external` (provider/runtime-owned, tolerant fallback expected):
  - provider event methods/payloads
  - provider-specific action/status tokens in tool/event payloads
