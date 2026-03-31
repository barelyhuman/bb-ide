# `workspace.read_file` — Read a Previewable File from a Workspace (Host-Daemon Command)

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
4. It delegates to `readFileForTransport({ resolvedPath, resultPath: command.path })`.
5. `readFileForTransport`:
   - `stat`s the file
   - rejects directories
   - infers `mimeType` from the relative path when possible
   - enforces attachment-aligned limits:
     - 10 MB for binary `image/*`
     - 25 MB for other files
   - reads the file bytes
   - returns UTF-8 text only when the bytes are valid UTF-8
   - returns base64 when the file is binary or image content
6. Returns `{ path, content, contentEncoding, mimeType?, sizeBytes }`.

## Flags

1. **Path traversal is guarded in the daemon.** The handler rejects any path that escapes the workspace root before reading from disk.
2. **Result path is relative.** The response echoes the requested workspace-relative path, not the resolved absolute path.
3. **No current product caller.** The public thread workspace read routes were removed when the manager viewer moved to durable manager-workspace routes backed by `host.read_file`.
4. **Still useful as a workspace-scoped primitive.** The command remains narrower than `host.read_file` because it is rooted to an environment workspace and cannot address arbitrary host paths.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| None (current product routes) | — | `GET /api/v1/threads/:id/workspace/file` was removed once the manager viewer moved to durable manager-workspace routes |

---

## Updates

- March 30, 2026 investigation:
  1. The public thread workspace file route has been removed.
  2. Manager workspace browsing now uses `host.read_file` against the durable manager workspace root `<dataDir>/workspace/<threadId>`.
  3. `workspace.read_file` still shares the same previewable-file behavior as `host.read_file`, so if a workspace-scoped caller is added later it will already support text/image handling and attachment-aligned file limits.

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
