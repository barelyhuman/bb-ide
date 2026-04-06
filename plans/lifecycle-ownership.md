# Lifecycle Ownership Plan

## Problem

We have several async workflows where resource status, durable lifecycle intent, and daemon command execution are not modeled separately enough. That leads to the same class of bug in multiple places:

- a route or service records that work is "in progress"
- the daemon command that should perform that work is not yet queued, is lost, or expires
- no single owner reconciles the workflow back to a valid state

The codebase is not starting from zero:

- thread status already uses an explicit transition helper
- thread stop, environment cleanup, and managed reprovision already have dedicated helpers
- generic `updateThread(...)` and `updateProject(...)` helpers are already narrower than many older server codebases

But ownership is still split across routes, thread creation, command-result handlers, sweeps, and reconciliation. Provisioning and project deletion are the clearest remaining gaps.

## Goal

Make async lifecycle workflows explicit, durable, and recoverable.

For every lifecycle:

- current resource state is modeled separately from requested work
- queued or in-flight daemon work is represented explicitly
- one server module owns lifecycle transitions, recovery, and reconciliation
- generic metadata update helpers do not mutate lifecycle state

## Core Decisions

These decisions are part of the plan and should not be revisited mid-implementation:

1. `status` remains current resource state only.
   - Do not grow resource `status` enums into queue-state ladders such as `requested`, `queued`, `fetched`, `completed`.

2. Durable async lifecycle workflows use operation tables.
   - We are not using a hybrid "some lifecycles use fields, others use tables" target design.
   - Existing lifecycle fields are transitional during migration.

3. Lifecycle ownership stays in server modules.
   - `apps/server` owns lifecycle policy, sequencing, recovery, and reconciliation.
   - `@bb/db` owns reusable row/query/transaction helpers, not workflow semantics.

4. Routes may request lifecycle work, but only lifecycle owners may advance it.

5. Command expiry remains DB-detected, but lifecycle consequences are handled by server lifecycle owners.

## Preferred Design

Do not solve this by growing `status` enums into giant queue-state ladders.

Instead, model three separate concerns:

1. Resource status
   - What is true about the entity right now.
   - Examples: environment `ready`, `provisioning`, `error`, `destroying`, `destroyed`; thread `created`, `idle`, `active`, `error`.

2. Lifecycle operation state
   - What durable async workflow has been requested and where it currently is in that workflow.

3. Daemon execution state
   - What command has been queued, fetched, completed, failed, or expired.
   - This already partly exists in `host_daemon_commands`, but lifecycle owners must connect command state back to operation and resource state.

## Standard Lifecycle Model

We will use per-resource operation tables, not one polymorphic global operations table.

Target tables:

- `environment_operations`
  - `provision`
  - `reprovision`
  - `destroy`
- `thread_operations`
  - `start`
  - `stop`
- `project_operations`
  - `delete`

Suggested shape for each table:

- `id`
- foreign key to owning resource
- `kind`
- `state`
  - `requested`
  - `queued`
  - `fetched`
  - `completed`
  - `failed`
  - `cancelled`
- `commandId`
- `requestedAt`
- `queuedAt`
- `completedAt`
- `failureReason`

We already have command history and event history elsewhere. These tables are for durable workflow state and recovery, not generic auditing.

## Architectural Rules

- Each lifecycle has one owning module in `apps/server/src/services/`.
- We will extend existing lifecycle modules where they already exist:
  - `environment-cleanup.ts`
  - `environment-provisioning.ts`
  - `thread-stop.ts`
- Do not create parallel lifecycle modules for the same workflow unless a rename or split is explicitly part of the PR.
- Lifecycle owners expose explicit operations such as:
  - `request...`
  - `advance...`
  - `handle...Result`
  - `reconcile...`
- Routes and unrelated services may request lifecycle work, but may not directly mark work in progress or completed.
- Generic metadata update helpers in `@bb/db` must not accept lifecycle fields such as `status`, `stopRequestedAt`, `cleanupRequestedAt`, `cleanupMode`, or future operation-state surrogates.
- Lifecycle field or operation-state mutation must happen through explicit DB helpers or lifecycle-owner modules only.
- Recovery paths must cover:
  - lost daemon results
  - expired commands
  - reconnect reconciliation
  - repeated request deduplication

