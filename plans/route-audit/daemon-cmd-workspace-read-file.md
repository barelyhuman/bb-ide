# `workspace.read_file` — Read a Text File from a Workspace (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts`
**Handler:** `apps/host-daemon/src/command-handlers/workspace-files.ts`
**Result Schema:** `packages/host-daemon-contract/src/commands.ts`
**Workspace Lane:** Yes (serialized per environment via `requireWorkspaceEnvironment`)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"workspace.read_file"`. |
| `environmentId` | Yes | Identifies the workspace runtime entry. |
| `workspaceContext` | Yes | Supplies `workspacePath` and `workspaceProvisionType` so the daemon can rehydrate the workspace after restart. |
| `path` | Yes | Relative path inside the workspace. Absolute or escaping paths are rejected. |

**All 4 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"workspace.read_file"` and calls `readWorkspaceFile(command, runtimeManager)`.
2. `readWorkspaceFile` resolves the environment with `requireWorkspaceEnvironment(...)`.
3. It resolves `command.path` against the workspace root and rejects anything that escapes the workspace.
4. It delegates to `readTextFile(resolvedPath, command.path)`.
5. `readTextFile`:
   - `stat`s the file
   - rejects directories
   - rejects files larger than 10 MB
   - reads UTF-8 text
   - infers `mimeType` from the relative path when possible
6. Returns `{ path, content, mimeType? }`.

## Flags

1. **Text-only semantics.** Like `host.read_file`, this command is for UTF-8 text content, not arbitrary binary blobs.
2. **Path traversal is guarded in the daemon.** The handler rejects any path that escapes the workspace root before reading from disk.
3. **Result path is relative.** The response echoes the requested workspace-relative path, not the resolved absolute path.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `GET /api/v1/threads/:id/workspace/file` | `apps/server/src/routes/threads/data.ts` | Reads a single file from a thread workspace for the client |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
