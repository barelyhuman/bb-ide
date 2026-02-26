# DB Shapes and Repository Invariants

Source of truth: `packages/db/src/schema.ts` and `packages/db/src/repositories.ts`.

## Tables

## `projects`

- `id` (PK)
- `name` (not null)
- `root_path` (not null)
- `created_at` (not null)
- `updated_at` (not null)

Ownership: `ProjectRepository`.

## `threads`

- `id` (PK)
- `project_id` (FK -> `projects.id`)
- `title` (nullable)
- `status` (not null, default `created`)
- `parent_thread_id` (nullable)
- `archived_at` (nullable)
- `created_at` (not null)
- `updated_at` (not null)

Indexes:

- `threads_project_updated_idx (project_id, updated_at)`
- `threads_parent_thread_idx (parent_thread_id)`

Ownership: `ThreadRepository`.

Status invariant (`closed_internal`):

- Valid values: `created`, `provisioning`, `provisioning_failed`, `idle`, `active`.
- Invalid persisted values throw on read.

## `events`

- `id` (PK)
- `thread_id` (FK -> `threads.id`)
- `seq` (not null, monotonic per thread)
- `type` (raw persisted event type string)
- `norm_type` (normalized type: lower-case, `.` -> `/`)
- `turn_id` (nullable lookup extract)
- `provider_thread_id` (nullable lookup extract)
- `is_turn_lifecycle` (bool)
- `is_thread_identity` (bool)
- `data` (JSON string)
- `created_at` (not null)

Index:

- `events_thread_seq_idx (thread_id, seq)`

Ownership: `EventRepository`.

## Event Repository Invariants

- `seq` is monotonic per thread (`getLatestSeq + 1`).
- `norm_type` is always derived with `normalizeThreadEventType`.
- `turn_id` and `provider_thread_id` are extracted from normalized envelope payload first, then legacy raw shapes.
- `is_turn_lifecycle` is true for `turn/start`, `turn/started`, `turn/end`, `turn/completed`.
- `is_thread_identity` is true when `provider_thread_id` is present.

## Execution Option Snapshot Reads

`getLatestExecutionOptions(threadId)` scans latest `client/thread/start` or `client/turn/start` events and decodes:

- `model`
- `reasoningLevel`
- `sandboxMode`
- `approvalPolicy`

Invalid persisted reasoning/sandbox/source values throw.

## Migration Policy

Task-domain data migration is intentionally dropped (locked decision).
