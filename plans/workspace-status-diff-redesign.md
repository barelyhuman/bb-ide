# Plan: Redesign workspace.status and workspace.diff Commands

## Motivation

The current `workspace.status` and `workspace.diff` daemon commands conflate multiple concerns:
- `workspace.status` mixes working tree state with branch-relative state and requires `mergeBaseBranch` even when the caller only wants dirty/clean info.
- `workspace.diff` auto-detects what to show (uncommitted vs branch changes) via a confusing `mode` field, uses a `selection` discriminated union that doesn't map clearly to user intent, and bundles a commit list that belongs on status.
- The naming (`local_uncommitted`, `worktree_commits`, `combined`) is unclear.

## Exit Criteria

- `workspace.status` response grouped under clear keys (`workingTree`, `branch`, `mergeBase`)
- `workspace.status` returns commit list only when `mergeBaseBranch` is provided; `mergeBase: null` when omitted
- `workspace.diff` target is an explicit discriminated union (`uncommitted`, `branch_committed`, `all`, `commit`)
- `workspace.diff` response is purely diff content — no commit list, no mode field
- `mergeBaseBranch` optional on `workspace.status` — when omitted, daemon skips merge base resolution entirely (no default fallback)
- Server always passes `mergeBaseBranch` explicitly when it needs branch-relative info (server owns policy, daemon owns execution)
- All existing callers updated (UI status panel, UI diff panel, commit action, squash merge action, archive check, CLI)
- All builds and tests pass

---

## workspace.status

### Command Schema

```typescript
workspaceStatusCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.status"),
  mergeBaseBranch: z.string().min(1).optional(),
});
```

`mergeBaseBranch` is optional. When omitted, the daemon **skips merge base resolution entirely** — no ahead/behind counts, no commit list, no `readDefaultBranch()` fallback. The server decides whether to pass it based on the use case. This follows AGENTS.md: "The server owns product policy; the daemon owns execution."

### Response Schema

Named schemas extracted per AGENTS.md type safety rules:

```typescript
const workspaceFileStatusSchema = z.object({
  path: z.string(),
  status: workspaceFileStatusKindSchema,  // z.enum(["M", "A", "D", "R", "C", "U", "??"])
});

const workspaceCommitSummarySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  authorName: z.string(),   // required — git commits always have an author
  authoredAt: z.number(),   // required — git commits always have a date
});

workspaceStatusResultSchema = z.object({
  workingTree: z.object({
    hasUncommittedChanges: z.boolean(),
    state: workspaceStateSchema,  // z.enum(["clean", "dirty_uncommitted", "untracked", "deleted", ...])
    changedFiles: z.number(),
    insertions: z.number(),
    deletions: z.number(),
    files: z.array(workspaceFileStatusSchema),
  }),
  branch: z.object({
    currentBranch: z.string().nullable(),
    defaultBranch: z.string(),
  }),
  mergeBase: z.object({
    mergeBaseBranch: z.string(),
    baseRef: z.string().nullable(),
    aheadCount: z.number(),
    behindCount: z.number(),
    hasCommittedUnmergedChanges: z.boolean(),
    commits: z.array(workspaceCommitSummarySchema),
  }).nullable(),  // null when mergeBaseBranch was not provided
});
```

### Fields explicitly dropped from current response
- `workspaceChangedFiles`, `workspaceInsertions`, `workspaceDeletions` — duplicates of `changedFiles`, `insertions`, `deletions`
- `mergeBaseBranches` — stays on the separate `GET /environments/:id/diff/branches` route (loaded lazily by the branch picker UI)

### Fields preserved
- `state` — the computed enum (`clean`, `dirty_uncommitted`, etc.) — used by UI status panel

### Callers

| Caller | Passes mergeBaseBranch? | What it reads |
|---|---|---|
| `GET /environments/:id/status` (UI) | Yes — from client query | Everything |
| Commit action preflight | No | `workingTree.hasUncommittedChanges` |
| Squash merge preflight | No | `workingTree.hasUncommittedChanges` |
| Archive pre-check | Yes — `thread.mergeBaseBranch ?? environment.defaultBranch` | `workingTree` + `mergeBase` |

