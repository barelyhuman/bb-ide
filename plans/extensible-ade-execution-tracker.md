# Extensible ADE Execution Tracker

## Status Legend

- `[ ]` not started
- `[~]` in progress
- `[x]` complete

## Global Progress

- `[x]` Planning decisions locked
- `[ ]` Phase 1 complete
- `[ ]` Phase 2 complete
- `[ ]` Phase 3 complete
- `[ ]` Phase 4 complete
- `[ ]` Phase 5 complete
- `[ ]` Phase 6 complete

## Locked Decisions (Do Not Reopen Without Explicit Product Decision)

- `[x]` Drop task model data migration (no backfill/export requirement).
- `[x]` Local trusted code only.
- `[x]` Rename package names now.
- `[x]` Boundary-first architecture before first-class extension runtime.

## Phase 1: Task Removal + Rename

- `[ ]` Remove task domain types/schemas/protocol entities.
- `[ ]` Remove task DB schema/repositories/routes.
- `[ ]` Remove task CLI commands and `BB_TASK_ID`.
- `[ ]` Remove task web routes/views/components/hooks.
- `[ ]` Remove websocket `task` entity semantics.
- `[ ]` Rename packages to `agent-core`, `agent-server`, `ui-core`, `app`.
- `[ ]` Update tests/docs/scripts.
- `[ ]` Run `pnpm typecheck`.
- `[ ]` Run `pnpm test`.

## Phase 2: Boundary Extraction

- `[ ]` Define and apply provider adapter contracts.
- `[ ]` Define and apply environment adapter contracts.
- `[ ]` Define and apply thread orchestrator contracts.
- `[ ]` Define scheduler service interfaces.
- `[ ]` Keep composition static in app layer.

## Phase 3: UI Core Hardening

- `[ ]` Extract conversation primitives to `ui-core`.
- `[ ]` Extract prompt composer primitives to `ui-core`.
- `[ ]` Introduce stable 3-pane layout slots.
- `[ ]` Add right-panel artifact/diff/markdown primitives.

## Phase 4: Multi-Adapter Validation

- `[ ]` Ship codex adapter under new interface.
- `[ ]` Ship at least one additional provider adapter.
- `[ ]` Ship local environment adapter.
- `[ ]` Ship at least one additional environment adapter.
- `[ ]` Validate capability-driven fallback behavior.

## Phase 5: Scheduler/Automations

- `[ ]` Add schedule persistence model.
- `[ ]` Add scheduler execution engine.
- `[ ]` Add run history/status model.
- `[ ]` Add app UI for schedules and runs.

## Phase 6: First-Class Extension Runtime (Optional)

- `[ ]` Define local trusted extension manifest.
- `[ ]` Define extension API versioning.
- `[ ]` Add registration/loading for provider/environment/ui/action extensions.
- `[ ]` Document extension lifecycle and compatibility rules.

## Current Focus

- Next focus: Phase 1 implementation.
