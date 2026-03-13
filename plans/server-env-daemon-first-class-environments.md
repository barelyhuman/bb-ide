# Goal

Refactor the current thread-owned environment model into a first-class environment architecture with:

- `server` as the single global backend control plane
- `env-factory` as the server-owned provisioning/import/reuse component
- `env-daemon` as the per-environment runtime/process owner
- threads/agents as clients that attach to environments rather than owning them

This should enable multiple threads to reuse the same environment and the same `env-daemon`.

Current mainline baseline to build on:

- Threads now carry explicit provider identity, so provider routing is already thread-scoped rather than globally singleton.
- The current environment-agent session protocol already includes provider request/response transport primitives.
- The migration should build on those newer seams rather than introducing a second parallel routing model.

Current modeling decisions:

- Start with a minimal environment descriptor:
  - `type EnvironmentDescriptor = { type: "path"; path: string }`
- For now, reusable docker/container environments should be referenced by `environmentId` rather than a richer reusable descriptor.
- Environment lifecycle ownership should start simple:
  - `managed: boolean`
- The target thread linkage model is `thread.environmentId`, not `thread.environmentRecord`.
- Do not introduce a generalized environment `facts`, `traits`, or `capabilities` schema in this phase.
- Prefer environment-instance methods over persisted metadata for deriving:
  - whether this is the primary workspace
  - whether this is a worktree checkout
  - whether this is container-backed
- UI/presentation should adapt to the new environment model rather than preserving current environment-id-driven behavior by default.

# Scope

In scope:

- Rename and reframe the current `daemon` and `environment-agent` boundaries into `server` and `env-daemon`.
- Introduce an explicit `env-factory` module/package so environment creation/import/reuse logic is not embedded in the orchestrator.
- Introduce first-class persisted environment records independent from threads.
- Re-key runtime/session/process ownership from `threadId` to `environmentId`.
- Allow multiple threads to attach to one environment.
- Route thread-scoped requests from `server` to the correct `env-daemon`.
- Update cleanup, lifecycle, reconnect, and recovery flows to operate on environments rather than thread-owned workspaces.
- Update tests and QA coverage for shared environment attachment and recovery.

Out of scope for this phase:

- Strong concurrency controls inside a shared environment.
- Preventing or resolving same-environment conflicts in the backend.
- Full UX redesign for environment reuse workflows.
- Changing generated code under `packages/core/src/generated/**`.

V1 concurrency assumption:

- Multiple concurrent threads may run against the same environment.
- Backend coordination will be minimal.
- Agents are expected to observe and handle shared-workspace conflicts gracefully.
- The backend should preserve correct routing, persistence, and recovery, but should not attempt to serialize or reconcile concurrent workspace mutations in v1.

# Implementation Steps

1. Define the new domain model.

- Add a first-class `Environment` entity to agent-core types with explicit lifecycle and attachment semantics.
- Start with a minimal descriptor model:
  - `EnvironmentDescriptor = { type: "path"; path: string }`
- Decide and document the core relationships:
  - one project has many environments
  - one thread attaches to one environment at a time
  - one environment may have many attached threads
- Keep thread-local concepts separate from environment-local concepts.
  - Thread-local: timeline, provider id, provider thread id, turn state, queued messages, review flows, read state
  - Environment-local: descriptor/path, serialized runtime state, status watchers, env-daemon session/process, cleanup lifecycle
- Treat thread provider selection as thread-local state, not environment-local state.
- Start environment lifecycle ownership with a simple field:
  - `managed: boolean`
- Make `thread.environmentId` the target association model.
- Explicitly avoid any generalized environment `facts` schema in this phase.
- Put environment-derived behavior on the environment instance where possible rather than in persisted metadata or external classifier layers.
- Define closed internal unions for environment lifecycle/status and handle them exhaustively with `assertNever`.

2. Introduce persistent environment storage.

- Add new database tables for first-class environments, likely including:
  - `environments`
  - `thread_environment_attachments` or a direct `threads.environment_id` foreign key if attachment history is not needed
- Move persisted environment state out of `threads.environmentRecord` into the environment record.
- Store a minimal descriptor and `managed` flag on the environment record first.
- Add lifecycle/status fields needed for environment provisioning, reuse, cleanup eligibility, and recovery.
- Preserve a migration path from existing thread-owned environment records into environment-owned state.
- Plan whether attachment history is needed now or can remain implicit in thread updates plus events.

