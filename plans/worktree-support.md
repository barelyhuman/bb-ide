# Worktree Support Plan

## Goal
Add first-class Git worktree support so Beanbag users can spin up branch-isolated workspaces and run normal thread workflows in each workspace without cloning whole repos.

## Scope
MVP scope:
- Create a worktree from an existing project.
- Represent worktrees as first-class projects in the data model.
- Run threads in worktree paths using existing thread lifecycle code.
- Show worktrees grouped under their parent project in the web sidebar.
- Remove a managed worktree safely from both Git and Beanbag metadata.

Out of scope for MVP:
- Patch/apply-to-parent workflow.
- Upstream branch rename/push orchestration.
- Creating worktrees from worktrees (nested worktrees).

## Current State (Relevant Baseline)
- Projects are flat and only store `id`, `name`, `rootPath` (`packages/db/src/schema.ts`).
- Thread execution already keys off `project.rootPath` (`apps/daemon/src/thread-manager.ts`), which means worktrees can reuse the existing thread runtime with no special thread logic.
- Project API only supports create/list (`apps/daemon/src/routes/projects.ts`).
- Web project UX is flat and sidebar-centric (`apps/web/src/components/layout/ProjectList.tsx`).
- WS invalidation currently supports only `thread` entity (`packages/core/src/protocol.ts`, `apps/web/src/hooks/useWebSocket.ts`).

## Architecture Decision
Model a worktree as a specialized project row rather than inventing a new top-level entity.

Recommended `projects` extensions:
- `kind`: `"main" | "worktree"` (default `"main"`).
- `parent_project_id`: nullable FK to `projects.id`.
- `worktree_branch`: nullable branch name (set for worktrees).

Why this shape:
- Reuses existing thread/project relationships and UI routing.
- Keeps `threads.project_id` unchanged.
- Allows mixed lists and easy parent-child grouping.

## Backend Plan

### Phase 1: Shared Contracts + DB Schema
1. Update core types/schemas:
- Extend `Project` type with `kind`, `parentProjectId`, `worktreeBranch`.
- Add `createWorktreeSchema`.
- Export new API request/response types in `@beanbag/core`.

2. Add SQL migration(s):
- Alter `projects` table with new columns.
- Add index on `(parent_project_id, updated_at)` for grouped listing.
- Optional guard index on `root_path` if we want to prevent duplicate paths.

3. Update DB repository mapping:
- Read/write new project fields in `ProjectRepository`.
- Add repository helpers:
  - `createWorktreeProject(...)`
  - `listByParent(parentProjectId)`
  - `deleteProject(id)` with safety checks for child worktrees.

### Phase 2: Git Worktree Service in Daemon
Add a dedicated module, e.g. `apps/daemon/src/git-worktree-service.ts`, that owns shelling out to Git.

Core operations:
- `createWorktree(parentRootPath, branch, options)`
  - Verify repo validity (`git rev-parse --show-toplevel`).
  - Resolve target folder under managed area (recommended: `~/.beanbag/worktrees/<parentProjectId>/<slug>`).
  - Handle branch existence:
    - existing local branch: `git worktree add <path> <branch>`
    - missing branch: `git worktree add -b <branch> <path>`
- `removeWorktree(parentRootPath, worktreePath)`
  - `git worktree remove --force <path>`
  - `git worktree prune --expire now`
  - fallback filesystem cleanup on stale metadata errors.

Important safety rules:
- Reject creation when parent project is already a worktree.
- Reject empty/invalid branch names.
- Never execute in arbitrary directories; always use parent project root.

### Phase 3: API Surface
Add project-scoped worktree endpoints:
- `POST /api/v1/projects/:id/worktrees`
  - body: `{ branch: string, name?: string }`
  - result: created worktree project object.
- `DELETE /api/v1/projects/:parentId/worktrees/:worktreeId`
  - only for `kind=worktree`.
  - fails if active thread exists unless `force=true` policy is explicitly added.
- Optional helper endpoint:
  - `GET /api/v1/projects/:id/branches` for branch suggestions in UI.

Route wiring:
- Extend `apps/daemon/src/routes/projects.ts`.
- Keep thread routes unchanged.

### Phase 4: Realtime Invalidation
Add `project` entity to WS protocol and clients:
- Extend `packages/core/src/protocol.ts`.
- Broadcast `project` changes from create/delete worktree paths.
- Update web websocket hook to subscribe to `project` and invalidate `["projects"]`.

## Web Plan

### Phase 5: Sidebar + Create Flow
1. API/hook updates:
- Add `createWorktree`, `deleteWorktree` client functions in `apps/web/src/lib/api.ts`.
- Add matching React Query mutations in `apps/web/src/hooks/useApi.ts`.

2. UI additions:
- Add “New worktree” action on project rows in `ProjectList`.
- Modal or inline prompt for branch + optional display name.
- Render worktrees nested under parent projects.
- Show a small `worktree` badge/icon and branch label.

3. Deletion UX:
- Add delete action for worktree rows with confirmation dialog.
- On success, clear navigation if deleted project/thread is currently selected.

## CLI Plan

### Phase 6: CLI Coverage (Recommended)
Introduce project commands (or extend existing command groups):
- `bb project list`
- `bb project create --path <path> [--name <name>]`
- `bb project worktree create --project <id> --branch <branch> [--name <name>]`
- `bb project worktree remove --project <parentId> --worktree <id>`

This keeps daemon, web, and CLI feature parity and simplifies testing/automation.

## Testing Plan

Daemon/backend:
- Route tests for create/remove worktree paths (`apps/daemon/src/__tests__/routes/projects.test.ts`).
- Service tests for git command sequencing and error handling in `git-worktree-service`.
- ThreadManager regression test: spawning a thread in a worktree project uses worktree `rootPath`.
- Repository tests for new project fields and parent-child queries.

Web:
- `ProjectList` tests for nested rendering and badges.
- Create/delete worktree mutation tests (query invalidation + navigation behavior).

CLI:
- Command argument + payload tests for new worktree commands.

Migration:
- Fresh DB bootstrap test.
- Existing DB upgrade test that verifies new `projects` columns are available.

## Rollout Order
1. Contracts + schema migration.
2. Daemon git-worktree service + API endpoints.
3. Web create/delete UX + project nesting.
4. WS project invalidation.
5. CLI commands.
6. Hardening pass (edge cases and DX polish).

## Success Criteria
- User can create a worktree from a project and immediately start a thread in it.
- Worktree projects appear clearly nested under parent projects in UI.
- Removing a worktree cleans up Git worktree metadata and Beanbag DB records.
- Existing thread behavior remains unchanged for non-worktree projects.
- Tests cover create/remove happy path and key failure modes.

## Open Questions
- Managed location default: `~/.beanbag/worktrees/...` vs `<repo>/.beanbag-worktrees/...`.
- Deletion policy when a worktree has non-archived threads (hard fail vs forced cleanup).
- Whether to include branch suggestion endpoint in MVP or defer to manual branch input.
