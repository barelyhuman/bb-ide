# Host Workspace / Watcher Split

Plan for replacing the current mixed `@bb/workspace` package boundary with three clearer roles:

- `@bb/host-workspace`
- `@bb/host-watcher`
- `@bb/host-daemon`

## Why

The current `@bb/workspace` package mixes multiple concerns:

- imperative workspace provisioning and git operations
- watcher implementation details
- watcher semantics that are not limited to workspaces
- low-level helper exports (`runGit`, `revParse`) that let daemon callers bypass the main abstraction

This makes the package boundary porous. The daemon uses `@bb/workspace` both as a real workspace abstraction and as a bag of escape hatches.

The goal of this split is to preserve the original good part of the package boundary, keeping low-level host workspace logic out of daemon orchestration, while giving watching its own explicit role.

## Target Ownership

### `@bb/host-workspace`

Owns imperative workspace operations:

- open/provision/reconnect/destroy workspace
- git-backed queries and mutations on a workspace
- promote/demote operations
- `HostWorkspace` interface and `WorkspaceError`

Must not own:

- filesystem watching
- daemon lifecycle/orchestration
- session/runtime/thread/environment policy

### `@bb/host-watcher`

Owns observation and interpretation of host filesystem changes:

- native watcher loading and fallback behavior
- watch retry / debounce / max-wait / error normalization
- workspace watch semantics
- thread storage watch semantics
- typed host-local observed change events

Must not own:

- command dispatch
- runtime/session/environment lifecycle
- server transport / websocket reporting
- thread activity policy beyond inputs provided by the daemon

### `@bb/host-daemon`

Owns orchestration, lifecycle, and forwarding observed changes:

- command dispatch
- runtime/session/thread/environment orchestration
- event reporting to server
- deciding when watchers should start/stop
- providing host-specific context to `@bb/host-watcher`

Must not own:

- raw git execution helpers
- direct `@parcel/watcher` usage

## Boundary Rules

- `@bb/host-daemon` may depend on `@bb/host-workspace` and `@bb/host-watcher`.
- `@bb/host-watcher` may depend on `@bb/domain` and `@parcel/watcher`, but not on `@bb/host-daemon`.
- `@bb/host-workspace` may depend on `@bb/domain`, filesystem, and git, but not on `@bb/host-daemon`.
- `@bb/host-daemon` should not import low-level git helpers such as `runGit` or `revParse`.
- If daemon code needs new workspace behavior, add a method to `HostWorkspace` instead of exporting another low-level helper.

## Proposed External APIs

### `@bb/host-workspace`

```ts
export interface HostWorkspace {
  readonly path: string;
  readonly managed: boolean;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getStatus(args?: { mergeBaseBranch?: string }): Promise<WorkspaceStatus>;
  getDiff(args?: {
    target?: WorkspaceDiffTarget;
    maxDiffBytes?: number;
    maxFileListBytes?: number;
  }): Promise<ThreadGitDiffResponse>;
  listBranches(): Promise<string[]>;
  listFiles(args?: {
    limit?: number;
    query?: string;
  }): Promise<string[]>;

  commit(args: { message: string; noVerify: boolean }): Promise<CommitResult>;
  reset(): Promise<void>;
  fetch(args?: { remote?: string; branch?: string }): Promise<void>;
  squashMerge(args: {
    targetBranch: string;
    commitMessage: string;
  }): Promise<SquashMergeResult>;

  promote(args: { primary: HostWorkspace }): Promise<void>;
  demote(args: {
    primary: HostWorkspace;
    defaultBranch: string;
    envBranch?: string;
  }): Promise<void>;

  destroy(): Promise<void>;
}

export type ProvisionWorkspaceArgs =
  | { workspaceProvisionType: "unmanaged"; path: string; onProgress?: ProgressCallback }
  | {
      workspaceProvisionType: "managed-worktree";
      sourcePath: string;
      targetPath: string;
      branchName: string;
      scriptName: string;
      timeoutMs: number;
      onProgress?: ProgressCallback;
    }
  | {
      workspaceProvisionType: "managed-clone";
      sourcePath: string;
      targetPath: string;
      branchName: string;
      scriptName: string;
      timeoutMs: number;
      onProgress?: ProgressCallback;
    }
  | { workspaceProvisionType: "reconnect-managed-worktree"; path: string; onProgress?: ProgressCallback }
  | { workspaceProvisionType: "reconnect-managed-clone"; path: string; onProgress?: ProgressCallback };

export function openWorkspace(args: { path: string }): Promise<HostWorkspace>;
export function provisionWorkspace(args: ProvisionWorkspaceArgs): Promise<HostWorkspace>;
export class WorkspaceError extends Error {
  readonly code: string;
}
```

