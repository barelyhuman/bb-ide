# `GET /api/v1/projects/:id/attachments/content` — Serve attachment content

**Route:** `apps/server/src/routes/projects.ts:203`
**Contract:** `projectAttachmentContentQuerySchema -> binary response` (200)
**Complexity:** Medium (filesystem I/O, path traversal guard)

## Request Params / Query

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. Scopes the attachment directory. |
| `path` | Yes (query) | Relative path to the attachment file within the project's attachment directory. |

**All 2 fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. Throws 404 if missing.
2. `readAttachment(config.dataDir, projectId, query.path)` -- **async**.
   - Resolve the full path: `<dataDir>/attachments/<projectId>/<path>`.
   - **Path traversal guard**: `resolve(dir, normalize(relativePath))` must start with `resolve(dir) + "/"` or equal `resolve(dir)`. Throws 400 if the resolved path escapes the project directory.
   - `stat` the resolved path. If not a file, throw 404.
   - `readFile` the content into a buffer.
   - Return `{ content: Buffer }`. Note: `mimeType` is not returned by `readAttachment` -- it's always `undefined`.
3. Construct a raw `Response` with the buffer as `Uint8Array`.
   - `content-type` header: `attachment.mimeType ?? "application/octet-stream"`.
   - Since `readAttachment` never sets `mimeType`, the content type is always `"application/octet-stream"`.

> **-> HTTP 200 returns here.** Returns raw binary, not JSON.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject |

**Total: 1 query. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireProject` | Most project routes |
| `readAttachment` | Only caller |

## Flags

1. **Content-type is always `application/octet-stream`**. `readAttachment` returns `{ content }` without `mimeType`. The route sets the header to `attachment.mimeType ?? "application/octet-stream"`, but `mimeType` is always undefined. Images will be served with the wrong content type, which will break browser rendering. The MIME type is stored in the `storeAttachment` response but is not persisted anywhere for later retrieval. This looks like a bug.
2. The path traversal guard is correct and well-implemented. `normalize` + `resolve` + prefix check prevents `../` escapes.
3. The response bypasses Hono's `context.json()` and returns a raw `Response` object. This is necessary for binary content but means no middleware-level response processing (logging, etc.) applies.
4. The contract type says the response is `string` with `"text"` format, but the actual response is binary (`Uint8Array`). The contract type is misleading.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `toUserAttachmentImageSrc` | `apps/app/src/lib/user-attachment-images.ts:7` | Builds the URL `/api/v1/projects/:id/attachments/content?path=...` for image `src` attributes |
| `ThreadTimelinePane` | `apps/app/src/views/ThreadTimelinePane.tsx:11` | Renders user-attached images in timeline via `toUserAttachmentImageSrc` |
| `PromptAttachmentPreview` | `apps/app/src/components/promptbox/PromptAttachmentPreview.tsx:5` | Shows attachment thumbnail previews via `toUserAttachmentImageSrc` |
| attachment content test | `apps/server/test/public-projects-hosts.test.ts:344` | Tests serving uploaded attachment content |

Not called via the typed API client -- the app constructs the URL directly for use in `<img>` tags. No CLI caller.

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
