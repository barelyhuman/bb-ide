# File Surfaces Roadmap

## Goal

Move the current file-related features toward two clear product capabilities:

1. **Blob-backed file delivery**
   - Attachments
   - Published manager workspace files
2. **Source-backed file discovery**
   - Project source file listing for both `local_path` and `github_repo`

The public API should stay stable where possible while the server swaps route internals behind those contracts.

## Current State

### Blob-like reads today

- **Attachments**
  - Uploaded through `POST /api/v1/projects/:id/attachments`
  - Served through `GET /api/v1/projects/:id/attachments/content`
  - Backed by server-local filesystem in `apps/server/src/services/attachments.ts`
- **Manager workspace**
  - Listed through `GET /api/v1/threads/:id/manager-workspace/files`
  - Read through `GET /api/v1/threads/:id/manager-workspace/content`
  - Backed by a live host-local folder derived from `<session.dataDir>/workspace/<threadId>`

### Source-backed listing today

- **Repo workspace files**
  - Listed through `GET /api/v1/projects/:id/files`
  - Only works for `local_path` project sources today
  - Internally proxies to daemon `workspace.list_files`

## Target State

### 1. Blob-backed file delivery

- Attachments remain uploadable/readable through their current public routes.
- Manager workspace files continue to be authored locally by the manager agent in a host-local folder.
- Manager workspace reads stop depending on the live host for user-facing list/read routes.
- Instead, manager workspace content is **published** into object storage and served from a synced snapshot.
- The app treats attachment URLs and manager-workspace URLs as ordinary file URLs.

### 2. Source-backed file discovery

- `GET /api/v1/projects/:id/files` remains the single user-facing endpoint for project file suggestions.
- The server dispatches internally on project source type:
  - `local_path` -> daemon-backed `workspace.list_files`
  - `github_repo` -> GitHub API-backed implementation
- Prompt composer and other consumers do not care which source type produced the list.

## Design Principles

- Keep **blob-backed delivery** separate from **source-backed discovery**.
- Do not collapse all file features into one generic route family that hides meaningful differences.
- Server owns product policy, source dispatch, snapshot selection, and storage configuration.
- Daemon owns host-local filesystem access and any host-local change detection.
- Manager workspace should have a **write model** (live host folder) and a separate **read model** (published snapshot).
- Prefer metadata-first preview flows. Consumers should not need to download arbitrary binary payloads just to learn they are not previewable.

## Proposed New Package

Introduce **`@bb/files`** as the shared package for file-domain types and policies.

### Initial contents

- Shared file metadata schemas and types
  - file list entries
  - blob metadata
  - snapshot manifest entries
- Shared path/value helpers for file-domain contracts
- Shared MIME classification helpers with explicit semantics
  - preview image MIME helpers
  - preview text MIME helpers
  - transport-safe UTF-8 MIME helpers

### Why this package is worth adding

- We already have file-domain logic spread across app, server, and daemon.
- The current hard-coded MIME policy lists are easy to let drift.
- The future object-backed manager workspace needs manifest types that are not server-only.
- `@bb/files` gives us one place for shared file-domain vocabulary without putting storage SDK code in a shared package.

### What should **not** go into `@bb/files`

- S3/R2 SDK clients
- GitHub API clients
- server-only storage implementations
- daemon command handlers

Those stay in the owning app/service layers.

## Migration Plan

### Completed pre-work

The current live manager-workspace path was hardened before this roadmap:

1. `GET /threads/:id/manager-workspace/content` now passes a bounded `rootPath` to `host.read_file`, and the daemon rejects symlink-resolved reads that escape the durable manager workspace root.
2. The daemon now uses UTF-8 transport only when the file bytes are actually valid UTF-8; otherwise it falls back to base64 and preserves the original bytes.

### Phase 0: Remove dead `workspace.read_file` if it stays unused by product code

1. Remove `workspace.read_file` if it stays unused by product code
   - After the manager-workspace migration, this command appears to be dead outside daemon contracts/tests.
   - If no caller needs it, delete it end to end instead of keeping parallel read surfaces around.

### Phase 1: Introduce `@bb/files`

1. Create `packages/files`
2. Move shared file-domain types and helpers into it
3. Update app/server/daemon imports to use the new package
4. Make MIME policy differences explicit by naming helpers after their purpose instead of sharing ambiguous sets

