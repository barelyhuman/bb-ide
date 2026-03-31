# Move `mergeBaseBranch` from Thread to Environment

## Goal

`mergeBaseBranch` is currently stored on the thread as a denormalized copy of `environment.defaultBranch`, with the UI picker updating it via `PATCH /threads/:id`. This is wrong: merge base branch is a property of the environment (the workspace), not the thread. Multiple threads can share an environment, and "which branch do I compare/merge against" is a workspace-level decision.

Move `mergeBaseBranch` to the environment. Remove it from the thread.

## Current State

- **`environment.defaultBranch`** — discovered from git during provisioning. Set once, never updated by user.
- **`thread.mergeBaseBranch`** — seeded from `environment.defaultBranch` at thread creation or post-provisioning backfill. User can override via picker (PATCH thread). Used for: workspace status queries, diff targets, squash merge target, demote default branch.

## Design

- Add `mergeBaseBranch` column to `environments` table (nullable text). When null, falls back to `defaultBranch`.
- Remove `mergeBaseBranch` column from `threads` table.
- Add `PATCH /environments/:id` endpoint accepting `{ mergeBaseBranch }`.
- Frontend picker patches environment instead of thread.
- All server code that reads `thread.mergeBaseBranch` switches to `environment.mergeBaseBranch ?? environment.defaultBranch`.
- `mergeBaseBranch` on environment is **user-set only** — null until the picker is used. No backfill from `defaultBranch`. The fallback `?? defaultBranch` handles the common case.

## Changes by Layer

### 1. DB Schema (`packages/db`)

- **`schema.ts`**: Add `mergeBaseBranch: text("merge_base_branch")` to `environments` table. Remove from `threads` table.
- **`data/environments.ts`**: Add `mergeBaseBranch` to `CreateEnvironmentInput`, `UpdateEnvironmentInput`, and the update function.
- **`data/threads.ts`**: Remove `mergeBaseBranch` from `CreateThreadInput`, `UpdateThreadInput`, create/update functions.
- **Migration**: Run `pnpm db:generate` after schema changes to produce the migration file.

### 2. Domain Types (`packages/domain`)

- **`thread.ts`**: Remove `mergeBaseBranch` from `threadSchema`.
- **`environment.ts`**: Add `mergeBaseBranch: string | null` to `Environment` type.

### 3. Server Contract (`packages/server-contract`)

- **`api-types.ts`**:
  - Remove `mergeBaseBranch` from `updateThreadRequestSchema`. Update the `.refine()` clause — it currently checks `value.mergeBaseBranch !== undefined` and will break when the field is removed.
  - Add `updateEnvironmentRequestSchema` with `mergeBaseBranch`.
- **`public-api.ts`**: Add `$patch` to `/environments/:id` returning `Environment`.
- **`test/contract.test.ts`**: Update contract test that references `updateThreadRequestSchema.mergeBaseBranch`.

### 4. Server (`apps/server`)

- **`routes/environments.ts`**:
  - Add `PATCH /environments/:id` handler.
  - Demote case: use `environment.mergeBaseBranch ?? environment.defaultBranch` instead of `actingThread.mergeBaseBranch`.
- **`routes/threads/base.ts`**: Remove `mergeBaseBranch` from PATCH handler.
- **`routes/threads/actions.ts`**: Archive path reads `environment.mergeBaseBranch ?? environment.defaultBranch` instead of `thread.mergeBaseBranch ?? environment.defaultBranch`.
- **`services/thread-create.ts`**: Stop passing `mergeBaseBranch` to `createThreadRecord`. Remove from all `CreateThreadInEnvironmentArgs`, `ReuseEnvironmentByHostPathArgs`, and call sites.
- **`services/thread-create-helpers.ts`**: Remove `mergeBaseBranch` param from `createThreadRecord`.
- **`internal/command-result-handlers.ts`**: Remove the post-provision thread backfill loop entirely (lines 76-81). The environment already gets `defaultBranch` set during provisioning; `mergeBaseBranch` is user-set only.

#### Server Tests