3. Migrate thread persistence and API models.

- Update thread repository reads/writes so threads reference environments via `thread.environmentId` rather than embedding environment ownership.
- Decide whether to keep legacy `thread.environmentRecord` temporarily as a compatibility field during migration, with the end state being removal.
- Update API response shaping so thread details can include attached environment metadata without implying thread ownership.
- Add environment read/list endpoints or environment sections to existing server APIs where needed.

4. Split control-plane and data-plane responsibilities.

- Reframe the current top-level daemon orchestration as `server` responsibility:
  - projects
  - threads
  - environments
  - environment lifecycle policy
  - routing
  - persistence
  - scheduling
  - policy
  - websocket/event fanout
- Introduce `env-factory` as a server-owned provisioning component responsible for:
  - create environment records
  - reuse existing environments
  - import/adopt existing path-backed workspace roots when supported
  - restore migrated legacy thread-owned environments
  - choose provisioning inputs and return launch/reconnect descriptors
- Reframe the current environment-agent runtime as `env-daemon` responsibility:
  - one runtime per environment
  - workspace/process ownership
  - workspace status/diff/command execution
  - environment lifecycle hooks
  - local reconnect state
- Ensure `env-daemon` is not the source of truth for thread state.
- Keep the orchestrator focused on thread execution routing rather than environment provisioning details.

5. Re-key runtime management from thread to environment.

- Refactor `EnvironmentService` and related caches from `Map<threadId, ...>` to `Map<environmentId, ...>`.
- Refactor provisioning/restore/suspend/destroy flows to operate on environments directly.
- Replace thread-derived worktree paths/branch naming with environment-derived identifiers.
- Update managed artifact cleanup so workspaces and logs are retained/destroyed based on environment lifecycle and attachment/reference state, not thread archival alone.
- Ensure archiving or deleting one thread does not destroy a shared environment still referenced by other threads.

6. Refactor env-daemon identity and process management.

- Rename current environment-agent concepts to env-daemon concepts in code and APIs where appropriate.
- Change managed env-daemon identity keys from thread-scoped to environment-scoped.
- Stop treating `BB_THREAD_ID` as the fixed identity of the env-daemon process.
- Introduce environment-scoped identity/env vars such as `BB_ENVIRONMENT_ID`; keep thread id request-scoped.
- Update reconnect/adoption logic so the server can reconnect multiple threads to a single existing env-daemon.

7. Redesign the session protocol around environment ownership.

- Refactor session persistence and in-memory state from thread-owned sessions to environment-owned sessions.
- Allow one env-daemon session to carry multiple logical thread channels.
- Update session open, heartbeat, event batch, command pull, command ack, and command result flows to support multi-thread routing over one environment session.
- Reuse the existing provider request/response session primitives as part of the environment-owned session design instead of inventing a separate forwarding path.
- Preserve clear distinction between:
  - environment/session identity
  - thread/channel identity
  - provider-thread identity
- Update cursor tracking and command delivery state so correctness is maintained per logical thread channel where necessary.

8. Separate environment-scoped operations from thread-scoped operations.

- Environment-scoped operations should include:
  - workspace status
  - workspace diff
  - shell/process execution
  - setup hooks
  - filesystem-backed lifecycle actions
  - environment health/session status
- Thread-scoped operations should include:
  - start/resume/fork thread
  - start turn
  - interrupt turn
  - thread timeline/events
  - queued follow-ups
  - provider-thread mapping
- Route thread-scoped work through the attached environment without conflating the two identities.

9. Preserve provider-session semantics while decoupling from environment ownership.

- Keep provider thread ids mapped per Beanbag thread, not per environment.
- Preserve the newer per-thread provider routing model already on main; environment attachment must not collapse provider identity back to a global singleton.
- Ensure the server can start/resume multiple provider threads against the same attached environment.
- Review any provider config/env policy that currently injects thread identity into process-wide environment settings and make it request-scoped where possible.
- Maintain compatibility for existing provider adapters while introducing the new environment attachment model.

10. Define v1 same-environment concurrency behavior explicitly.

