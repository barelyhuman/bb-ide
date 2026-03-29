# `POST /api/v1/projects/:id/attachments` — Upload a file attachment

**Route:** `apps/server/src/routes/projects.ts:190`
**Contract:** `formData(file) -> UploadedPromptAttachment` (201)
**Complexity:** Medium (filesystem I/O, no schema validation on body)

## Request Params / Body

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. Used as the storage directory key. |
| `file` (form field) | Yes | Must be a `File` instance from multipart form data. Validated manually (not via Zod schema). |

**All fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. Throws 404 if missing.
2. `context.req.formData()` -- **async**. Parse multipart form data from request body.
3. `formData.get("file")` -- extract the `file` field. If not a `File` instance, throw 400.
4. `storeAttachment(config.dataDir, projectId, file)` -- **async**.
   - Determine if image by MIME type prefix `"image/"`.
   - Check size limit: 10MB for images, 25MB for other files. Throw 400 if exceeded.
   - `mkdir` the attachment directory `<dataDir>/attachments/<projectId>` (recursive).
   - Generate a unique filename: `<sanitized-stem>-<timestamp>-<random>.<ext>`.
   - Read file into buffer, write to disk.
   - Return `UploadedPromptAttachment` with `type`, `path` (filename only), `name`, `mimeType`, `sizeBytes`.

> **-> HTTP 201 returns here.** Async for filesystem I/O only.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject |

**Total: 1 query. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireProject` | Most project routes |
| `storeAttachment` | Only caller |

## Flags

1. No Zod schema validation on the request body -- this is raw `formData()` parsing. The route is not registered with a body schema (note the handler signature `async (context)` with no payload param). This is likely intentional since Zod doesn't handle multipart well, but it means no typed contract validation.
2. The returned `path` is just the filename (e.g., `"photo-1234567890-abc123.png"`), not a full path. The client must know to use it with `GET /projects/:id/attachments/content?path=...`. This is fine but the field name `path` is slightly misleading.
3. `sanitizeFilename` strips non-alphanumeric characters. A file named entirely with non-ASCII characters would become `"attachment"`. Edge case but worth knowing.
4. The `mimeType` in the response is `file.type || undefined`. If the client doesn't send a MIME type, it's omitted from the response. Downstream consumers that rely on `mimeType` for rendering decisions should handle this.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `uploadPromptAttachment` API fn | `apps/app/src/lib/api.ts:280` | Posts multipart form to `apiClient.projects[":id"].attachments.$url()` |
| `useUploadPromptAttachment` hook | `apps/app/src/hooks/useApi.ts:493` | React Query mutation; calls `api.uploadPromptAttachment()` |
| `ProjectMainView` | `apps/app/src/views/ProjectMainView.tsx:138` | Uploads file attachments when composing a new thread |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:620` | Uploads file attachments when replying in a thread |
| attachment test | `apps/server/test/public-projects-hosts.test.ts:323` | Tests upload stores file and returns metadata |

No CLI caller.

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
