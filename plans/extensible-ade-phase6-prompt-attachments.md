# Phase 6B: Prompt Attachments Plan (Files + Images)

## Goal

Support first-class prompt attachments with strong contracts and safe local-trusted handling.

## Current Gaps

- Prompt composer is text-only.
- `PromptInput` supports `text`, `image`, and `localImage`, but UI only emits `text`.
- No file attachment pathway or attachment chip model in composer state.
- No daemon-side attachment validation policy beyond existing schema checks.

## Contract Decisions

### Prompt Input Union (`closed_internal`)

- Extend `PromptInput` with local file attachments:
  - `{ type: "localFile"; path: string; name?: string; sizeBytes?: number; mimeType?: string }`
- Keep existing:
  - `{ type: "text"; text: string }`
  - `{ type: "image"; url: string }`
  - `{ type: "localImage"; path: string }`

### Schema and Validation

- Update `promptInputSchema` to include `localFile`.
- Path policy (local trusted, still bounded):
  - normalize path
  - reject empty path
  - enforce max attachment count per request
  - enforce max size for uploaded clipboard images

### Provider Compatibility

- Capability-aware handling in `agent-server`:
  - providers supporting multimodal/local files receive direct prompt input parts.
  - providers without file capability fall back to deterministic text annotation of file paths.

### UI Model Changes

- Introduce explicit composer draft model:
  - `text`
  - `attachments[]` (file/image variants)
- Persist draft model in storage, not text-only string.
- Render removable attachment chips with compact metadata.

### File Attachment UX

1. File picker button.
2. Drag/drop file support.
3. Chip list with remove action.
4. Send path maps chips to `PromptInput` list.

### Image Attachment UX

1. Local image picker support via same attachment model.
2. Clipboard paste support:
   - if paste contains file-image blob, persist to local temp/project-scoped attachments path and attach as `localImage`.
3. URL images remain supported through `image` input entries.

### Daemon/API Work

- Add attachment upload endpoint for clipboard image blobs (if required by web runtime constraints).
- Validate uploaded image type/size and return stored local path.
- Include upload path ownership policy in docs and tests.

## Test Plan

- app:
  - composer reducer/hook tests for attach/remove/serialize
  - PromptBox integration tests for drag/drop/paste/picker flows
- daemon:
  - route validation tests for attachment payloads and upload endpoint
  - thread-manager tests proving attachments reach provider turn start params
- agent-core:
  - schema tests for `localFile` union branch

## Commit Chunks

1. `PromptInput` contract and schema expansion (`localFile`) with tests.
2. Composer draft model and attachment chips in app.
3. File picker and drag/drop send path.
4. Image paste/upload pathway and validation.
5. Provider fallback behavior and integration tests.

## Exit Criteria

- Users can add/remove file and image attachments in composer.
- Spawn/tell requests include typed attachment entries.
- Providers receive compatible normalized input (direct or fallback text mapping).
