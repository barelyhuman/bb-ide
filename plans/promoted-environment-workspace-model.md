# Promoted Environment Workspace Model Plan

Status: Draft after rebasing onto local `main` on 2026-05-13.

## Goal

Reintroduce promotion as a first-class environment placement model, not as the
old branch-derived promote/demote implementation.

The user workflow:

- Start agent work in an isolated managed worktree so long-running tasks can
  run in parallel.
- Promote that work into the project primary checkout for manual testing, hot
  reload, local tools, or hands-on iteration.
- Continue sending follow-ups to the same thread while the environment is
  promoted, with the agent operating in the primary checkout.
- Avoid thinking about same-host constraints, detached HEADs, branch checkout
  conflicts, or stale branch metadata.

## Current Baseline After Rebase

Local `main` has already removed the previous promote/demote implementation.
That changes this plan from "repair the current feature" to "rebuild the
feature on a better model."

Relevant current state:

- `packages/server-contract/src/api-types.ts` only allows environment actions
  `commit` and `squash_merge`.
- `packages/server-contract/src/public-api.ts` no longer exposes
  `/environments/:id/promotion`.
- `apps/server/src/routes/environments.ts` only handles commit and squash
  merge in `/environments/:id/actions`.
- `apps/server/src/services/environments/environment-promotion.ts` is gone.
- `apps/server/src/services/threads/thread-send.ts` no longer attempts
  automatic demotion. It simply starts work in `environment.path` on
  `environment.hostId`.
- `packages/host-daemon-contract/src/commands.ts` no longer defines
  `workspace.promote` or `workspace.demote`.
- `apps/host-daemon/src/command-handlers/workspace.ts` only handles squash
  merge.
- `packages/host-workspace/src/promote.ts` and the corresponding tests are
  gone. `HostWorkspace` no longer has `promote` or `demote` methods.
- The app-side promotion dialog, hook, copy, sidebar "promoted" label, project
  source status fan-out, and CLI promote/demote commands were removed.

What remains:

- Environments still model one path and one host through `environments.path`,
  `hostId`, `workspaceProvisionType`, `branchName`, and `defaultBranch`.
- Thread starts, status, diff, file reads, commit, squash merge, and workspace
  open paths all still use the environment's single stored path.
- Git branch state is still dynamic only at command/query time through
  `workspace.status`; the environment row does not model branch detaches,
  branch switches, or checkout identity as first-class state.
- The branch cleanup plan in
  `plans/managed-environment-branch-hygiene.md` now deliberately avoids
  promote/demote behavior. This plan should coordinate with its branch
  ownership model, not duplicate it.

## Product Direction

Treat an environment as logical work that can have multiple concrete workspace
bindings.

An environment has exactly one active workspace binding:

- Initially, the active binding is the managed worktree or clone created for
  the thread.
- Promotion makes the project primary checkout the active binding.
- Demotion makes the managed home workspace active again.

All runtime and git operations resolve through the active binding:

- thread start and turn submit
- environment status, diff, diff file reads, branch list
- commit and squash merge
- workspace-open paths
- runtime host display and reconnect behavior

Cleanup and branch ownership use the managed home workspace and tracked work
refs. They should not infer ownership or deletion safety from whichever
checkout is active for manual iteration.

## Non-Goals

- Do not restore the removed `workspace.promote` / `workspace.demote` commands
  or the deleted branch-name heuristic.
- Do not represent promotion by mutating `environment.path` alone.
- Do not re-add app/sidebar "promoted" UI until the server exposes durable
  promoted state.
- Do not make `environments.status` grow states like `promoting` or
  `demoting`; promotion lifecycle belongs to `environment_operations`.
- Do not require the user to understand same-host vs cross-host mechanics.
  Those are promotion strategies chosen by the server and daemon.

## High-Level Flow

### Start In A Worktree

1. Thread provisioning creates the normal managed workspace.
2. The server creates an `environment_workspaces` row with role `home`.
3. `environments.homeWorkspaceId` and `environments.activeWorkspaceId` both
   point to that home binding.
4. For managed worktrees, the branch ownership model records the BB-created
   work branch after successful provisioning.

### Promote

1. The user requests promotion for an idle environment.
2. The server resolves the target project primary checkout. If the source and
   target are in the same linked repository, use a same-repo checkout strategy.
   If not, use a materialized transfer strategy once cross-host support exists.