- **`test/helpers/seed.ts`**: Remove `mergeBaseBranch` from `seedThread` helper (currently defaults to `"main"`). Every test calling `seedThread` with `mergeBaseBranch` needs updating.
- **`test/public-threads.test.ts`**: Remove `mergeBaseBranch` from thread assertions and payloads.
- **`test/public-thread-lifecycle-regressions.test.ts`**: Remove `mergeBaseBranch` references.
- **`test/public-environment-action-regressions.test.ts`**: Remove `mergeBaseBranch` from thread seeds; add to environment seeds where needed for squash merge tests.
- **`test/public-environments-system.test.ts`**: Remove `mergeBaseBranch` from thread seeds; add to environment seeds where needed.
- **`test/helpers/timeline-benchmark.ts`**: Remove `mergeBaseBranch` from thread fixture.

### 5. Frontend (`apps/app`)

- **`views/useThreadMergeBase.ts`**: Refactor to read/write from environment. Patch environment instead of thread.
- **`components/thread/MergeBaseBranchPicker.tsx`**: Props may change — receives environment ID context instead of thread.
- **`views/ThreadDetailView.tsx`**: Read `mergeBaseBranch` from environment, not thread.
- **`components/thread/ThreadGitActionDialog.tsx`**: Verify — likely no changes needed if parent components pass correct data. Currently receives `mergeBaseBranch` as prop from parent.
- **`lib/api.ts` / `hooks/useApi.ts`**: Add `updateEnvironment` mutation. Remove `mergeBaseBranch` from `updateThread` type.
- **`lib/thread-archive.test.ts`**: Remove `mergeBaseBranch: "main"` from thread fixture.
- **`lib/workspace-status.ts`**: No change — reads from `WorkspaceStatus` (runtime), not thread.

### 6. CLI (`apps/cli`)

- **`commands/thread/show.ts`**: `requireMergeBaseBranch` reads from environment instead of thread. Falls back: `environment.mergeBaseBranch ?? environment.defaultBranch`.
- **`commands/thread/actions.ts`**: Two changes:
  - Squash merge reads from environment.
  - `thread update --merge-base-branch` subcommand — reroute to PATCH environment, or remove the flag from thread update and add an `environment update` command.
- **`__tests__/command-output.test.ts`**: Remove `mergeBaseBranch: null` from thread fixture.

### 7. Integration Tests (`tests/integration/`)

- **`fake/smoke.test.ts`**: Calls `updateThread(harness.api, thread.id, { mergeBaseBranch: "main" })` — must change to update environment instead.
- **`helpers/api.ts`**: Update helper if it has `mergeBaseBranch` in thread update types.

### No Changes Needed (confirmed)

These layers use `mergeBaseBranch` as a runtime pass-through parameter (in daemon commands, workspace operations, diff targets) — not as a stored field on thread or environment. No changes required:

- **`packages/host-daemon-contract/src/commands.ts`** — `workspace.status` command has optional `mergeBaseBranch` parameter. Pass-through.
- **`apps/host-daemon/src/command-dispatch.ts`** — passes `command.mergeBaseBranch` to workspace. Pass-through.
- **`packages/workspace/src/workspace.ts`** — `StatusOptions.mergeBaseBranch`, `getDiff` targets. Pass-through.
- **`packages/domain/src/thread-git-diff.ts`** — `WorkspaceDiffTarget` variants. Runtime type.
- **`packages/domain/src/shared-types.ts`** — `workspaceMergeBaseSchema`. Runtime status type.
- **`apps/cli/src/commands/environment.ts`** — squash-merge action passes `mergeBaseBranch` as request parameter. No stored field.

## Exit Criteria

- `thread.mergeBaseBranch` column and all references removed.
- `environment.mergeBaseBranch` column exists and is used everywhere.
- Migration generated and applied.
- Picker updates environment via `PATCH /environments/:id`.
- Demote uses `environment.mergeBaseBranch ?? environment.defaultBranch`.
- All existing tests pass (updated as needed).
- Build clean across all packages.

## Validation

1. `pnpm exec turbo run build` — full typecheck.
2. `pnpm exec turbo run test --filter=@bb/server --filter=@bb/db --filter=@bb/server-contract --force` — server + db tests.
3. Manual: confirm picker persists on environment, demote restores correct branch.
