# `host.read_file` — Read a Text File from the Host Filesystem (Host-Daemon Command)

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
3. `readHostFile` delegates to `readTextFile(command.path, command.path)`.
4. `readTextFile`:
   - `stat`s the path
   - rejects directories
   - rejects files larger than 10 MB
   - reads the file as UTF-8 text
   - infers `mimeType` from the file extension when possible
5. Returns `{ path, content, mimeType? }`.

## Flags

1. **No root restriction beyond absolute paths.** The server can request any readable absolute path on the host. This is intentional for host-local manager workspace reads, but broader than `workspace.read_file`.
2. **Text-only semantics.** The handler reads with UTF-8, so binary files are not a supported use case.
3. **Symlinks are followed.** There is no containment check against `BB_DATA_DIR`; the resolved file is whatever the absolute path points to on disk.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `resolveThreadRuntimeCommandConfig` | `apps/server/src/services/thread-runtime-config.ts` | Reads `PREFERENCES.md` from the manager workspace at `<dataDir>/workspace/<threadId>/PREFERENCES.md` |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
