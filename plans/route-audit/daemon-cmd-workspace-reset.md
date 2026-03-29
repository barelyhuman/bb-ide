# `workspace.reset` — Discard all uncommitted changes (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:223-226`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:141-144` (inline in dispatch)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:327`
**Workspace Lane:** Yes (serialized per environment via `requireWorkspaceEnvironment`)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `environmentId` | Yes | Identifies the runtime entry. |
| `environmentStatus` | Yes | Must be `"ready"`. |
| `workspacePath` | Yes | Fallback for lazy provisioning. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"workspace.reset"`, calls `requireWorkspaceEnvironment`.
2. Calls `entry.workspace.reset()`.
   - `WorkspaceImpl.reset` delegates to `Workspace.reset`.
3. Inside `Workspace.reset` (workspace.ts:233-237):
   - `ensureGitRepo(this.path)`.
   - `git reset --hard HEAD` — discards all staged and unstaged changes to tracked files.
   - `git clean -fd` — removes untracked files and directories.
4. Returns `{}`.

## Code Reuse

- `requireWorkspaceEnvironment`, `ensureGitRepo`, `runGit` shared.

## Flags

None. Clean. The command is simple and correctly scoped. The JSDoc notes it is internal-only.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| _(none)_ | — | No server-side callers. Command is defined and handled but never queued. |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