- Backend behavior in v1 should focus on correct delivery and isolation of thread state, not conflict prevention.
- The server should allow multiple active threads to target the same environment.
- The env-daemon should execute requests as received without trying to serialize same-environment file mutations globally.
- Any future backend scheduling/locking should be additive and not required for the first migration.
- Document expected caveats:
  - thread outputs may reflect concurrent workspace changes by other agents
  - commit/diff/work-status results are environment-shared, not thread-exclusive
  - follow-up actions may observe state changed by another thread

11. Migrate worktree and other environment implementations.

- Update `worktree` to create environment-owned workspace paths and branch names.
- Ensure shared environment reuse no longer implies one branch per thread unless intentionally modeled that way.
- Review whether `docker` and `local` environments should also become first-class attachable environments under the same model.
- Keep the existing isolated-per-thread workflow available, but represent it as a policy choice that creates a dedicated environment per thread.
- Support explicit import/adopt flows for existing path-backed checkouts through `env-factory` rather than direct ad hoc environment instantiation from arbitrary paths in the orchestrator.
- Defer generalized reusable docker descriptors for now; docker environment reuse can remain `environmentId`-based initially.
- Treat environment setup as factory-owned provisioning behavior, not a property of the environment record or runtime interface.
- Add any needed runtime classification APIs as methods on the environment instance, not as persisted fields.

12. Update routes, websocket events, and UI-facing contracts.

- Add environment-aware server routes and response fields.
- Update thread detail responses so attached environment metadata is easy to inspect.
- Add environment session/status visibility for debugging.
- Preserve backwards compatibility where possible, or stage compatibility shims and remove them after migration.

13. Backfill tests and QA coverage.

- Add repository tests for environment persistence and attachment updates.
- Add server/unit tests for:
  - environment provisioning and reuse
  - multiple threads attached to one environment
  - archiving one attached thread without destroying the environment
  - env-daemon reconnect/restart with multiple attached threads
  - session/event/command routing across multiple thread channels
- Add targeted e2e scenarios for:
  - spawn thread with dedicated environment
  - attach second thread to existing environment
  - run concurrent turns in same environment
  - restart server and recover attachments/env-daemon session
  - archive/delete threads while preserving shared environment until unused
- Run relevant daemon/server QA tiers from `qa/` before rollout.

14. Stage the rollout to reduce risk.

- Phase 1: introduce environment records and attachments while preserving current single-thread ownership behavior.
- Phase 2: re-key runtime and env-daemon session ownership to environments.
- Phase 3: enable multiple threads to attach to the same environment behind a flag or explicit API path.
- Phase 4: remove legacy thread-owned environment assumptions and dead code.

# Validation

- Schema migrations succeed on an existing database with thread-owned environment records.
- Existing single-thread-per-environment behavior continues to work during the migration phase.
- A newly created environment can be attached to multiple threads and reused across restarts.
- One thread can be archived or deleted without destroying an environment still attached elsewhere.
- The server correctly restores environment state and env-daemon connectivity after restart.
- Thread timelines, provider thread ids, and queued messages remain isolated per thread.
- Environment status, workspace diff, and command execution correctly reflect shared environment state.
- Existing worktree, local, and docker flows continue to pass typecheck and targeted tests.
- Daemon/server QA passes for affected behavior, including restart/recovery scenarios.
- UI and agent instruction behavior are validated against the new derived rules rather than legacy environment-id-specific assumptions.
- Primary-workspace / linked-worktree / container-backed behavior is validated through environment-instance methods rather than separate persisted metadata.

# Open Questions/Risks

- Do we want attachment history as a first-class persisted concept, or is current attachment enough for v1?
- Should `threads.environment_id` remain denormalized alongside a richer attachment table for convenience?
- How much backwards compatibility do we need in HTTP/WebSocket/API contracts during migration?
- Do we want environment-level event streams in addition to thread timelines?
- Should worktree environments shared by multiple threads use one branch, or should “shared environment” and “shared branch” remain separate concepts?
- Commit attribution may be confusing in a shared environment because git state is environment-scoped, not thread-scoped.
- Existing tests and recovery code assume thread-owned sessions/workspaces; migration will touch a wide surface area.
- Deferring same-environment concurrency handling to agents in v1 reduces backend complexity, but it means some thread-level UX will necessarily reflect shared mutable state and may be surprising.
- We still need to define the exact environment-instance API for deriving:
  - primary workspace
  - linked worktree checkout
  - container-backed runtime

