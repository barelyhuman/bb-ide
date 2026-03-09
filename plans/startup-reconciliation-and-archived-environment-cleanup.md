# Goal

Replace the current daemon boot reconciliation with a minimal startup model aligned with the environment-agent architecture:

- the daemon does not treat its previously persisted runtime status as authoritative;
- boot reconstructs only the state that must exist to serve requests correctly;
- primary-checkout state is derived from current git/workspace reality, not broad daemon-owned recovery state;
- archived-environment cleanup converges to a terminal persisted state instead of retried teardown noise;
- startup does not enumerate all threads unless a narrowly defined product invariant requires it.

# Scope

This plan covers the daemon startup path in [orchestrator.ts](/Users/michael/Projects/bb/apps/daemon/src/orchestrator.ts), environment restoration and cleanup in [environment-service.ts](/Users/michael/Projects/bb/apps/daemon/src/environment-service.ts), persisted environment restore semantics in [worktree-environment.ts](/Users/michael/Projects/bb/packages/environment/src/worktree-environment.ts) and [docker-environment.ts](/Users/michael/Projects/bb/packages/environment/src/docker-environment.ts), and the backing thread/event repository queries in [repositories.ts](/Users/michael/Projects/bb/packages/db/src/repositories.ts).

Audit findings:

- Boot currently performs two startup-wide scans:
  - `reconcileActiveThreadsOnBoot()` loads all threads including archived threads.
  - `rebuildPrimaryPromotionStateFromGit()` loads all projects and all threads, then performs a nested project x thread scan.
- `ThreadRepository.list()` fully materializes thread rows and queued messages for every returned thread, so boot enumeration is not a cheap metadata-only pass.
- Boot has been acting as a daemon-runtime recovery engine:
  - persisted thread `status` is used to decide whether boot should reprovision, fail provisioning, or resume;
  - persisted `active` is treated as a signal to attempt provider-session recovery.
- That model no longer matches the environment-agent architecture:
  - the durable continuity boundary is the environment/environment-agent, not the old daemon process;
  - daemon restart should reconcile against environment-agent and git reality, not stale daemon-owned runtime status.
- Archived threads were always sent through `destroyWorkspace` cleanup on boot, even when their persisted environment pointed at a workspace that was already gone.
- Persisted environment cleanup now clears stale archive state when the workspace is already absent, but the larger startup contract is still too broad and too coupled to persisted daemon runtime fields.

Out of scope:

- one-off database cleanup scripts as the primary fix;
- suppressing logs without changing the underlying state model;
- ad hoc conditional skips that preserve the same stale persisted records.

# Implementation Steps

1. Define the startup contract explicitly around real external state.

- Decide which startup responsibilities are truly daemon responsibilities.
- Recommended target:
  - boot does not recover daemon-owned runtime state from persisted thread statuses;
  - boot does reconstruct primary-checkout state from current git/workspace state;
  - boot does register watches and lightweight in-memory caches needed for WS updates;
  - boot may run targeted archived-environment finalization for rows that still claim to own resources;
  - boot does not generically attempt to resume live work solely because a thread row says `active`.
- Document this contract in code comments, README notes, and tests before removing old behavior.

2. Remove daemon-status-driven thread recovery from boot.

- Delete `_attemptResumeThreadOnBoot()` and remove the `active -> attempt-resume` branch from startup reconciliation.
- Delete or radically narrow `reconcileActiveThreadsOnBoot()` so it no longer treats persisted `created`, `provisioning`, or `active` as restart-recovery instructions.
- Replace the current status-matrix logic with a minimal boot path:
  - initialize daemon services;
  - reconstruct primary-checkout state;
  - register watches;
  - optionally finalize stale archived environments through targeted queries.
- Re-evaluate whether `created` and `provisioning` should even survive process restart as meaningful persisted statuses. Preferred direction: they should not drive any boot-time action.

3. Make archived cleanup converge state, not retry work.

- Introduce an explicit notion of archived environment finalization:
  - if the archived thread still has a persisted environment and the workspace/container exists, dispose it;
  - if the workspace/container is already absent, treat that as success;
  - in both cases, clear the persisted environment record so boot does not revisit the same thread.
- Update `cleanupPersistedEnvironment()` to return a typed result such as `cleaned`, `already_absent`, or `missing_thread/project`, instead of surfacing filesystem absence as an exceptional failure.
- For docker, evaluate inner worktree absence as `already_absent` when the archived target resources are already gone.

