# Worktree Git Index Permission Report

## Root Cause

Managed worktree environments are created with a normal Git linked worktree. Unmanaged environments can also point at linked worktrees. In both cases the worktree path is writable, but its `.git` file points to a per-worktree gitdir outside the worktree, for example:

`/Users/michael/Projects/bb/.git/worktrees/bb13`

Workspace-write sandboxing allowed the worktree cwd, while bb did not include the external Git metadata paths needed by Git. Git index operations in linked worktrees write `index.lock` in the external per-worktree gitdir, so `git add` failed with `Operation not permitted`. A later `git commit` also needs the common git dir for `objects`, `refs`, and reflogs.

## Fix

The host workspace layer now owns additional workspace-write root resolution for any Git worktree:

- per-worktree gitdir, for `index`, `HEAD`, `COMMIT_EDITMSG`, and worktree reflogs
- common git `objects`
- common git `refs`
- common git `logs`

The host daemon asks `HostWorkspace` for those roots when creating a runtime, so both managed and unmanaged linked worktrees are covered without rechecking workspace flags in runtime-manager.

The agent runtime now treats these roots as runtime/adapter construction state rather than a per-turn `ProviderExecutionContext` field. Codex includes them in the `workspaceWrite` sandbox policy for `turn/start`. Claude Code passes them through `thread/start` and `thread/resume` for workspace-write sessions, then the bridge maps them to Claude SDK `additionalDirectories` and sandbox `filesystem.allowWrite` for acceptEdits.

## Validation

- `pnpm exec turbo run test --filter=@bb/host-workspace -- --run test/provision.test.ts`
- `pnpm exec turbo run test --filter=@bb/agent-runtime --force -- --run src/codex/adapter.test.ts src/claude-code/adapter.test.ts src/claude-code/bridge/__tests__/bridge.test.ts src/claude-code/bridge/__tests__/sdk-session.test.ts src/runtime.command-contract.test.ts`
- `pnpm exec turbo run test --filter=@bb/host-daemon -- --run src/runtime-manager.test.ts`
- `pnpm exec turbo run typecheck --filter=@bb/host-workspace`
- `pnpm exec turbo run typecheck --filter=@bb/agent-runtime --force`
- `pnpm exec turbo run typecheck --filter=@bb/host-daemon`
- `git diff --check`

## Remaining Risks

The fix intentionally grants only the per-worktree gitdir plus common `objects`, `refs`, and `logs` paths when those paths are outside the worktree. Git features that write other common-gitdir files may need additional focused roots later, but normal index writes, commits, ref updates, and reflogs are covered.