3. The server creates a durable `promote` environment operation with source
   binding, target binding, work ref, expected observations, and dirty policy.
4. The daemon migrates workspace state under git locks:
   - captures source uncommitted state,
   - checks out or materializes the work ref in the primary checkout,
   - applies captured dirty state in the primary checkout,
   - leaves the managed home workspace in an expected inactive state.
5. The server records an active promotion row, points
   `environments.activeWorkspaceId` at the primary binding, stores fresh
   observations, and notifies environment subscribers.
6. The daemon evicts or rebinds any idle runtime entry for the environment, so
   the next follow-up starts in the primary checkout.

Promotion should be idempotent. If the active binding is already the primary
checkout and git observations match the expected environment, reconcile and
succeed.

### Follow Up While Promoted

1. `sendThreadMessage` remains free of demotion behavior.
2. Before queueing thread commands, the server resolves the active workspace
   context from `environments.activeWorkspaceId`.
3. The queued `thread.start` or `turn.submit` command targets the active
   binding's host/path/provision type.
4. A promoted idle thread starts in the primary checkout, so user edits, hot
   reload servers, and agent edits operate on the same files.

### Demote

1. The user requests demotion for an idle promoted environment.
2. The server creates a durable `demote` operation against the active primary
   binding and the managed home binding.
3. The daemon captures dirty state from the primary checkout, restores the
   primary checkout to its pre-promotion checkout ref, reattaches the managed
   home workspace to the work ref, and applies dirty state there.
4. The server sets `environments.activeWorkspaceId` back to the home binding,
   marks the active promotion row demoted, stores fresh observations, and
   evicts or rebinds idle runtime state.

Demotion restores the exact pre-promotion checkout ref, not blindly
`environment.defaultBranch`.

## Data Model Changes

### `environment_workspaces`

One row per concrete workspace path associated with a logical environment.

Fields:

- `id`
- `environmentId`
- `hostId`
- `projectSourceId`: nullable, set when this binding points at a project
  primary checkout
- `role`: `home` or `primary`
- `ownership`: `bb_managed`, `project_source`, or `external`
- `path`
- `workspaceProvisionType`: `managed-worktree`, `managed-clone`, or
  `unmanaged`
- `retiredAt`
- timestamps

Indexes:

- `environmentId`
- `hostId, path`
- partial unique non-retired home workspace per environment
- non-unique `projectSourceId` lookup for primary checkout bindings

The active workspace is not inferred from `role`; it is pointed to explicitly
by `environments.activeWorkspaceId`.

### `environments`

Add:

- `homeWorkspaceId`: nullable during migration/provisioning; required for a
  ready managed environment.
- `activeWorkspaceId`: nullable during migration/provisioning; required for a
  ready environment.

`activeWorkspaceId` is current resource state. It is not queue state. After
provisioning, only promotion/demotion lifecycle owners should move it.

Keep existing columns during migration as compatibility denormalizations:

- `path`
- `hostId`
- `workspaceProvisionType`
- `branchName`
- `defaultBranch`

New code should resolve execution from the active workspace binding. Later
cleanup can either remove these columns or define them explicitly as legacy
home-workspace summaries.

### `environment_git_observations`

Persist the last daemon-observed git state for a workspace binding. This is a
read model for decisions and display.

Fields:

- `workspaceId`
- `observedAt`
- `isGitRepo`
- `isWorktree`
- `gitCommonDir`: nullable for non-git workspaces and when unavailable
- `gitDir`: nullable
- `checkoutKind`: `branch`, `detached`, `unborn`, or `unknown`
- `branchName`: nullable
- `headSha`: nullable
- `defaultBranch`: nullable
- `hasUncommittedChanges`
- compact change stats for display

Detached and unknown checkout states are first-class observations, not missing
branch defaults.

### `environment_work_refs`

Track the logical work ref separately from the current checkout. This should be
the same ownership model as `environment_branch_refs` from the branch hygiene
plan unless that table is renamed to cover the broader work-ref purpose.

Fields:

- `environmentId`
- `hostId`
- repository identity, preferably git common dir for linked local worktrees
- `branchName`
- ownership: `bb_created`, `user_owned`, or `unknown`
- initial and last observed head SHA
- deletion marker for cleanup

The current checkout can differ from the work ref. That is an observation, not
proof that the environment is invalid.

### `environment_promotions`

Record current and historical promotion state.

Fields:

- `id`
- `environmentId`
- `homeWorkspaceId`
- `primaryWorkspaceId`
- `workRefId`
- `promotedAt`
- `demotedAt`: nullable
- `primaryPrePromotionCheckoutRef`: JSON-encoded `GitCheckoutRef`
- `primaryPrePromotionHeadSha`
- `promotionStrategy`: `same_repo_checkout` or `materialized_transfer`
- promote and demote operation ids

An active row with `demotedAt IS NULL` is the durable promoted state. UI and
CLI must use this, not branch-name heuristics.

Add partial uniqueness so one environment has at most one active promotion and
one project source has at most one active promoted environment.

### `environment_operations`

Extend `EnvironmentOperationKind` with:

- `promote`
- `demote`

The operation payload stores request inputs and expected observations. Operation
state remains in `environment_operations`; no lifecycle fields are added to
generic environment metadata helpers.

## Contract Changes

### Domain Types

Add shared types in `@bb/domain`:

- `GitCheckoutRef`
  - `{ kind: "branch"; branchName: string; headSha: string | null }`
  - `{ kind: "detached"; headSha: string | null }`
  - `{ kind: "unborn"; branchName: string | null }`
  - `{ kind: "unknown"; reason: string }`
- `WorkspaceGitObservation`
- `EnvironmentWorkspaceBinding`
- `EnvironmentPromotion`
- `EnvironmentWorkRef`

Do not use optional branch fields to hide detached, unborn, or unknown states.

### Public API

Extend environment responses with a required workspace block:

```ts
{
  workspace: {
    active: EnvironmentWorkspaceBinding | null;
    home: EnvironmentWorkspaceBinding | null;
    promotion: EnvironmentPromotion | null;
  };
  git: {
    activeObservation: WorkspaceGitObservation | null;
    workRef: EnvironmentWorkRef | null;
  };
}
```

Use nullable fields for provisioning/migration absence. Once an environment is
ready, `workspace.active` should be present.

Reintroduce promotion through lifecycle-specific endpoints rather than by
adding `promote` and `demote` back into the existing commit/squash action union:

- `GET /environments/:id/promotion`
  - Returns durable promotion state, target availability, latest observations,
    and blockers.
- `POST /environments/:id/promotion`
  - Body: `{ action: "promote" }` or `{ action: "demote" }`.
  - Queues or executes the lifecycle operation and returns operation state or
    terminal result.

The old branch-derived response shape should not return.

### Host Daemon Commands

Add inspection and placement commands:

- `workspace.inspect`
  - Input: explicit workspace context.
  - Output: `WorkspaceGitObservation`.
- `environment.promote`
  - Input: environment id, source binding context, target binding context,
    work ref, expected observations, dirty policy.
  - Output: updated source and target observations, pre-promotion checkout ref,
    active binding result.
- `environment.demote`
  - Input: environment id, active primary binding context, home binding
    context, work ref, primary restore ref, expected observations.
  - Output: updated home and primary observations.

The daemon owns host-local git mechanics. The server owns product policy:
target selection, dirty policy, host placement, and which binding becomes
active.

### Command Builders

Add a server helper:

`resolveActiveWorkspaceContext(environmentId)`

It returns:

- active `hostId`
- active `workspacePath`
- active `workspaceProvisionType`
- active workspace id
- latest observation

Use it for thread start, turn submit resume context, environment status, diff,
diff file reads, branch list, commit, squash merge, and workspace-open paths.

## Git Behavior Policy

### Dirty Work

Promotion should allow dirty source work. Requiring a clean source would miss
the main workflow.

Initial policy:

- source dirty before promotion: allowed; daemon moves tracked, staged, and
  untracked state through a reversible patch/stash mechanism
- primary dirty before promotion: blocked unless a future explicit
  "stash primary first" policy is added
- primary dirty while promoted: allowed; it belongs to the promoted environment
- primary dirty during demotion: allowed; daemon moves that dirty state back to
  the home workspace before restoring the primary checkout

### Detached And Branch Mismatch

Detached HEAD is not automatically an error.

- Inactive home worktree detached after promotion is expected.
- Active primary checkout on the work ref branch is expected.
- Active checkout detached or on another branch is an observation that may
  block branch-specific operations, but follow-up execution can still use the
  active path if no data-loss git mutation is needed.

### Runtime Rebinding

Promotion and demotion should initially require idle threads. Active provider
turns can be supported later through explicit stop/restart semantics.