Exit condition:
- app, server, and daemon no longer maintain overlapping file-domain MIME/policy helpers independently when they are describing the same concept

### Phase 2: Extract attachment storage behind an interface

1. Introduce a server-side `AttachmentStore` abstraction
2. Keep the current local-filesystem implementation as the default
3. Add an object-storage-backed implementation behind configuration
4. Preserve the current attachment upload/read routes while swapping route internals

Exit condition:
- attachments can be stored either locally or in object storage without route changes

### Phase 3: Introduce a published manager-workspace read model

1. Introduce a server-side `PublishedManagerWorkspaceStore`
2. Define a manifest format for manager workspace snapshots
3. Persist a pointer to the latest published snapshot for each manager thread
4. Keep the live host-local manager workspace as the write path
5. Treat the published snapshot as the read path for `files` and `content`

Preferred behavior:
- the manager keeps writing to disk exactly as it does today
- publication happens on turn completion and/or explicit file change events
- user-facing list/read routes serve the latest completed snapshot

Exit condition:
- manager workspace list/read routes no longer require the host to be online for previously-published content

### Phase 4: Publish manager workspace content into object storage

1. Add a sync/publish pipeline for manager workspace snapshots
2. Upload changed files to object storage
3. Publish a manifest for list/read lookup
4. Decide whether file content routes should proxy bytes or redirect to signed object URLs

Open question:
- persist manifests in DB rows, object storage, or both

Exit condition:
- manager workspace reads come from published storage, not live host reads

### Phase 5: Dispatch project file listing by source type

1. Introduce a server-side `ProjectSourceFileLister`
2. Route `/projects/:id/files` through that abstraction
3. Keep the current `local_path` implementation using daemon `workspace.list_files`
4. Add a `github_repo` implementation using GitHub’s API
5. Preserve the same response shape for prompt-composer consumers

Exit condition:
- `/projects/:id/files` works for both `local_path` and `github_repo` project sources

### Phase 6: Move to metadata-first preview ergonomics

1. Extend blob-backed file list/manifests to include at least:
   - `path`
   - `name`
   - `mimeType`
   - `sizeBytes`
2. Let the app decide previewability before downloading content
3. Restrict full-content fetches to files already known to be previewable
4. Consider partial text preview support for larger text files

Exit condition:
- consumers do not need to download arbitrary binary content just to decide whether preview is possible

## Proposed Runtime Abstractions

These should live in the owning app layers, not in `@bb/files`.

### Server-side

- `AttachmentStore`
- `PublishedManagerWorkspaceStore`
- `ProjectSourceFileLister`
- `ManagerWorkspacePublisher`

### Daemon-side

- host-local bounded file listing/reading primitives for a declared root
- optional file change reporting hooks if we later want more immediate manager-workspace publishing

## Public API Direction

### Keep stable

- `POST /api/v1/projects/:id/attachments`
- `GET /api/v1/projects/:id/attachments/content`
- `GET /api/v1/threads/:id/manager-workspace/files`
- `GET /api/v1/threads/:id/manager-workspace/content`
- `GET /api/v1/projects/:id/files`

### Internal changes behind those routes

- attachments: filesystem-backed -> pluggable local/object-backed store
- manager workspace: live host read -> published snapshot read
- project file listing: local-path-only -> source-type dispatcher

## Exit Criteria

- Attachments can be backed by either local filesystem or object storage without changing public routes.
- Manager workspace list/read routes serve published snapshots rather than live host files.
- Manager workspace live writes remain unchanged for the agent.
- `/projects/:id/files` supports both `local_path` and `github_repo`.
- File-domain shared types/policies live in `@bb/files`.

## Validation

### Package extraction

- `pnpm exec turbo run typecheck --filter=@bb/files --filter=@bb/app --filter=@bb/server --filter=@bb/host-daemon`
- `pnpm exec turbo run test --filter=@bb/files --filter=@bb/app --filter=@bb/server --filter=@bb/host-daemon`

### Storage abstraction / route behavior

- attachments: test both local and object-backed implementations against the same route behavior
- manager workspace: test list/read behavior against published snapshots
- project source listing: test both `local_path` and `github_repo` through `/projects/:id/files`

## Notes

- Delete this plan once the roadmap is either completed or superseded.