## Scope

This plan covers the server-owned lifecycles that mutate thread/environment/project execution state:

- environment provisioning
- environment reprovisioning
- environment cleanup / destroy
- thread start
- thread stop
- project deletion when managed environments require async teardown

The managed environment cleanup redesign already moved one lifecycle in the right direction. This plan extends that ownership model to the remaining workflows and standardizes all of them on operation tables.

## Non-Goals

- Replacing server lifecycle code with a frontend-style statechart runtime
- Rewriting all thread/environment/project logic in one PR
- Moving lifecycle policy into `@bb/db`
- Tracking every daemon command in an operation table

## Compatibility Policy

This plan does not preserve backwards compatibility for internal helpers or public APIs.

- Internal server and DB helper APIs may change freely if the resulting lifecycle model is cleaner.
- Public API route shapes and response payloads may change if the lifecycle redesign becomes simpler or more explicit.
- Prefer replacing old lifecycle helpers, fields, and route shapes over keeping dual old/new paths.
- Transitional fields or adapters should exist only as long as needed to complete the in-repo migration safely.

The compatibility constraint is migration correctness, not API stability:

- schema and data migrations must move existing local state cleanly to the new lifecycle model
- tests should cover legacy persisted states only when needed to guarantee safe migration of existing local data

## What Already Exists

The plan should build on existing pieces, not duplicate them:

- `transitionThreadStatus(...)` already owns thread status transitions
- `markThreadStopRequested(...)` and `clearThreadStopRequested(...)` already model stop intent today
- `requestEnvironmentCleanup(...)` and `advanceEnvironmentCleanup(...)` already model cleanup intent and progression today
- `claimManagedEnvironmentReprovision(...)` already prevents duplicate reprovision claims transactionally
- `sweepExpiredCommands(...)` already performs DB-level expiry detection and retry

The work is to consolidate and complete lifecycle ownership, not to replace every existing helper.

## Workstreams

### 1. Codify Lifecycle Ownership Rules

- Add an `AGENTS.md` section for async lifecycle ownership.
- Document that `status` is observed entity state, not queued-work state.
- Document that lifecycle workflows use operation tables.
- Document the required lifecycle-owner API shape: request, advance, result handling, reconciliation.

### 2. Tighten Remaining `@bb/db` Write Surfaces

- Audit the remaining internal write surfaces for thread, environment, and project records.
- Keep existing narrow helpers like `updateThread(...)` and `updateProject(...)` as metadata-only.
- Tighten the remaining environment internals where metadata and lifecycle fields are still mixed behind private helpers.
- Add explicit DB helpers needed by lifecycle owners and operation tables.

### 3. Environment Lifecycle Ownership

- Extend `environment-provisioning.ts` and `environment-cleanup.ts` to become the canonical owners for environment workflows.
- Introduce `environment_operations`.
- Make environment lifecycle owners the only place allowed to:
  - request provision, reprovision, and destroy work
  - mark environment provisioning or destroying in progress
  - queue `environment.provision` and `environment.destroy`
  - react to provision/destroy success, failure, expiry, and reconnect reconciliation
- Apply the environment provisioning owner to:
  - direct thread creation
  - sandbox-host creation
  - managed reprovision
  - `ensureProjectSourceEnvironment`

### 4. Thread Lifecycle Ownership

- Extend existing thread lifecycle helpers, especially `thread-stop.ts`, into a canonical thread lifecycle owner surface.
- Introduce `thread_operations`.
- Model both `start` and `stop` as lifecycle operations.
- Make thread lifecycle owners the only place allowed to:
  - request thread start and stop work
  - queue `thread.start` and `thread.stop`
  - react to start/stop success, failure, expiry, and reconnect reconciliation

### 5. Command Expiry Integration

- Keep DB-level command expiry detection and retry in `@bb/db`.
- Add server-owned lifecycle consequence handling for expired lifecycle commands.
- At minimum, handle:
  - `environment.provision`
  - `environment.destroy`
  - `thread.start`
  - `thread.stop`
- Expired lifecycle commands must transition the owning operation into a recoverable or failed state, not just leave resource rows stranded.

### 6. Project Deletion Lifecycle

