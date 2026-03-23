# Workspace & Host Design

Two cleanly separated concerns: **hosts** (machines) and **workspaces** (directories on those machines).

---

## The Split

| Concern | What it is | Where it runs | Package |
|---|---|---|---|
| **Hosts** | Machines that run environments. User's laptop, E2B sandbox, remote mac-mini. | Server orchestrates (creates/destroys/suspends cloud hosts). Daemon runs on each host. | Server-side code (no shared package) |
| **Workspaces** | Directories on a host. Git operations, provisioning (worktree/clone), setup scripts. | Host-daemon executes. | `@bb/workspace` |

The server never imports `@bb/workspace`. It sends commands to daemons. The daemon imports `@bb/workspace` and uses it when processing commands. E2B/cloud logic lives in the server — it's host orchestration, not workspace operations.

---

## `@bb/workspace` — Package Interface

Used by the host-daemon only.

### Workspace class

A `Workspace` instance represents a specific directory on this machine. Constructed with a path, provides getters for state and methods for git operations.

```typescript
class Workspace {
  readonly path: string;

  constructor(path: string);

  // --- Queries (getters) ---
  get exists(): Promise<boolean>;
  get isGitRepo(): Promise<boolean>;
  get currentBranch(): Promise<string | undefined>;   // undefined if not git or detached HEAD

  getStatus(): Promise<WorkspaceStatus>;
  getDiff(options: DiffOptions): Promise<DiffResult>;
  getBranches(): Promise<string[]>;

  // --- Mutations ---
  commit(options: { message: string; includeUnstaged?: boolean }): Promise<CommitResult>;
  reset(): Promise<void>;                              // discard all uncommitted changes
  fetch(options?: { remote?: string; branch?: string }): Promise<void>;
  checkpoint(options: { commitMessage: string; remoteName?: string }): Promise<CheckpointResult>;

  // --- Branch operations ---
  checkoutBranch(branchName: string): Promise<void>;
  detachHead(): Promise<void>;
  stash(message?: string): Promise<string | null>;     // returns stash ref, null if clean
  stashPop(ref?: string): Promise<void>;

  // --- Squash merge (uses temp worktree internally) ---
  squashMergeInto(options: { targetBranch: string; commitMessage: string }): Promise<SquashMergeResult>;
}
```

### Provisioning functions (standalone, not on Workspace)

These create or destroy workspaces. They don't operate on an existing workspace — they produce one.

```typescript
export function createWorktree(args: {
  sourcePath: string;       // project source path (where .git lives)
  targetPath: string;       // where to create the worktree
  branchName: string;       // branch to create
}): Promise<{ path: string }>;

export function createClone(args: {
  sourcePath: string;       // URL or local path to clone from
  targetPath: string;       // where to clone into
  branchName: string;       // branch to create after clone
}): Promise<{ path: string }>;

export function runSetupScript(args: {
  workspacePath: string;
  scriptName?: string;      // default: ".bb-env-setup.sh"
  timeoutMs?: number;       // default: 5 minutes
}): Promise<{ ran: boolean; exitCode?: number; output?: string }>;

export function removeWorktree(args: {
  path: string;
  force?: boolean;          // default: true
}): Promise<void>;

export function removeDirectory(args: {
  path: string;
}): Promise<void>;
```

### Design principles

- **Workspace is a directory.** The class represents one path. It knows how to query and mutate its own git state. It doesn't know about other workspaces, hosts, servers, or commands.
- **Provisioning is separate.** Creating/destroying workspaces is standalone functions — you can't call methods on a workspace that doesn't exist yet.
- **Branch operations are primitives.** `checkoutBranch`, `detachHead`, `stash`, `stashPop` are building blocks. The daemon composes them for higher-level operations like promote.
- **No host/server awareness.** The package is just git and filesystem operations.

---

## Promote — Server-Orchestrated, Not Workspace-Level

Promote is not a workspace operation. It's a **server-orchestrated operation between two host-daemons** (which may be the same machine or different machines).

### The model

When a user clicks "promote," the server coordinates between a **source** (the thread's environment) and a **target** (the user's primary checkout):

```
1. User clicks "promote" on a thread
2. Server identifies:
   - Source: thread's environment on host A
   - Target: user's primary checkout on host B (often same machine)
3. Server asks source daemon: "export this workspace's changeset"
   → Response: { type: "branch", branch: "bb/env-abc" }
              or { type: "branch", branch: "bb/env-abc", remote: "origin" }  (if cross-machine)
4. Server asks target daemon: "import this changeset into your primary checkout"
   → Target daemon uses Workspace primitives to apply it
```

### Why this model?

