# Resolve project source by host, not just default

**Problem:** Five call sites use `getDefaultProjectSource(db, projectId)` when they already have a `hostId`. This means managed workspaces (worktree/clone), promote, demote, and manager instructions all silently assume every environment runs on the default source's host. A project with sources on multiple hosts will get 409 errors or wrong paths for any non-default host.

**Root cause:** No `getProjectSourceByHost(db, projectId, hostId)` query exists. The only available lookup is `getDefaultProjectSource`, so every caller uses it and either guards with a host mismatch check or ignores the mismatch.

## Changes

### 1. New DB query — `packages/db/src/data/project-sources.ts`

Add `getProjectSourceByHost(db, projectId, hostId)`:
- Query `project_sources WHERE projectId = ? AND hostId = ?`
- Hits the existing `project_sources_project_host_idx` unique index
- Returns `ProjectSource | null`
- Export from `packages/db/src/data/index.ts`
- Add test in `packages/db/test/data/project-sources.test.ts`

### 2. New server helper — `apps/server/src/services/thread-create-helpers.ts`

Replace `requireDefaultSource(deps, projectId)` with `requireSourceForHost(deps, projectId, hostId)`:
- Calls `getProjectSourceByHost(db, projectId, hostId)`
- If not found, throws `ApiError(409, "invalid_request", "No project source configured for this host")`
- Keep `requireDefaultSource` around — it's still correct for callers that don't have a host (managers, file listing)

### 3. Call site changes

| # | File | Line | Current | New |
|---|---|---|---|---|
| 1 | `thread-create.ts` | 247 | `requireDefaultSource(deps, projectId)` | `requireSourceForHost(deps, projectId, hostId)` |
| 2 | `environment-provisioning.ts` | 59-64 | `requireDefaultSource` + host mismatch guard | `requireSourceForHost(deps, projectId, args.environment.hostId)` — remove the `if (defaultSource.hostId !== ...)` block |
| 3 | `routes/environments.ts` | 171-173 | `getDefaultProjectSource` + `source.hostId !== environment.hostId` guard | `requireSourceForHost(deps, environment.projectId, environment.hostId)` — remove guard |
| 4 | `routes/environments.ts` | 196-204 | `getDefaultProjectSource` + combined guard (host mismatch OR missing branch) | `requireSourceForHost(deps, environment.projectId, environment.hostId)` — remove host/source checks from guard, **keep** the `!environment.branchName \|\| !actingThread.mergeBaseBranch` checks as a separate `if` block |
| 5 | `thread-runtime-config.ts` | 170-171 | `getDefaultProjectSource` for `projectRootPath` | `getProjectSourceByHost(db, projectId, args.environment.hostId)` — fall back to `workspacePath` as it already does when source is null |

### 4. Not changed

| File | Why |
|---|---|
| `routes/projects.ts:176` (file listing) | No `hostId` in request — default source is the correct semantic ("show me the project's files") |
| `routes/projects.ts:235` (managers) | No `hostId` in request — managers run on the default source by design. If managers ever gain host selection, `thread-runtime-config.ts` (item 5) already resolves correctly by then. |

### 5. Tests

- **`packages/db/test/data/project-sources.test.ts`**: Add test for `getProjectSourceByHost` — happy path + not-found.
- **`apps/server/test/public-threads.test.ts`**: Add a multi-host test case: create a project with sources on two hosts, create a managed-worktree thread targeting the non-default host, assert it succeeds and uses the correct source path.
- **`apps/server/test/public-thread-lifecycle-regressions.test.ts`**: Add regression test: thread on non-default host → promote → assert correct `primaryPath`.
- **`apps/server/test/internal-session.test.ts`** (or similar): Add test for manager `projectRootPath` resolution — verify that `resolveThreadRuntimeCommandConfig` uses the host's source path, not the default source path, when they differ.
- **`apps/server/test/public-threads.test.ts`**: Add negative test: thread creation targeting a host with no source → 409 `"No project source configured for this host"`.
- Existing tests continue to pass (single-host projects still resolve the same source, it's just looked up by host instead of by default flag).

## Exit criteria

1. `pnpm exec turbo run test --filter=@bb/db` passes with new `getProjectSourceByHost` tests.
2. `pnpm exec turbo run test --filter=@bb/server` passes — existing tests green, new multi-host tests green.
3. No remaining call sites that look up default source when a `hostId` is available (grep for `getDefaultProjectSource` — only `routes/projects.ts` and re-export should remain).
4. No `hostId` mismatch guard blocks remain in `environment-provisioning.ts` or `routes/environments.ts` — the query itself handles it.

## Validation

```bash
# Verify no stale references
grep -rn 'requireDefaultSource\|getDefaultProjectSource' apps/server/src/services/ apps/server/src/routes/

# Expected matches (all correct):
#   thread-create-helpers.ts — requireDefaultSource definition + its internal getDefaultProjectSource call (kept for host-less callers)
#   routes/projects.ts:176 — file listing (no hostId in request)
#   routes/projects.ts:235 — manager creation (no hostId in request)
# No other matches.
```
