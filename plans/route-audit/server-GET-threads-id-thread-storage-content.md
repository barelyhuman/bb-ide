# `GET /api/v1/threads/:id/thread-storage/content` — Read Durable Thread Storage File Content

**Route:** `apps/server/src/routes/threads/data.ts`
**Contract:** `PathId & { query: ThreadStorageContentQuery } -> binary` (200)
**Complexity:** Medium

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Thread ID. Must resolve to a thread with an environment. |
| `path` | Yes | Relative thread-storage path. Absolute paths and `..` traversal are rejected at the route layer. |

**Both fields consumed. No dead params.**

## Implementation Trace

1. `validateFilePath(path)` rejects:
   - absolute paths
   - `..` path traversal via `/` or `\\`
2. `requireThreadStorageTarget(deps, { threadId })` resolves the durable thread storage root `<dataDir>/thread-storage/<threadId>` through:
   - `requireThread`
   - `requireEnvironment`
   - `requireConnectedHostSession`
3. Calls `queueCommandAndWait(...)` with `host.read_file` on `path.join(threadStorageRoot, query.path)` and `rootPath = threadStorageRoot`.
4. Parses the daemon result as `host.read_file`.
5. `createDaemonFileContentResponse(...)`:
   - decodes UTF-8 or base64 payloads to raw bytes
   - returns a raw `Response`
   - sets `Content-Type`
6. `remapDaemonFileRouteError(...)` translates daemon file errors to user-facing 4xx responses:
   - `ENOENT` -> 404
   - `invalid_path` -> 400
   - `file_too_large` -> 413
7. Other daemon/session failures still surface from `queueCommandAndWait()` as 502/504.

## DB Query Summary

| # | Query | Table | Notes |
|---|---|---|---|
| 1 | `SELECT * FROM threads WHERE id = ?` | `threads` | `requireThread` |
| 2 | `SELECT * FROM environments WHERE id = ?` | `environments` | `requireEnvironment` |
| 3 | `SELECT * FROM host_daemon_sessions WHERE hostId = ? ...` | `host_daemon_sessions` | `requireConnectedHostSession` |

**Total: 3 synchronous DB lookups before the daemon command is queued.**

## Flags

1. **Raw response body, not JSON.** The app must inspect `Content-Type` and, for non-images, body bytes to decide whether to render text or an unsupported preview state.
2. **Server-owned host path plus daemon-enforced containment.** The user only supplies a relative path inside the durable thread storage; the server resolves the host root and the daemon rejects symlink-resolved reads that escape it.
3. **Attachment-like error handling.** Missing files, invalid paths, and oversize files now return 404/400/413 instead of a generic 502.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `loadFilePreview` | `apps/app/src/lib/api.ts` | Shared URL-based preview loader used for route-agnostic file previews |
| `getThreadStorageFilePreview` | `apps/app/src/lib/api.ts` | Builds the thread storage content URL and delegates to `loadFilePreview` |
| `useThreadStorageFilePreview` | `apps/app/src/hooks/useApi.ts` | React Query wrapper for the preview request |
| `useThreadStorageViewer` | `apps/app/src/views/useThreadStorageViewer.ts` | Loads the selected thread storage preview in the thread detail side panel |

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