- **Same interface for local and cross-machine promote.** The server always does: export from source, import to target. When both daemons are on the same machine, the branch is already locally visible. When they're on different machines, the source pushes first.
- **No special "promote" function in `@bb/workspace`.** The daemon composes `Workspace` primitives (stash, checkoutBranch, detachHead) to implement the import.
- **Promoted state is derived.** The target daemon checks what branch the primary checkout is on. If it matches a known environment branch, that environment is "promoted."

### Commands

Two commands replace the old `workspace.promote` / `workspace.demote`:

```
workspace.export   // source daemon: get changeset description
workspace.import   // target daemon: apply changeset to primary checkout
```

### Export response shape (same for all cases)

```typescript
type WorkspaceExport =
  | { type: "branch"; branch: string }                      // local: branch visible via shared .git
  | { type: "branch"; branch: string; remote: string }      // remote: branch pushed to this remote
  // future: | { type: "patch"; diff: string }              // non-git or fallback
```

### Import flow (target daemon)

The target daemon receives a `workspace.import` command with the export data. It uses `Workspace` primitives:

```typescript
async function handleImport(primary: Workspace, exportData: WorkspaceExport) {
  // If branch needs fetching (cross-machine)
  if (exportData.remote) {
    await primary.fetch({ remote: exportData.remote, branch: exportData.branch });
  }

  // Stash any dirty work
  const stashRef = await primary.stash("bb-promote");

  // Switch to the source branch
  await primary.checkoutBranch(exportData.branch);

  return { previousBranch: original, stashRef };
}
```

### Demote flow (target daemon)

Server sends `workspace.import` with the original branch info to switch back:

```typescript
async function handleDemote(primary: Workspace, originalBranch: string, stashRef?: string) {
  await primary.checkoutBranch(originalBranch);
  if (stashRef) await primary.stashPop(stashRef);
}
```

### Local promote (same machine, shared .git)

```
Server → source daemon: workspace.export { envId }
Daemon → source workspace: detachHead() (free the branch)
Daemon → returns { type: "branch", branch: "bb/env-abc" }

Server → target daemon (same daemon): workspace.import { primaryPath, export: { type: "branch", branch: "bb/env-abc" } }
Daemon → primary workspace: stash() → checkoutBranch("bb/env-abc")
Daemon → returns { previousBranch: "main", stashRef: "abc123" }
```

### Cross-machine promote (E2B → local)

```
Server → source daemon (E2B): workspace.export { envId }
Daemon → source workspace: checkpoint() (commit + push to origin)
Daemon → returns { type: "branch", branch: "bb/env-abc", remote: "origin" }

Server → target daemon (local): workspace.import { primaryPath, export: { type: "branch", branch: "bb/env-abc", remote: "origin" } }
Daemon → primary workspace: fetch({ remote: "origin", branch: "bb/env-abc" }) → stash() → checkoutBranch("bb/env-abc")
Daemon → returns { previousBranch: "main", stashRef: "abc123" }
```

Same shape, same commands, different transport for the changeset.

---

## Command Set

17 commands total:

```
// Thread/provider (via @bb/agent-runtime)
thread.start, thread.resume, turn.run, turn.steer, thread.stop, thread.rename,
provider.list_models

// Environment lifecycle (provisioning via @bb/workspace, E2B via server)
environment.provision, environment.destroy

// Workspace — queries
workspace.status, workspace.diff

// Workspace — mutations
workspace.commit, workspace.squash_merge, workspace.reset, workspace.checkpoint

// Workspace — promote (server-orchestrated between two daemons)
workspace.export, workspace.import
```

All carry explicit parameters. Daemon never looks up metadata.

---

## Hosts — Server-Side Orchestration

Host lifecycle is managed by the server. No shared package — this is server application code.

### Host types