For idle threads, the daemon must evict or rebind runtime state when the active
workspace changes. `RuntimeManager.requireWorkspaceEnvironment` should also
reject or recreate an existing entry whose path does not match the requested
workspace context.

### Host Placement

Execution host comes from the active workspace binding, not
`environments.hostId`.

Same-host promotion can use linked-worktree ref movement. Cross-host promotion
should be modeled as a separate strategy:

- export committed and uncommitted work from the source binding as a portable
  change bundle
- apply that bundle to the target primary checkout under dirty guards
- mark the target primary checkout as active

The initial implementation can ship same-host promotion first, but the model
and contracts should not assume same-host forever.

## Migration Plan

1. Add workspace binding, git observation, promotion, and work-ref types and
   tables.
2. Backfill one `home` workspace binding for every existing environment from
   current environment columns.
3. Set `homeWorkspaceId` and `activeWorkspaceId` to that home binding.
4. Add `workspace.inspect` and store observations during provisioning, status
   reads, and promotion preflight.
5. Add `resolveActiveWorkspaceContext` and migrate command builders to use it.
   With no promotions, it should resolve to the existing home binding and
   preserve current behavior.
6. Add durable promotion read model and lifecycle operation records.
7. Implement same-host `environment.promote` / `environment.demote` daemon
   commands with dirty-source migration and dirty-primary guards.
8. Reintroduce API/CLI/UI controls against the new promotion endpoints.
9. Add runtime rebinding/eviction in the host daemon.
10. Coordinate work-ref cleanup with
    `plans/managed-environment-branch-hygiene.md`.

## Open Questions

- Should promotion ever auto-stash a dirty primary checkout, or should dirty
  primary remain a hard blocker?
- Should an active checkout branch change automatically update the environment
  work ref, or require an explicit "adopt current branch" action?
- What is the first cross-host transfer format: git bundle, format patches,
  binary diff, or provider-neutral archive?
- Should promotion of an active thread wait, stop, or fail?
- How should the server choose between multiple local project sources as the
  promotion target?

## Exit Criteria

- A managed worktree thread can be promoted while its source worktree has
  uncommitted changes, and those changes appear in the primary checkout.
- A follow-up sent to a promoted idle thread runs in the primary checkout
  without demoting first.
- Manual edits in the primary checkout while promoted are visible in
  environment status/diff and can be changed by the next agent turn.
- Demotion restores the primary checkout to its pre-promotion ref and moves
  promoted dirty state back to the managed home worktree.
- Promotion state is durable and survives server or daemon restart.
- A detached inactive worktree does not make the environment look broken.
- Current-ref displays are driven by observations, not stale
  `environment.branchName`.
- The deleted promote/demote product surface is not restored until it can read
  durable promotion state from the new server model.

## Validation

- Unit tests for `resolveActiveWorkspaceContext` covering normal, promoted,
  demoted, missing observation, and cross-host binding cases.
- Server integration tests:
  - no-promotion environments preserve current command payloads through the
    active context resolver.
  - promote dirty managed worktree, then send follow-up; assert `thread.start`
    targets the primary binding host/path.
  - promoted primary dirty follow-up; assert status/diff use primary binding.
  - demote dirty primary; assert primary restore ref and home active binding.
  - already-promoted action is idempotent.
  - stale legacy `environment.branchName` does not affect promoted state.
- Host workspace tests using real git repos:
  - migrate dirty worktree state to primary and back.
  - preserve staged, unstaged, and untracked files.
  - reject dirty primary before promotion.
  - handle inactive detached source as expected state.
- Runtime manager tests:
  - existing idle runtime is evicted/recreated when active path changes.
  - existing runtime path mismatch does not silently reuse the old path.
  - promotion is blocked or explicit while a provider turn is active.
- Contract tests for new promotion read model and lifecycle operation blockers.

Use repo-standard validation commands for touched packages, for example:

```sh
pnpm exec turbo run typecheck --filter=@bb/domain
pnpm exec turbo run typecheck --filter=@bb/server-contract
pnpm exec turbo run typecheck --filter=@bb/host-daemon-contract
pnpm exec turbo run typecheck --filter=@bb/server
pnpm exec turbo run typecheck --filter=@bb/host-daemon
pnpm exec turbo run test --filter=@bb/server --force > /tmp/server-test-out.txt 2>&1
pnpm exec turbo run test --filter=@bb/host-workspace --force > /tmp/host-workspace-test-out.txt 2>&1
```
