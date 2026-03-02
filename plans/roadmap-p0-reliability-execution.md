# Roadmap P0 Execution: Environment Contracts + Restart Safety

## Goal

Deliver March 2026 P0 reliability items from `plans/ROADMAP.md`: environment adapter contract hardening, worktree reliability coverage, and deterministic daemon restart behavior.

## Scope

- `packages/agent-server`
  - environment adapter contract structure
  - adapter contract tests (`local`, `worktree`)
- `apps/daemon`
  - restart state-policy matrix implementation
  - boot/restart reconciliation behavior and tests
  - safe restart/recovery signaling for app/CLI surfaces as needed
- Supporting test utilities in daemon/server packages

## Implementation Steps

1. **Adapter contract baseline**
   - Define canonical adapter invariants in tests (prepare semantics, env markers, metadata mode/workspaceRoot, cleanup behavior).
   - Add shared contract test runner to execute the same assertions for `local` and `worktree` adapters.

2. **Worktree reliability hardening**
   - Expand worktree adapter tests for fallback and cleanup paths.
   - Add git-backed tmp-dir tests for no-lost-work guarantees across lifecycle operations.

3. **Restart policy matrix (daemon)**
   - Implement explicit restart policy by status (`created`, `provisioning`, `active`, `idle`, `provisioning_failed`).
   - Ensure interrupted sessions move to deterministic, recoverable states.
   - Add targeted tests for each status + archived variants.

4. **Safe restart dev-loop hooks**
   - Add daemon/system metadata exposing restart policy version/state if needed for client UX.
   - Add CLI/app touchpoints for safer restart guidance where appropriate.

## Validation

- `pnpm --filter @beanbag/agent-server test`
- `pnpm --filter @beanbag/daemon test`
- Focused tests:
  - environment contract tests pass for both adapters
  - restart matrix tests pass for all thread states
  - worktree reliability tests pass in tmp-dir isolated repos

## Open Questions/Risks

- How strict should `provisioning_failed` recovery be at boot (auto-retry vs manual retry)?
- Do we need extra persisted markers to distinguish deliberate stop vs daemon crash for active threads?