| Type | Created by | Lifecycle |
|---|---|---|
| **Persistent** (user's machine) | User starts daemon, auto-registers | Long-lived. Survives reboots. |
| **Ephemeral** (E2B sandbox) | Server calls E2B API | Created on demand. Suspended on idle. Destroyed on cleanup. |

### E2B host lifecycle

```
Server creates sandbox (E2B API)
  → Starts host-daemon inside sandbox
  → Daemon registers with server (ephemeral host)
  → Server sends environment.provision command (clone repo, setup)
  → Environment is ready, thread can start

Host idle (no active threads) for >15 min:
  → Server sends workspace.checkpoint command (commit + push branch)
  → Server suspends host (sandbox.pause())
  → Host status: suspended

New command for suspended host:
  → Server resumes host (Sandbox.resume() or recreate + clone from remote)
  → Daemon reconnects
  → Server delivers command

Thread archived / environment destroyed:
  → Server destroys host (sandbox.kill())
```

### Host statuses

```
connected → disconnected (WS drop + lease timeout)
connected → suspended (cloud only, idle timeout)
suspended → connected (resume on command)
```

`suspended` is a host status, not an environment status. The environment is still `ready` — the machine is paused.

---

## How Commands Flow

### Creating a thread with a new environment

**Existing path:**
```
App → POST /threads { path, hostId }
Server → creates environment record optimistically (status: ready), creates thread, queues thread.start
Daemon → runs thread.start; if path is bad, reports error
Server → if error: marks environment as error, thread as error
```

**Managed worktree:**
```
App → POST /threads { provisionerId: "worktree", hostId }
Server → creates environment record (status: provisioning), creates thread (status: provisioning)
Server → queues environment.provision command with { mode: "worktree", sourcePath, targetPath, branchName }
Daemon → calls createWorktree() + runSetupScript() from @bb/workspace
Daemon → reports command-result with { path, isGitRepo: true }
Server → updates environment (status: ready, path), transitions thread to idle
Server → queues thread.start if pending input
```

**E2B sandbox:**
```
App → POST /threads { provisionerId: "e2b" }
Server → calls E2B API to create sandbox (server-side)
Server → starts daemon inside sandbox, waits for registration
Server → creates host record (ephemeral), environment record (status: provisioning)
Server → queues environment.provision command to sandbox's daemon { mode: "clone", repoUrl, branchName }
Daemon (inside sandbox) → calls createClone() + runSetupScript() from @bb/workspace
Daemon → reports result
Server → updates environment (status: ready), queues thread.start
```

### Workspace operations

```
App → POST /environments/:id/actions { type: "commit", message: "fix bug" }
Server → resolves environment path from DB
Server → queues workspace.commit command { path, message, includeUnstaged: true }
Daemon → workspace.commit(options) on Workspace instance
Daemon → reports command-result with { sha, subject }
Server → creates system event, notifies app via WS
```

### Promote

```
App → POST /environments/:id/actions { type: "promote" }
Server → identifies source env (thread's host) and target (user's primary checkout host)
Server → queues workspace.export to source daemon
Source daemon → returns changeset { type: "branch", branch: "bb/env-abc" }
Server → queues workspace.import to target daemon with changeset + primaryPath
Target daemon → stash, checkout branch → returns { previousBranch, stashRef }
Server → stores promote state (previousBranch, stashRef) for demote
```

---

## Non-Git Environments

bb works with any directory. If the environment's `isGitRepo` is false:
- Thread runs normally — agent writes code, runs commands
- Server doesn't send workspace commands for non-git environments
- UI shows the thread without the git panel

---

## What Lives Where

| Code | Package/Location |
|---|---|
| `Workspace` class, provisioning functions | `@bb/workspace` |
| Promote/demote orchestration (export/import command handling) | `apps/host-daemon` (daemon composes Workspace primitives) |
| E2B sandbox create/suspend/resume/destroy | `apps/server` |
| Host registration, identity, heartbeat | `apps/host-daemon` |
| Command routing, AgentRuntime management | `apps/host-daemon` |
| Environment DB records, thread lifecycle, command queuing | `apps/server` |
| Workspace types (WorkspaceStatus, DiffResult, etc.) | `@bb/domain` |

---

## Appendix

### A. Squash-Merge Implementation

Git prevents checking out a branch already checked out in another worktree. `squashMergeInto` handles this with a temporary worktree:

```bash
git worktree add /tmp/bb-merge-<random> <targetBranch>
cd /tmp/bb-merge-<random>
git merge --squash <currentBranch>
git commit -m "<commitMessage>"
cd -
git worktree remove /tmp/bb-merge-<random>
```

### B. Git Worktree Constraints

- Two worktrees cannot check out the same branch
- Commits in worktree A visible in worktree B immediately (shared objects)
- Concurrent git operations in different worktrees are safe
- `git worktree remove` refuses with uncommitted changes (use `--force`)
- No practical worktree count limit
- `git gc` is worktree-aware

### C. E2B Patterns (from terragon)

**v1 cardinality: one sandbox = one host = one environment.** Idle detection is host-scoped.

- Blobless clone (`--filter=blob:none`) for speed
- Git credentials via `.git-credentials` file
- Sandbox timeout 15 min, extended on each event
- Checkpoint = commit + push before suspend
- Resume = `Sandbox.resume()` + refresh credentials
- If resume fails, recreate + clone from remote branch

### D. Environment Strategies Summary

| Strategy | Managed? | Provisioned by | `@bb/workspace` used for |
|---|---|---|---|
| Existing path | No | Server (optimistic) | `Workspace` git operations |
| Worktree | Yes | Daemon | `createWorktree`, `runSetupScript`, `removeWorktree`, `Workspace` operations |
| Clone | Yes | Daemon | `createClone`, `runSetupScript`, `removeDirectory`, `Workspace` operations |
| E2B sandbox | Yes | Server (host) + Daemon (workspace) | `createClone`, `runSetupScript`, `Workspace` operations, `checkpoint` |
