# Phase 5 Split Map: Folder Rename + Daemon vs Agent-Server

## Purpose

Provide a concrete cut plan to separate runtime bridge concerns from daemon host concerns while aligning folder names with package boundaries.

## Target Topology

- `packages/agent-core` (rename from `packages/core`)
- `packages/agent-server` (new runtime bridge package)
- `apps/daemon` (`@beanbag/daemon`, host app)
- `apps/app` (rename from `apps/web`)
- `apps/cli` (unchanged)
- `packages/db` (unchanged)
- `packages/ui-core` (unchanged)

## Responsibility Boundary

## `@beanbag/agent-server`

- provider adapter interfaces and implementations
- provider runtime process/RPC handling
- environment adapter interfaces and implementations
- model listing/capability surfaces tied to provider runtime

## `@beanbag/daemon`

- HTTP/WS server and route composition
- repositories and persistence orchestration
- thread lifecycle orchestration state machine usage
- websocket fanout, scheduler wiring, and app host boot

## File Move Draft

From current `apps/daemon/src`:

- Move to `packages/agent-server/src`:
  - `provider-adapter.ts`
  - `provider-runtime.ts`
  - `provider-registry.ts`
  - `codex-provider-adapter.ts`
  - `pi-provider-adapter.ts`
  - `claude-provider-adapter.ts`
  - `codex-models.ts`
  - `environment-adapter.ts`
  - `environment-registry.ts`
  - `codex-title-generator.ts` (or keep in daemon if treated as host concern)
- Keep in `apps/daemon/src`:
  - `server.ts`, `index.ts`, `ws.ts`
  - `thread-manager.ts`, `thread-status-machine.ts`, `scheduler-service.ts`
  - `routes/**`, `domain-errors.ts`, `project-file-search.ts`, `folder-picker.ts`

## Dependency Direction (must hold)

- `apps/daemon` -> `@beanbag/agent-server`, `@beanbag/agent-core`, `@beanbag/db`
- `@beanbag/agent-server` -> `@beanbag/agent-core`
- `@beanbag/agent-server` must not import from `apps/daemon`

## Cut Strategy (Commit Chunks)

## Chunk A: Pure folder move and path rewrites

- `packages/core` -> `packages/agent-core`
- `apps/web` -> `apps/app`
- workspace config/script updates (`pnpm-workspace.yaml`, root scripts, Vitest/Turbo/docs)
- no behavior changes

## Chunk B: Create `packages/agent-server`

- scaffold package metadata and build/test config
- move runtime bridge files and tests
- export stable surface for daemon consumption

## Chunk C: Rewire `apps/daemon` as host

- rename package to `@beanbag/daemon`
- replace internal runtime imports with `@beanbag/agent-server`
- keep route/API behavior unchanged

## Chunk D: Contract hardening gates

- add docs from `extensible-ade-contract-hardening.md`
- add/adjust typed decoders and exhaustive handling
- add event pipeline tests and drift checks

## Chunk E: Final cleanup

- remove dead compatibility shims
- normalize naming in docs/comments/scripts
- full validation pass

## Validation Gates Per Chunk

- `pnpm typecheck`
- `pnpm test`
- targeted e2e spawn/tell test run after Chunk C+

## Open Decisions (resolve before implementation)

- Whether `codex-title-generator.ts` belongs in runtime bridge package or daemon host package.
- Whether project file search remains daemon-only or becomes reusable service.
- Whether to introduce `@beanbag/daemon` exports for testing harnesses immediately or later.