# Milestones

## Milestone 1: Introduce first-class environment persistence without behavior changes

Goal:

- Create the new persistence model while preserving the current effective behavior of one thread owning one environment.

Scope:

- Add `environments` table and thread attachment mechanism.
- Add agent-core environment types.
- Build on the new `thread.providerId` persistence shape already present on main.
- Start with path descriptors only.
- Start with `managed: boolean`.
- Keep current runtime/session/process ownership thread-scoped for now.

Deliverables:

- DB migration(s) for environment records and thread attachment/reference.
- Repository support for create/read/update/list environments and thread attachment.
- Thread API model updated to expose attached environment metadata.
- Compatibility path that backfills environment records from existing `thread.environmentRecord`.
- No generalized environment-facts schema required in this milestone.
- Target thread association shape defined as `thread.environmentId`.

Verification:

- Repository tests for create/read/update attachments.
- Typecheck for affected packages.
- Existing thread provisioning flows remain green.

## Milestone 2: Add environment service abstractions alongside thread-owned runtime paths

Goal:

- Introduce environment-centric service APIs before cutting over the main runtime path.

Scope:

- Add environment-oriented lookup, restore, and lifecycle interfaces in the server.
- Introduce `env-factory` interfaces for create/reuse/import/adopt decisions.
- Introduce `environmentId`-keyed runtime maps in parallel with existing thread-keyed maps where needed.
- Add environment-focused routes/debug surfaces.

Deliverables:

- `EnvironmentService` surface that can operate on explicit environment records.
- `env-factory` surface that can:
  - create a new environment
  - reuse an existing environment
  - adopt an existing supported workspace path into a managed environment record
- Read/list routes for environments or equivalent server accessors.
- Internal helper methods to resolve thread -> environment -> runtime.
- Environment-instance API additions for deriving:
  - whether an environment is the primary workspace
  - whether an environment is a linked worktree checkout
  - whether an environment is container-backed
  - how UI/agent instructions should adapt to those derived states

Verification:

- Unit tests for environment resolution and attachment lookup.
- No change in existing thread execution behavior.

## Milestone 3: Rename boundary concepts in code from daemon/environment-agent to server/env-daemon

Goal:

- Make the architecture legible in code before deeper protocol changes.

Scope:

- Rename concepts, comments, and non-generated symbols where practical.
- Preserve compatibility shims where broad renames would be too disruptive in one pass.

Deliverables:

- Updated internal naming for top-level orchestration and per-environment runtime process.
- Migration notes for remaining legacy naming that will be removed later.

Verification:

- Typecheck and targeted tests for renamed modules.
- No behavior change intended.

## Milestone 4: Re-key managed environment runtime ownership from threadId to environmentId

Goal:

- Make workspace/process ownership truly environment-scoped.

Scope:

- Convert runtime caches, restore state, workspace watchers, and cleanup bookkeeping to environment ownership.
- Preserve thread-local event/timeline/provider state.

Deliverables:

- `EnvironmentService` runtime maps keyed by `environmentId`.
- Thread resolution path updated to fetch attached environment runtime.
- Cleanup logic based on environment liveness/reference state.

Verification:

- Unit tests for environment runtime reuse across multiple attached threads.
- Regression tests for archive/delete semantics with shared environment references.

## Milestone 5: Make worktree and managed artifact paths environment-owned

Goal:

- Remove the baked-in assumption that workspaces are named after thread ids.

Scope:

- Update worktree pathing, branch naming, and managed artifact reconciliation to use environment ids.
- Preserve dedicated-per-thread behavior by creating one environment per thread when requested.

Deliverables:

- Worktree environment state keyed by environment id.
- Managed log/workspace cleanup keyed by environment lifecycle.
- Migration handling for existing thread-id-named worktrees.
- `env-factory` rules for when a path-backed worktree can be adopted versus when a new managed worktree must be created.
- Cleanup rules aligned to:
  - workspace cleanup only when `managed === true` and the environment is not the primary workspace
  - log cleanup managed independently of `managed`

Verification:

- Worktree tests updated.
- Targeted e2e for dedicated environment provisioning still passing.

## Milestone 6: Make env-daemon process identity environment-scoped

Goal:

- Ensure one env-daemon process can be reused by multiple threads attached to the same environment.

Scope:

