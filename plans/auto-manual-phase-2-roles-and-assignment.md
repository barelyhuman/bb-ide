# Auto/Manual Roadmap: Phase 2

## Goal

Introduce **roles + task assignment to worker threads** without adding `agent/manage` orchestration yet.

## Scope

- Add role definitions from `.beanbag/roles/*.md`.
- Add role listing/reload/edit surfaces.
- Extend task model for assignment metadata.
- Extend thread model so a task can be associated to a worker thread.
- Enable assigning tasks to `agent/build/main` and having that thread work the task.
- Keep phase 1 status model and assignment semantics (`open|in_progress|blocked|closed` + CAS assign).

## Out of Scope

- Root orchestration task.
- Delegation graph controlled by `agent/manage`.
- Auto-mode prompt behavior.

## Data Model Changes

Add `roles` table:

- `id`
- `projectId`
- `name`
- `description` (nullable)
- `instructionsPath`
- `isSystem`
- `createdAt`, `updatedAt`

Extend `tasks`:

- `roleId` (intended owner role)
- `assigneeThreadId` (runtime worker thread)

Extend `threads`:

- `roleId` (nullable)
- `taskId` (nullable)

Keep defaults:

- manual threads still work with null role/task fields.

## Runtime Behavior

Manual assignment flow:

1. User creates task (Phase 1 behavior).
2. User assigns task to `roleId` (for example `agent/build/main`).
3. System resolves or creates worker thread for that role.
4. Task `assigneeThreadId` is set.
5. Worker thread acquires assignment atomically (assign-if-unassigned) before starting work.
6. Thread receives prompt to work on assigned task.
7. Worker updates task via `bb task` and closes with reason (`completed|failed|canceled`) when done.

No manager thread is involved in phase 2.

## API

Add/extend:

- `GET /api/v1/roles?projectId=<id>`
- `POST /api/v1/roles/reload?projectId=<id>`
- `POST /api/v1/roles/:id/edit`
- `PATCH /api/v1/tasks/:id` supports `roleId` and `assigneeThreadId`
- `POST /api/v1/tasks/:id/assign` accepts thread identity for role workers
- `GET /api/v1/threads/:id` includes `roleId`, `taskId`

## CLI

Add `bb role`:

- `bb role list --project <id>`
- `bb role reload --project <id>`

Extend `bb task update`:

- `--role <roleId>`
- `--assignee-thread <threadId>`

Assign + close flow for role workers:

- `bb task assign <taskId> --assignee-thread <threadId>`
- `bb task close <taskId> --reason completed|failed|canceled [--summary ...]`

## Web

- Sidebar roles section above projects.
- Task detail supports role/assignee display and manual reassignment.
- Thread detail shows task badge when `taskId` is present.

## Testing

- Role loader tests (seed defaults, reload behavior, malformed file handling).
- Assignment flow integration test:
  - create task -> assign role -> create/resolve worker thread -> assign -> close.
- Concurrency test: two role workers cannot both assign the same unassigned task.
- UI tests for role list rendering and task/thread linkage display.

## Exit Criteria

- A user can assign a task to `agent/build/main` and see it executed in a role-linked thread.
- Task and thread linkage is persisted and queryable.
- Assign/close semantics remain race-safe under concurrent workers.
- No `agent/manage` behavior is required for the flow to work.
