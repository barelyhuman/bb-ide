# `host.read_file` — Read a Previewable File from the Host Filesystem (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts`
**Handler:** `apps/host-daemon/src/command-handlers/host-files.ts`
**Result Schema:** `packages/host-daemon-contract/src/commands.ts`
**Workspace Lane:** No

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"host.read_file"`. |
| `path` | Yes | Absolute host path to read. Relative paths are rejected before any filesystem access. |

**All 2 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"host.read_file"` and calls `readHostFile(command)`.
2. `readHostFile` rejects non-absolute paths with `CommandDispatchError("invalid_path")`.
3. `readHostFile` delegates to `readFileForTransport(command.path, command.path)`.
4. `readFileForTransport`:
   - `stat`s the path
   - rejects directories
   - infers `mimeType` from the file extension when possible
   - enforces attachment-aligned limits:
     - 10 MB for `image/*`
     - 25 MB for other files
   - reads the file bytes
   - returns UTF-8 text when the file is text-like or valid UTF-8
   - returns base64 when the file is binary or image content
5. Returns `{ path, content, contentEncoding, mimeType?, sizeBytes }`.

## Flags

1. **No root restriction beyond absolute paths.** The server can request any readable absolute path on the host. This is intentional for host-local manager workspace reads, but broader than `workspace.read_file`.
2. **Server-owned root selection is still the main safety boundary.** The daemon only requires an absolute path. The server currently uses this command for durable manager workspace files and `PREFERENCES.md`, not arbitrary client-supplied host paths.
3. **Symlinks are followed.** There is no containment check against `BB_DATA_DIR`; the resolved file is whatever the absolute path points to on disk.
4. **Transport is preview-oriented, not opaque streaming.** The full file is still loaded into memory and returned as either UTF-8 text or base64.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `resolveThreadRuntimeCommandConfig` | `apps/server/src/services/thread-runtime-config.ts` | Reads `PREFERENCES.md` from the manager workspace at `<dataDir>/workspace/<threadId>/PREFERENCES.md` |
| `GET /api/v1/threads/:id/manager-workspace/content` | `apps/server/src/routes/threads/data.ts` | Reads a durable manager workspace file for the manager workspace viewer |

---

## Updates

- March 30, 2026 investigation:
  1. `host.read_file` is still the daemon primitive for durable manager workspace file reads.
  2. `host.list_files` now exists as the companion browse primitive for the same durable manager workspace root.
  3. `host.read_file` and `workspace.read_file` now share `readFileForTransport`, so both commands support text previews, image previews, and attachment-aligned size limits.

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