- Re-key managed process identity, reconnect, adoption, and env vars to environment id.
- Stop treating thread id as the fixed process identity.

Deliverables:

- Managed env-daemon identity and process registry keyed by environment id.
- Environment-scoped launch/env metadata.
- Thread id passed as request metadata rather than process identity.

Verification:

- Unit tests for env-daemon reuse/adoption.
- Restart/reconnect tests for shared environment process reuse.

## Milestone 7: Convert session persistence and protocol to environment-owned sessions with thread channels

Goal:

- Allow a single env-daemon session to serve multiple threads.

Scope:

- Re-key persisted sessions/cursors/commands by environment id.
- Add multi-thread channel support to session protocol handling.
- Preserve per-thread routing for events and commands.

Deliverables:

- Schema/repository changes for environment-owned session records.
- Updated session service, supervisor, sync, and command dispatcher.
- Multi-channel open/heartbeat/event/command flows.

Verification:

- Unit tests for multi-channel routing and cursor correctness.
- Recovery tests for reconnecting one env-daemon session with multiple attached threads.

## Milestone 8: Decouple thread execution routing from environment ownership

Goal:

- Make the server explicitly route thread work through the attached environment.

Scope:

- Ensure thread start/resume/tell/interrupt flows resolve environment attachment first.
- Keep provider ids and provider thread ids per thread.
- Allow multiple provider threads to target one environment.

Deliverables:

- Thread execution path updated to use thread -> environment routing.
- Provider context/config updated so environment and thread identities are not conflated.
- Agent instruction composition updated to append commit guidance when the attached environment is not the primary workspace.

Verification:

- Unit/e2e tests for multiple threads attached to one environment running turns concurrently.
- Validate thread-local timeline/provider state isolation.

## Milestone 9: Expose explicit shared-environment flows in API/UI

Goal:

- Make environment reuse an intentional feature instead of an internal capability only.

Scope:

- Add API affordances for attach-to-existing-environment and environment inspection.
- Add API affordances for import/adopt-existing-environment where supported.
- Add enough UI/server contract support to debug attachments and active env-daemon status.

Deliverables:

- Attach/reuse environment API path.
- Import/adopt environment API path for existing supported workspace roots.
- Environment detail/status surface.
- Thread detail includes attached environment metadata and reuse visibility.
- UI environment presentation updated around derived rules:
  - primary workspace: none or laptop icon
  - container-backed: container icon
  - linked worktree: folder-git icon

Verification:

- Route tests and basic integration coverage for attach/reuse flows.

## Milestone 10: Remove legacy thread-owned environment/session assumptions

Goal:

- Finish the migration and delete compatibility scaffolding.

Scope:

- Remove `thread.environmentRecord` ownership semantics.
- Remove thread-keyed runtime/session/process paths that are no longer used.
- Normalize tests and docs around the new architecture.

Deliverables:

- Legacy code removed.
- Plans/docs updated to reflect completed migration.

Verification:

- Full targeted QA pass for affected server/env-daemon behavior.
- Relevant typecheck and e2e suites passing.

## Suggested PR Sequence

1. PR 1: schema + repository support for first-class environments and thread attachment
2. PR 2: agent-core/API type additions for environments, no runtime behavior change
3. PR 3: environment-aware server accessors/routes/debug endpoints
4. PR 4: codebase naming pass for `server` / `env-daemon` where low-risk
5. PR 5: environmentId-keyed runtime management in `EnvironmentService`
6. PR 6: environment-owned worktree/artifact/log pathing
7. PR 7: environment-scoped env-daemon process identity and reconnect
8. PR 8: environment-owned session persistence and dispatcher changes
9. PR 9: multi-channel env-daemon protocol support
10. PR 10: thread execution routing through attached environments
11. PR 11: explicit attach/reuse environment API flows
12. PR 12: legacy thread-owned environment cleanup and final QA

## Recommended Cut Lines

- Safe checkpoint A:
  - After Milestone 2
  - New persistence model exists, but runtime behavior is unchanged

- Safe checkpoint B:
  - After Milestone 6
  - Environment/process ownership is migrated, but session protocol is still in transition

- Feature-complete checkpoint:
  - After Milestone 9
  - Shared environment reuse works end to end

- Cleanup checkpoint:
  - After Milestone 10
  - Legacy assumptions removed
