# Orchestrator + Task Model

## Goal
Add an orchestration mode where users talk to an orchestrator. The orchestrator creates tasks, coordinates execution, and starts threads to complete those tasks.

## Problem Statement
Manual thread creation is useful but does not scale to multi-step work. We need an optional orchestration layer that can decompose work, track progress, and run steps in order.

## User Experience
- User chooses orchestration mode for a project.
- User sends a natural-language request to the orchestrator.
- Orchestrator creates a task plan.
- Orchestrator starts worker threads to execute tasks.
- User can watch task status and thread activity in real time.
- User can intervene by updating tasks or messaging orchestrator/worker threads.

## Scope
- Re-introduce task entities and task lifecycle.
- Add orchestrator service and API endpoint(s).
- Add orchestrator-aware CLI commands.
- Add web views for task board and task detail.
- Keep manual thread mode available as a baseline.

## Non-Goals
- Full autonomous replanning without guardrails.
- Complex scheduling optimization.
- Multi-project orchestration in one run.

## Proposed Data Model Additions
- `tasks` table:
  `id`, `project_id`, `parent_task_id?`, `title`, `description?`, `status`, `depends_on`, `result?`, timestamps.
- Optional `threads.task_id` relationship for worker linkage.
- Status model:
  `pending | running | done` for tasks.

## Orchestrator Responsibilities
- Convert user prompt into a task graph.
- Create tasks with dependencies.
- Start worker threads for ready tasks.
- Monitor worker outputs and update task results/status.
- Handle failures with retries or escalations.
- Report concise progress back to user.

## API Additions (Planned)
- Task CRUD and query endpoints:
  - `POST /api/v1/tasks`
  - `GET /api/v1/tasks`
  - `GET /api/v1/tasks/:id`
  - `PATCH /api/v1/tasks/:id`
  - `DELETE /api/v1/tasks/:id`
  - `POST /api/v1/tasks/:id/wait`
- Orchestrator prompt endpoint:
  - `POST /api/v1/orchestrator/prompt`
- WebSocket entities:
  - `task`, `thread`, `orchestrator`

## Rollout Plan
1. Reintroduce shared contracts (`@beanbag/core`) for tasks/orchestrator.
2. Add DB migration(s) for task tables/relations.
3. Implement daemon task manager and orchestrator service.
4. Wire CLI commands for task/orchestrator operations.
5. Restore web task views and orchestrator interactions.
6. Add targeted tests for dependency handling and orchestration flows.
7. Gate behind explicit mode toggle until stable.

## Validation
- Unit tests for task state transitions and dependency checks.
- Route tests for task/orchestrator endpoints.
- Integration tests for orchestrator -> tasks -> worker threads flow.
- Manual smoke test:
  one user prompt produces a multi-task plan and completes with traceable outputs.

## Risks and Mitigations
- Over-aggressive autonomous behavior:
  Require clear prompts, observable actions, and explicit status transitions.
- Task-thread drift:
  enforce state updates through one manager and broadcast authoritative changes.
- UI complexity:
  keep manual mode and orchestration mode clearly separated.
