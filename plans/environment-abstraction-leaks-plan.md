# Goal

Finish tightening the `packages/environment` boundary so the rest of the codebase does not depend on host-local workspace paths or hardcoded `"worktree"` semantics for behavior that should be environment-owned.

The highest-risk daemon leaks are already addressed. The remaining work is mostly transport/UI cleanup, plus a small amount of product-model cleanup.

# Scope

In scope:

- Remaining `workspaceRoot` exposure outside `packages/environment`
- UI and transport flows that still assume thread files are host-openable by path
- Remaining hardcoded `"worktree"` branches outside the environment package
- Environment/path details still reconstructed from provisioning/setup messages
- Regression coverage for non-host environments

Out of scope:

- Shrinking `ThreadManager` for now
- Reworking the overall thread operation model
- Removing every mention of environment kind from the product model

# Implementation Steps

1. Done: contain daemon-side workspace path usage inside the environment boundary

- `getWorkspaceRoot()` was renamed to `getWorkspaceRootUnsafe()`.
- Production daemon status/diff logic no longer uses raw workspace roots directly.
- `thread-git-status.ts` was deleted and its responsibilities moved behind `IEnvironment`.
- Provider launch now goes through `environment.spawn(...)`.
- `EnvironmentServices` now exists and is used for environment-owned event emission and LLM commit-message generation.

2. Done: move workspace status, diff, watch, and key workspace operations behind `IEnvironment`

- `IEnvironment` now owns:
  - `getWorkspaceStatus(...)`
  - `watchWorkspaceStatus(...)`
  - `getWorkspaceDiff(...)`
  - `commitWorkspace(...)`
  - `squashMergeIntoDefaultBranch(...)`
  - promotion/demotion support checks and operations
- The old attributed-diff fallback and persisted `agentDiffStats` path are gone, including DB columns.

3. Done: remove non-essential daemon transport leaks

- Provisioning/setup events no longer carry `workspaceRoot`.
- Provider thread context no longer carries `workspaceRoot`.
- Redundant provisioning `mode` metadata is gone.

4. In progress: replace client-side file opening based on `workspaceRoot`

- Add a daemon-backed thread file open action:
  - `POST /threads/:id/open-path`
  - `ThreadManager.resolveThreadOpenPath(...)`
- Route app file-opening flows through that API instead of joining `workspaceRoot` and relative file paths in the client.
- Remove `workspaceRoot` plumbing from:
  - `WorkspaceChangesList.tsx`
  - status popover/file list UI
  - thread diff file-opening UI

5. In progress: remove `workspaceRoot` from diff transport where it is no longer needed

- Remove `workspaceRoot` from `ThreadGitDiffResponse`.
- Update daemon route tests and app hooks/tests accordingly.
- Leave `ThreadWorkStatus.workspaceRoot` alone for now; it still powers some UI display/open behaviors and can be revisited separately.

6. In progress: stop reconstructing workspace paths from provisioning/setup messages

- Remove client-side reconstruction of setup script paths from `workspaceRoot`.
- Stop displaying raw workspace path rows in thread detail.
- Simplify provisioning message parsing so absolute workspace path tokens are ignored instead of surfaced as “output” or “additional details”.
- Keep setup-script opening only when the event already contains an absolute script path.

7. Next: clean up remaining app/UI path exposure

- Replace remaining `workspaceRoot`-based file-open and display behavior with server-backed actions or higher-level environment metadata.
- Audit:
  - `ThreadDetailView.tsx`
  - `WorkspaceChangesList.tsx`
  - `StatusPillCommitPopover.tsx`
  - `ConversationEntry.tsx`
- If we reintroduce “open workspace” later, do it as a daemon-backed action without exposing the raw path in UI copy.

8. Next: clean up remaining `"worktree"` branches outside `packages/environment`

- Keep punting on diff/status branches until the status/diff product surface settles.
- Continue replacing operation- or capability-shaped checks with environment methods where appropriate.
- Re-audit app/UI `"worktree"` branches after the path transport cleanup is done.

9. Next: add a regression suite for non-host environments

- Add a fake environment used in daemon/app integration tests that:
  - supports `run(...)`
  - does not expose a meaningful host-local path for direct file opening
  - can still provide status/diff/watch behavior
- Use it to catch future regressions where UI or daemon logic accidentally assumes host filesystem access.

# Validation

- `pnpm --filter @beanbag/environment typecheck`
- `pnpm --filter @beanbag/environment test`
- `pnpm --filter @beanbag/agent-core build`
- `pnpm --filter @beanbag/daemon typecheck`
- `pnpm --filter @beanbag/daemon test`
- `pnpm --filter @beanbag/app typecheck`
- `pnpm --filter @beanbag/app test`

# Open Questions/Risks

- `ThreadWorkStatus.workspaceRoot` still exists. It is now mostly a UI concern, but that also means it can still harden host-path assumptions into product behavior.
- Setup script opening is only safe when the event includes an already-absolute path. If we need that behavior for non-host environments later, it should become a daemon-backed action instead of a path reconstruction trick.
- Remaining `"worktree"` UI branches may end up changing shape once the app stops depending on raw workspace paths.
- The environment boundary is much stronger now, but `ThreadManager` is still large. That is intentionally deferred, not solved.
