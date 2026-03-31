# `host.list_files` — List Files Under an Absolute Host Root (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts`
**Handler:** `apps/host-daemon/src/command-handlers/host-files.ts`
**Result Schema:** `packages/host-daemon-contract/src/commands.ts`
**Workspace Lane:** No

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"host.list_files"`. |
| `path` | Yes | Absolute host directory to list. Relative paths are rejected before filesystem access. |
| `query` | No | Case-insensitive substring filter applied after enumeration. |
| `limit` | Yes | Positive integer max result count. Extra matches are truncated. |

**All 4 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"host.list_files"` and calls `listHostFiles(command)`.
2. `listHostFiles` rejects non-absolute paths with `CommandDispatchError("invalid_path")`.
3. It `stat`s `command.path` and rejects non-directories with `CommandDispatchError("invalid_path")`.
4. It calls `listFilesRecursively(command.path, command.path)`, which:
   - walks the directory tree recursively
   - skips dotfiles/directories
   - skips `node_modules`
   - returns workspace-relative file paths
5. It passes the results through `finalizeListedFiles(...)`, which:
   - filters by `query` when present
   - applies `limit`
   - sets `truncated`
   - maps each path to `{ path, name }`
6. Missing roots return `CommandDispatchError("ENOENT")`.

## Flags

1. **Not git-aware.** Unlike `workspace.list_files`, this command always walks the filesystem directly.
2. **No root restriction beyond absolute paths.** The server must choose a bounded root; the daemon does not enforce one.
3. **Hidden files are skipped structurally.** Any path segment starting with `.` is excluded because the recursive walker skips dot-prefixed entries entirely.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `GET /api/v1/threads/:id/manager-workspace/files` | `apps/server/src/routes/threads/data.ts` | Lists files from the durable manager workspace root `<dataDir>/workspace/<threadId>` |

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