---

## workspace.diff

### Command Schema

```typescript
const workspaceDiffTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }),
  z.object({
    type: z.literal("branch_committed"),
    mergeBaseBranch: z.string().min(1),
  }),
  z.object({
    type: z.literal("all"),
    mergeBaseBranch: z.string().min(1),
  }),
  z.object({
    type: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/i),  // hex-validated to prevent git command injection
  }),
]);

workspaceDiffCommandSchema = hostDaemonWorkspaceTargetSchema.extend({
  type: z.literal("workspace.diff"),
  target: workspaceDiffTargetSchema,
});
```

Replaces the current `selection` + `mergeBaseBranch` fields with a single `target` discriminated union.

### Target semantics

| Target | Git command | Use case |
|---|---|---|
| `uncommitted` | `git diff HEAD --` | Commit action AI context |
| `branch_committed` | `git diff <mergeBase>..HEAD` | Squash merge AI context |
| `all` | `git diff <mergeBase>` | UI diff panel "all changes" (uncommitted + committed vs base) |
| `commit` | `git show <sha>` | UI diff panel specific commit view |

### Response Schema

```typescript
workspaceDiffResultSchema = z.object({
  diff: z.string(),
  truncated: z.boolean(),
  shortstat: z.string(),   // git diff --shortstat output (for AI commit message context)
  files: z.string(),       // git diff --name-status output (for AI commit message context)
});
```

`shortstat` and `files` are raw git output strings used by the AI commit message template. They differ from `workingTree.files` on the status response: status files are structured objects from `git status --porcelain` (working tree state), while diff files are from `git diff --name-status` (diff-specific, includes rename detection).

### Removed from current response
- `mode` (`local_uncommitted` / `worktree_commits`) — caller already knows what it asked for
- `commits` — moved to `workspace.status` response under `mergeBase`
- `currentBranch`, `mergeBaseBranch`, `mergeBaseRef`, `selection` — metadata that belongs on status

### Callers

| Caller | Target | Notes |
|---|---|---|
| `GET /environments/:id/diff` (UI) | `all` or `commit` — see UI section below | |
| Commit action AI context | `{ type: "uncommitted" }` | No merge base needed |
| Squash merge AI context | `{ type: "branch_committed", mergeBaseBranch: targetBranch }` | |
| CLI `bb thread show --git-diff` | `all` or `commit` — mapped from query params | Reads diff string only |

---

## Server Route Changes

### `GET /environments/:id/status`
- Pass `mergeBaseBranch` from client query (same as today)
- Update `environmentStatusQuerySchema` to make `mergeBaseBranch` optional (currently required)
- Response shape changes: group under `workingTree`, `branch`, `mergeBase`

### `GET /environments/:id/diff`
- Replace `environmentDiffQuerySchema`:
  - Remove `selection` (`combined` | `commit`) and `commitSha` query params
  - Add `target` query param: `uncommitted`, `branch_committed`, `all`, or `commit`
  - Add `sha` query param (required when `target=commit`)
  - `mergeBaseBranch` required when `target` is `branch_committed` or `all`, not accepted for `uncommitted` or `commit`
- Response: return diff content (`diff`, `truncated`, `shortstat`, `files`)
- App and CLI callers updated to use new query params

### `GET /environments/:id/diff/branches`
- No change — stays as a separate route for lazy-loading the branch picker

### Commit action
- Status: `workspace.status` with no `mergeBaseBranch` → check `workingTree.hasUncommittedChanges`
- If clean → return early (409)
- Diff: `workspace.diff` with `{ type: "uncommitted" }` → feed to AI commit message generation
- Commit: `workspace.commit` with generated message