4. Narrow persisted state to durable product data, not daemon runtime recovery hints.

- Audit persisted fields and classify them:
  - keep durable product state such as projects, threads, events, queued messages, archive state;
  - keep environment ownership metadata only when it is needed to locate a surviving environment;
  - remove or de-emphasize persisted daemon-runtime state that exists only to drive boot recovery.
- Revisit whether persisted thread `status` should encode in-flight daemon runtime at all, or whether it should become a user-facing summary derived from current thread/environment-agent state.
- Centralize all transitions that clear `environmentRecord` so archive-time cleanup and any later explicit cleanup flows use the same path.

5. Rebuild primary-checkout state from git/workspace reality, not broad startup scans.

- Preferred direction:
  - determine the current project checkout from the project repo on disk;
  - determine whether any thread workspace currently matches that checkout;
  - if a previously remembered primary promotion no longer matches reality, demote it;
  - otherwise rebuild the in-memory primary-promotion map and attach watches.
- Avoid scanning every project against every thread at startup when nothing is promoted.
- Prefer lazy validation on first project/thread access if eager reconstruction is not actually required.

6. Introduce startup-specific repository APIs.

- Add narrow queries such as:
  - archived threads with non-null `environmentRecord`;
  - threads eligible for primary-checkout reconstruction;
  - any project/thread linkage required for targeted watch setup.
- Return minimal row shapes for boot work.
- Keep broad `list()` for UI/read APIs, not daemon startup internals.

7. Rework tests around the new startup contract.

- Delete tests that encode the old restart-policy matrix for `created`/`provisioning`/`active`.
- Add tests for the new contract:
  - boot does not call broad `threadRepo.list({ includeArchived: true })`;
  - boot does not attempt provider-session resume based on persisted `active`;
  - archived thread with missing workspace converges successfully and clears persisted environment state;
  - primary-checkout state is reconstructed from current git/workspace state;
  - startup installs the watchers needed for WS updates without requiring full thread recovery.

8. Migrate existing persisted data safely.

- Add a one-time startup migration or bounded background migration that clears stale archived `environmentRecord` rows whose resources are already absent.
- Decide whether any persisted `active` / `provisioning` rows need normalization as part of rollout, or whether the new boot path can simply ignore them.
- Keep migration separate from steady-state boot so the final architecture does not depend on repeated cleanup retries.
- Make the migration idempotent and instrumented so it can be removed after rollout if desired.

# Validation

- Unit tests for environment cleanup semantics:
  - missing archived worktree returns `already_absent` and clears persisted state;
  - missing archived docker worktree/container returns `already_absent` and clears persisted state;
  - live archived environment disposes successfully and clears persisted state;
  - cleanup failures that actually matter still emit failure events.
- Unit tests for startup query narrowing:
  - boot does not call broad `threadRepo.list({ includeArchived: true })`;
  - boot only fetches archived threads with persisted environments and any narrowly scoped primary-checkout candidates it actually needs.
- Unit tests for startup semantics:
  - persisted `active` does not trigger provider-session resume at boot;
  - persisted `created` / `provisioning` do not drive daemon-runtime recovery;
  - watch setup still occurs for the supported project/thread paths.
- Unit tests for primary-promotion reconstruction:
  - no project x thread full scan at startup in the common case;
  - promotion state is reconstructed from current git/workspace state or lazily validated when first needed.
- Integration test with archived threads whose workspaces were deleted before daemon restart:
  - startup emits no cleanup-failed warning;
  - archived thread ends with `environmentRecord` cleared.
- Integration test proving daemon restart with an in-flight environment-agent-backed thread does not rely on persisted thread `status` for correctness; state should be derived from replayed events / live environment-agent state.
- Integration test with many historical archived threads:
  - startup time and query count do not scale with total thread count except for intentionally targeted subsets.

# Open Questions/Risks

- Product decision required: should thread `status` remain a persisted source of truth, or be reduced to a user-facing snapshot derived from live environment-agent and event state?
- Product decision required: is primary-promotion state fundamentally ephemeral, or should it be persisted as first-class state instead of reconstructed from filesystem scans?
- Data migration risk: clearing archived `environmentRecord` rows changes what older code might have assumed about archive semantics; all consumers of `environmentRecord` need to tolerate `undefined` after archive finalization.
- Operational risk: if startup behavior changes before tests are rewritten around the new contract, regressions will be subtle because current tests encode the existing boot-recovery matrix.