Notes:

- `runGit`, `revParse`, and other low-level helpers should become internal.
- `listFiles()` and `getHeadSha()` are added specifically to remove current daemon escape hatches.

### `@bb/host-watcher`

```ts
export type HostObservedChange =
  | { kind: "workspace-status-changed"; environmentId: string }
  | { kind: "thread-storage-changed"; environmentId: string; threadId: string };

export type HostWatchError =
  | {
      kind: "workspace-watch-error";
      environmentId: string;
      rootPath: string;
      message: string;
    }
  | {
      kind: "thread-storage-watch-error";
      rootPath: string;
      message: string;
      environmentId?: string;
      threadId?: string;
    };

export interface HostWatcher {
  watchWorkspace(args: {
    environmentId: string;
    workspacePath: string;
    onChange: (event: HostObservedChange) => void;
    onError: (error: HostWatchError) => void;
  }): () => void;

  watchThreadStorageRoot(args: {
    threadStorageRootPath: string;
    resolveThreadTarget: (
      threadId: string,
    ) => { environmentId: string; threadId: string } | null;
    onChange: (event: HostObservedChange) => void;
    onError: (error: HostWatchError) => void;
  }): () => void;
}

export async function createHostWatcher(args: {
  hostType: HostType;
}): Promise<HostWatcher | undefined>;
```

Notes:

- `createHostWatcher` owns lazy native watcher loading and ephemeral-host fallback.
- `watchThreadStorageRoot` should watch a shared root once, not one watcher per thread path.
- `@bb/host-watcher` emits host-local observed events, not server websocket payloads.

## Code Movement

### Move to `@bb/host-workspace`

Current files:

- `packages/workspace/src/git.ts`
- `packages/workspace/src/workspace.ts`
- `packages/workspace/src/provision.ts`
- `packages/workspace/src/provisioning.ts`
- `packages/workspace/src/promote.ts`

Tests to move/split:

- `packages/workspace/test/git.test.ts`
- `packages/workspace/test/promote.test.ts`
- `packages/workspace/test/provision.test.ts`
- `packages/workspace/test/provisioning.test.ts`

### Move to `@bb/host-watcher`

Current files:

- `packages/workspace/src/watch-callback-scheduler.ts`
- `packages/workspace/src/watch-path.ts`
- `packages/workspace/src/watch-specs.ts`
- `packages/workspace/src/watch-status-types.ts`
- `packages/workspace/src/watch-status.ts`
- `packages/workspace/src/workspace-status-watcher.ts`

Tests to move/split:

- watcher-specific portions of `packages/workspace/test/workspace.test.ts`

### Remove or rewrite in `@bb/host-daemon`

- `apps/host-daemon/src/workspace-status-watch.ts`
  This logic should move into `@bb/host-watcher` as `createHostWatcher(...)`.

- `apps/host-daemon/src/command-handlers/workspace-files.ts`
  Stop importing `runGit`; use `HostWorkspace.listFiles(...)`.

- `apps/host-daemon/src/command-handlers/environment.ts`
  Stop importing `revParse`; use `HostWorkspace.getHeadSha()`.

- `apps/host-daemon/src/runtime-manager.ts`
  Stop accepting raw watch functions. Accept `HostWatcher | undefined` and use it to attach environment and thread storage watches.