- Introduce `project_operations`.
- Replace "queue destroy, then immediately cascade-delete the project" with a durable deletion workflow.
- Record project deletion intent before teardown.
- Keep enough durable state to retry managed environment destroy work until teardown is complete.
- Decide and implement product behavior for deletion-pending projects:
  - hidden from normal list/detail APIs
  - still present internally until teardown completes
- Only hard-delete project rows and attachments after async teardown is complete.

### 7. Reconciliation And Sweep Invariants

- Add invariant checks to the existing periodic sweeps in `services/periodic-sweeps.ts`.
- Add corresponding repair logic to reconnect reconciliation where appropriate.
- Example invariants:
  - environment is `provisioning` but no active environment provision operation exists
  - environment is `destroying` but no active environment destroy operation exists
  - thread start or stop operation is present but the resource status no longer matches the operation
- Treat invariant violations as actionable repair opportunities, not passive anomalies.

### 8. Tests

- Add invariant-focused tests for each lifecycle owner.
- Add lost-result, reconnect-reconciliation, and command-expiry regression tests.
- Add explicit project deletion tests for:
  - full success
  - partial multi-environment failure
  - resume/retry after partial failure
- Prefer API/service behavior tests and in-memory SQLite DB tests over call-order assertions.

## Suggested PR Breakdown

### PR 1. Rules And Boundary Tightening

- Add `AGENTS.md` lifecycle-ownership guidance
- tighten the remaining internal environment write surface in `@bb/db`
- add initial operation-table schema scaffolding if needed
- no attempt to preserve old helper or route shapes beyond what the migration itself requires

### PR 2. Environment Lifecycle

- introduce `environment_operations`
- extend existing environment lifecycle modules instead of creating parallel ones
- migrate direct provisioning, sandbox provisioning, reprovision, cleanup, and source-environment provisioning
- add expiry and reconciliation handling for environment lifecycle commands

### PR 3. Thread Lifecycle

- introduce `thread_operations`
- unify thread start and stop under lifecycle ownership
- remove direct route/service queueing of `thread.start` and `thread.stop`
- add expiry and reconciliation handling for thread lifecycle commands

### PR 4. Project Deletion Lifecycle

- introduce `project_operations`
- migrate managed environment destroy during project delete to durable teardown
- implement hidden-but-internal deletion-pending project behavior
- add recovery and partial-failure coverage

### PR 5. Invariant Sweep Pass

- add remaining invariant sweeps and reconciliation repairs
- remove obsolete transitional direct lifecycle fields where appropriate
- remove now-obsolete direct status mutations
- remove transitional compatibility shims that are no longer needed after cutover

## Exit Criteria

- No route or unrelated service directly marks async lifecycle work in progress without going through the owning lifecycle module.
- Generic metadata helpers such as `updateThread(...)`, `updateProject(...)`, and remaining environment metadata helpers cannot mutate lifecycle state.
- `environment_operations`, `thread_operations`, and `project_operations` exist and are used for their respective durable lifecycles.
- Environment provisioning/reprovision/destroy have one canonical owner for request, queue, result, expiry, and reconciliation logic.
- Thread start and stop have one canonical owner for request, queue, result, expiry, and reconciliation logic.
- Project deletion keeps durable teardown state until managed environment cleanup is complete.
- Deletion-pending projects are hidden from normal user-facing reads but remain internally recoverable until teardown completes.
- Expired lifecycle commands are handled by server-owned lifecycle logic in addition to DB-level expiry detection.
- Reconciliation and periodic sweeps detect and repair or fail impossible lifecycle combinations.
- New regression tests cover:
  - lost provision result
  - expired provision command
  - lost or expired thread start/stop command
  - reprovision queue failure / reconnect recovery
  - project deletion teardown recovery
  - partial multi-environment project deletion failure
  - invariant repair for stuck lifecycle states

## Validation

Before landing each PR:

```sh
pnpm exec turbo run test typecheck --filter=@bb/db --filter=@bb/server --filter=@bb/server-contract --force
```

Before the full initiative is considered complete:

```sh
pnpm exec turbo run test typecheck --force
```

Also add targeted tests for each lifecycle owner module and for the recovery scenarios listed above.
