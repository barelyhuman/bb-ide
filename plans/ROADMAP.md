# ROADMAP

> Updated March 2, 2026 to focus on reliability, rendering/data unification, title ownership clarity, and smoother daemon iteration.

## Goal

Reduce user-risk and developer friction by making thread execution safer, message/data flows singular, thread titling deterministic, and local daemon development resilient.

## Scope

- `apps/daemon` (thread lifecycle, environment orchestration, restart policy, titling behavior)
- `apps/app` (canonical message rendering, timeline/event consumption, reconnect/restart UX)
- `apps/cli` (safe daemon restart entrypoints and diagnostics)
- `packages/agent-core`, `packages/agent-server`, `packages/db`, `packages/ui-core` (projection rules, typed contracts, dedupe, tests)

## Implementation Steps

1. **Environment architecture + tests (Now / P0, target: March 2026)**
   - Define and adopt one adapter contract for all environments (`local`, `worktree`) with explicit semantics for prepare/session/env/cleanup.
   - Move daemon orchestration callsites onto adapter-level primitives so no environment-specific branching remains in core execution paths.
   - Add contract test fixtures that run against every adapter implementation.
   - Expand git-backed integration coverage for “no lost work” across archive/stop/reconcile/error/restart paths.
   - Standardize git tests on tmp-folder isolated repos/worktrees per test run.
   - **Exit criteria:** contract suite passes for both adapters; integration tests prove no workspace loss under failure/restart.

2. **Daemon restart safety + seamless dev loop (Now / P0, target: March 2026)**
   - Define a restart-state matrix per thread status (`created`, `provisioning`, `active`, `idle`, `failed`) and codify it in daemon services.
   - Ensure in-flight work is either resumed deterministically or transitioned to explicit recoverable states.
   - Provide a safe restart entrypoint in CLI/dev workflow (with operator-visible preconditions and outcomes).
   - Add app UX for disconnect/reconnect/restart with clear user messaging and a one-click recovery path where possible.
   - **Exit criteria:** restart behavior is deterministic in tests and repeatable during local daemon restarts.

3. **Unify data/rendering flows + remove legacy compatibility (Next / P1, target: April 2026)**
   - Keep one canonical UI message path (`ConversationEntry` + `ConversationWorkingIndicator`) and remove parallel/legacy rendering surfaces.
   - Consolidate thread state derivation onto a single projection path (avoid mixed timeline/raw event authority).
   - Remove runtime compatibility handling for legacy `codex/event/*` paths and standardize on `thread/*`, `turn/*`, and `item/*`.
   - Complete migration of token/context accounting to v2 usage events and delete legacy token-count dependencies.
   - **Exit criteria:** no duplicate/contradictory message rows across refresh/reconnect; no runtime dependence on `codex/event/*`.

4. **Remove daemon-orchestrated thread titling (Next / P1, target: April 2026)**
   - Remove daemon-side title generation/fallback orchestration.
   - Keep title authority provider-driven plus explicit user rename behavior.
   - Document and enforce title precedence rules (provider update vs. manual override) with lock semantics.
   - Add tests for jarring re-title regressions and manual-override persistence across reconnect/restart.
   - **Exit criteria:** title transitions are deterministic and explainable via tests/logs.

## Validation

- Reliability and safety:
  - Environment contract tests pass for all adapters.
  - Git-backed integration tests show no workspace loss across failure/restart/archive scenarios.
- Dev experience:
  - Daemon code changes can be tested through a safe, documented restart flow without fragile manual steps.
  - App reconnect/restart UX is explicit and recoverable.
- Data/rendering:
  - Thread state remains consistent across refreshes/reconnects without duplicate or conflicting message rows.
  - Legacy `codex/event/*` runtime compatibility paths are removed without regressions.
- Titling:
  - Title updates and manual overrides follow one deterministic precedence model under automated tests.
- Standard checks:
  - `pnpm typecheck`
  - `pnpm test`
  - Local daemon + app smoke tests covering spawn/tell/stop/archive/restart.

## Open Questions/Risks

- What restart behavior should apply to threads interrupted during tool execution or pending workspace writes?
- How should historical persisted legacy events be handled once runtime legacy compatibility is removed?
- Do we need a one-time migration/backfill for title metadata to preserve manual overrides across older threads?