- `apps/host-daemon/src/app.ts`
  Map `HostObservedChange` events to current daemon environment-change reporting.

- `apps/host-daemon/src/start-host-daemon.ts`
  Resolve a `HostWatcher` instance once, not individual watch functions.

## Implementation Phases

### Phase 1. Create `@bb/host-workspace`

- Create the new package with current workspace engine code.
- Keep the existing `@bb/workspace` package temporarily as a compatibility shim if needed during migration.
- Rename the main interface from `IWorkspace` to `HostWorkspace`.
- Add `getHeadSha()` and `listFiles()` so daemon code can stop importing raw helpers.

### Phase 2. Migrate daemon workspace callers

- Update host-daemon imports from `@bb/workspace` to `@bb/host-workspace`.
- Remove daemon imports of `runGit` and `revParse`.
- Update tests and aliases accordingly.

### Phase 3. Create `@bb/host-watcher`

- Move watcher internals out of `@bb/workspace`.
- Replace the raw watch function exports with a `HostWatcher` service API.
- Move lazy native-addon resolution and host-type fallback into `createHostWatcher(...)`.

### Phase 4. Migrate daemon watcher callers

- Update `RuntimeManager` to depend on `HostWatcher`.
- Replace per-thread-path watching with a shared thread storage root watcher if that simplification is still desired.
- Keep daemon ownership of when watchers are attached, detached, or ignored.

### Phase 5. Remove compatibility shims

- Delete obsolete `@bb/workspace` watcher exports.
- Remove any temporary re-exports or aliases.
- Update plan and architecture docs if needed.

## Open Design Decisions

### 1. Rename vs compatibility shim

Preferred end state:

- `@bb/workspace` is removed or retired.
- `@bb/host-workspace` and `@bb/host-watcher` are the only host-local packages.

Migration option:

- keep `@bb/workspace` as a temporary shim while imports are moved
- delete the shim before calling the refactor complete

### 2. Scope of `HostWatcher`

Preferred scope:

- it knows host-local filesystem semantics
- it emits typed host-local change events

Rejected scope:

- thin wrapper around `@parcel/watcher` only

### 3. Thread storage ownership

For now:

- thread storage lifecycle and active-thread policy stay in `@bb/host-daemon`
- thread storage watch mechanics and event classification move to `@bb/host-watcher`

Future option:

- break thread storage into its own package only if it grows beyond daemon-specific policy

## Exit Criteria

- `@bb/host-workspace` exists and owns all imperative workspace operations now living in `@bb/workspace`.
- `@bb/host-watcher` exists and owns watch loading, retry/debounce/error handling, and host-local change classification.
- `@bb/host-daemon` no longer imports low-level git helpers or raw watch helpers.
- `apps/host-daemon/src/workspace-status-watch.ts` is removed.
- Workspace command handlers use `HostWorkspace` methods instead of `runGit` / `revParse`.
- Daemon watcher wiring uses a `HostWatcher` service instance instead of passing raw watch functions around.
- Thread storage watching still works after the split.
- Workspace status watching still works after the split.
- Temporary compatibility shims, if introduced, are removed before completion.

## Validation

Run:

```bash
pnpm exec turbo run typecheck test --filter=@bb/host-daemon --filter=@bb/host-workspace --filter=@bb/host-watcher --filter=@bb/host-daemon-contract --filter=@bb/domain
```

Update or add tests that verify:

- `@bb/host-workspace` provisions unmanaged, worktree, and clone workspaces correctly.
- `HostWorkspace.getHeadSha()` and `HostWorkspace.listFiles()` cover the current daemon use cases.
- `@bb/host-watcher` emits `workspace-status-changed` for workspace file/git metadata changes.
- `@bb/host-watcher` emits `thread-storage-changed` for thread storage create/update/delete events.
- `createHostWatcher({ hostType: "ephemeral" })` preserves the current no-native-watcher behavior.
- `RuntimeManager` still attaches workspace watchers and forwards thread storage changes correctly.
- `apps/host-daemon` no longer imports `runGit`, `revParse`, or `@parcel/watcher` directly.
