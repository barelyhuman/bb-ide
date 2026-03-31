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
| `rootPath` | Yes | Absolute containment root. The daemon resolves symlinks and rejects reads whose real path escapes this root. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"host.read_file"` and calls `readHostFile(command)`.
2. `readHostFile` rejects non-absolute `path` values and non-absolute `rootPath` values with `CommandDispatchError("invalid_path")`.
3. `readHostFile` delegates to `readFileForTransport({ resolvedPath, resultPath, rootPath })`.
4. `readFileForTransport`:
   - resolves symlinks for both `rootPath` and `resolvedPath` and rejects files whose real path escapes the root
   - `stat`s the path
   - rejects directories
   - infers `mimeType` from the file extension when possible
   - enforces attachment-aligned limits:
     - 10 MB for binary `image/*`
     - 25 MB for other files
   - reads the file bytes
   - returns UTF-8 text only when the bytes are valid UTF-8
   - returns base64 when the file is binary or image content
5. Returns `{ path, content, contentEncoding, mimeType?, sizeBytes }`.

## Flags

1. **Containment is always enforced.** Callers must declare the absolute root that bounds the read, and the daemon checks the symlink-resolved file against that root.
2. **Current server callers both use the manager workspace root.** The public manager-workspace content route and manager preferences read both send `rootPath = <dataDir>/workspace/<threadId>`.
3. **Transport is preview-oriented, not opaque streaming.** The full file is still loaded into memory and returned as either UTF-8 text or base64.

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
- March 31, 2026 hardening:
  1. `host.read_file` now requires `rootPath`, so every caller must declare the absolute root that bounds the read.
  2. The manager-workspace content route and manager preferences read both use that bound root to prevent symlink escapes outside `<dataDir>/workspace/<threadId>`.
  3. UTF-8 transport now requires the file bytes to be valid UTF-8; declared text MIME types with non-UTF-8 bytes fall back to base64 so the server preserves the original bytes.

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
