# Auto/Manual Roadmap: Phase 1

## Goal

Ship a standalone task system with **manual task creation and updates**. No roles, no manager orchestration.

## Scope

- Add `tasks` and `task_events` data model.
- Support manual task lifecycle (`open`, `in_progress`, `blocked`, `closed`) with explicit close reasons.
- Add typed task dependencies (`blocks`, `parent-child`, `related`) instead of JSON blocker arrays.
- Add atomic assignment semantics so one worker/user can assign a task safely.
- Expose task CRUD in daemon API.
- Add `bb task` CLI commands.
- Add minimal web visibility for project tasks (list + detail is enough).

## Out of Scope

- Role assignment logic.
- Task-to-thread execution handoff.
- `interactionMode=auto`.
- `agent/manage` behavior.

## Data Model

Add table `tasks`:

- `id`
- `projectId`
- `title`
- `description` (nullable)
- `status` (`open | in_progress | blocked | closed`)
- `closeReason` (nullable: `completed | failed | canceled`)
- `assignee` (nullable, actor/user identity)
- `createdAt`, `updatedAt`
- `closedAt` (nullable)
- `resultSummary` (nullable)

Add table `task_dependencies`:

- `taskId`
- `dependsOnTaskId`
- `type` (`blocks | parent-child | related`)
- `createdAt`

Add table `task_events`:

- `id`
- `taskId`
- `seq`
- `type`
- `data` (JSON)
- `createdAt`

Rule: every task mutation appends a `task_events` record in the same DB transaction.

## API

Add:

- `POST /api/v1/tasks`
- `GET /api/v1/tasks?projectId=<id>&status=<status>&parentId=<id>`
- `GET /api/v1/tasks/ready?projectId=<id>`
- `GET /api/v1/tasks/:id`
- `PATCH /api/v1/tasks/:id`
- `POST /api/v1/tasks/:id/assign`
- `POST /api/v1/tasks/:id/dependencies`
- `DELETE /api/v1/tasks/:id/dependencies/:dependsOnTaskId?type=<type>`
- `GET /api/v1/tasks/:id/events?afterSeq=<n>`

Validation:

- `projectId` required on create.
- `title` required.
- parent cycles rejected for `parent-child` dependencies.
- `closed` requires `closedAt` and `closeReason`.
- non-`closed` statuses cannot store `closedAt`/`closeReason`.
- `POST /tasks/:id/assign` is compare-and-swap: fails if already assigned.
- closed tasks cannot transition back to non-closed in phase 1.

## CLI

Add `bb task`:

- `bb task create --project <id> --title ...`
- `bb task list --project <id> [--status ...]`
- `bb task ready --project <id>`
- `bb task show <taskId>`
- `bb task assign <taskId> [--assignee <actorId>]`
- `bb task update <taskId> --status open|in_progress|blocked [--summary ...]`
- `bb task close <taskId> --reason completed|failed|canceled [--summary ...]`
- `bb task dep add <taskId> <dependsOnTaskId> --type blocks|parent-child|related`
- `bb task dep remove <taskId> <dependsOnTaskId> --type blocks|parent-child|related`
- `bb task events <taskId> [-f]`

All commands support `--json`.

## Web

Minimal scope:

- Show project task list.
- Show task status badges.
- Allow manual task creation/update from UI or keep this CLI/API-only for first merge.

## Testing

- Repository tests for create/update/list/event append behavior.
- Repository tests for dependency graph rules (`blocks`, `parent-child`) and cycle rejection.
- Assignment tests for compare-and-swap behavior under concurrent callers.
- Route tests for validation and error handling.
- CLI tests for expected request payloads and JSON output.

## Exit Criteria

- Users can manually create and track tasks end-to-end without threads/roles.
- Users can safely assign tasks without double-assignment races.
- Task history is queryable and ordered.
- Phase 1 can be deployed without any phase 2 or 3 code paths enabled.
