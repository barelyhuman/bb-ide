# Phase 6A: Environment Provisioning Parity Plan

## Goal

Deliver predictable, thread-scoped environment provisioning for `local` and `worktree` with clear lifecycle visibility and deterministic cleanup.

## Current Gaps

- Environment is selected globally at daemon boot, not per thread.
- Thread persistence does not own selected environment identity.
- Provisioning fallback metadata is not first-class in API/UI contracts.
- Worktree cleanup errors are only logged, not represented in thread UX.

## Contract Decisions

### Thread Ownership

- Add `environmentId` as a thread-owned field (`closed_internal`).
- Selection occurs at thread spawn and remains stable for the thread lifecycle.
- Tell operations do not override environment in Phase 6.

### API Contracts

- Extend `SpawnThreadRequest` with optional `environmentId`.
- Keep `TellThreadRequest` unchanged for environment in Phase 6.
- Add thread response field `environmentId`.

### Event Contracts

- Add app-defined provisioning events (`closed_internal`) for UI state:
  - `system/provisioning/started`
  - `system/provisioning/fallback`
  - `system/provisioning/completed`
  - `system/provisioning/cleanup_failed`
- Keep provider notifications as `open_external`.

## Data Model and Persistence

- DB migration:
  - add `threads.environment_id` (nullable in migration, required in write path).
- Repository updates:
  - include `environmentId` in create/read/update thread mappings.

## Runtime and Orchestration Work

1. Registry selection:
   - resolve environment adapter from requested `environmentId` per spawn.
   - preserve daemon default when request omits `environmentId`.
2. Provisioning lifecycle:
   - emit structured provisioning events before/after adapter prepare.
   - emit fallback reason event when worktree falls back to local.
3. Cleanup lifecycle:
   - emit `system/provisioning/cleanup_failed` when cleanup fails.
4. Recovery:
   - on boot reconciliation, preserve thread environment ownership.

## UI Work

1. Prompt controls:
   - add environment picker beside model/reasoning/sandbox options.
2. Thread detail:
   - show selected environment and provisioning lifecycle rows.
3. Failure/fallback UX:
   - concise user-facing fallback reason messaging.

## Test Plan

- `agent-server` tests for local/worktree prepare and fallback reason metadata.
- `db` tests for thread `environmentId` persistence.
- daemon route tests for spawn propagation of `environmentId`.
- thread-manager tests for provisioning lifecycle events and cleanup failure events.
- app tests for environment picker defaulting and selection propagation.

## Commit Chunks

1. Core/db contracts and migration (`environmentId` + event type additions).
2. Daemon runtime selection and lifecycle event emission.
3. App picker and provisioning status rendering.
4. Test hardening and regression sweep.

## Exit Criteria

- Thread creation can target `local` or `worktree` per request.
- Thread records persist `environmentId`.
- Provisioning fallback and cleanup failures are visible in thread activity.