### Squash merge action
- Status: `workspace.status` with no `mergeBaseBranch` → check `workingTree.hasUncommittedChanges`
- If dirty → commit with pre-merge message first
- Read `currentBranch` from `status.branch.currentBranch` (not from diff response — diff no longer returns it)
- Diff: `workspace.diff` with `{ type: "branch_committed", mergeBaseBranch: targetBranch }` → feed to AI
- Squash merge with generated message

### Archive check
- Status: `workspace.status` with `mergeBaseBranch: thread.mergeBaseBranch ?? environment.defaultBranch`
- Check both `workingTree` and `mergeBase`

---

## App/UI Changes

### Status hook (`useEnvironmentWorkStatus`)
- Update to consume the grouped response shape
- Commit dropdown reads `status.mergeBase?.commits` instead of `diff.commits`

### Diff hook (`useEnvironmentGitDiff`)
- Determine `target` based on user selection:
  - No commit selected: `{ type: "all", mergeBaseBranch }`
  - Commit selected: `{ type: "commit", sha }`
- Response no longer has `mode`, `commits`, `currentBranch` etc — pure diff content
- `selection` tracking stays client-side (already tracks `selectedGitDiffCommitSha` locally)

### Diff panel (`useGitDiffPanel`)
- Commit dropdown populated from status response (`mergeBase?.commits`), not diff response
- Remove `mode === "worktree_commits"` checks — dropdown available when `mergeBase?.commits.length > 0`

---

## CLI Changes

`bb thread show --work-status` and `bb thread show --git-diff` read from the server routes. Fields being removed from the diff response (`mode`, `currentBranch`, `mergeBaseBranch`, `commits`) need alternative sourcing:
- `currentBranch` and `mergeBaseBranch`: read from the status response (CLI already fetches status for `--work-status`)
- `mode`: remove from CLI output (it was an internal implementation detail)
- `commits`: read from status response if needed for display

---

## Domain Type Changes

- Remove `threadGitDiffModeSchema` (`local_uncommitted` / `worktree_commits`)
- Remove `threadGitDiffSelectionSchema` (`combined` / `commit`)
- Add `workspaceDiffTargetSchema` (the new discriminated union)
- Add `workspaceFileStatusKindSchema`, `workspaceFileStatusSchema`, `workspaceCommitSummarySchema`, `workspaceStateSchema` as named schemas
- Update `threadGitDiffResponseSchema` to the new slim diff-only shape
- Update workspace status response schema to the grouped structure
- Search project-wide for all removed type names in variables, functions, query keys, constants — clean up stale identifiers

---

## Implementation Order

1. **Domain types**: Define new schemas (can coexist with old ones temporarily).
2. **Workspace package**: Update `getStatus()` to return grouped shape + conditional commits. Update `getDiff()` to accept `target` instead of `selection` + `mergeBaseBranch`.
3. **Host daemon contract**: Update command + result schemas.
4. **Daemon dispatch**: Wire through new shapes.
5. **Server routes**: Update status, diff, commit, squash merge, archive handlers.
6. **Server contract / public API**: Update query params and response types. Public API changes to match the new target model.
7. **App**: Update hooks, API wrappers, diff panel.
8. **CLI**: Update diff/status consumers.
9. **Tests**: Update all mocks and assertions.
10. **Cleanup**: Search for stale identifiers from removed types.

Note: Steps 1-6 will break the build until completed together. No safe intermediate commit point between them.

## Test Plan

- **Workspace unit tests**: `getStatus()` with and without `mergeBaseBranch` — verify `mergeBase` is null when omitted. `getDiff()` for each target type.
- **Contract tests**: Verify daemon command/response schemas parse correctly for all variants.
- **Server route tests**: Status with/without mergeBaseBranch. Diff with each target type. Commit action on clean/dirty workspace. Squash merge with dirty state.
- **Integration tests**: End-to-end commit and squash merge flows.
- **CLI tests**: `--work-status` and `--git-diff` output with new response shapes.
- **Stale identifier check**: Grep for removed schema/type names across entire codebase.

## Validation

```bash
pnpm exec turbo run build test --force
```
