# Auto/Manual Roadmap: Phase 3

## Goal

Add `agent/manage` orchestration for **auto mode**, built on phases 1 and 2.

## Scope

- Add `interactionMode` (`manual | auto`) for new work entry.
- Introduce project-level manager behavior (`agent/manage`).
- Manager creates/updates/delegates tasks to build roles.
- Route task status changes (including `closed + closeReason`) back to parent/root assignee.
- Add long-running manager context envelope.

## Data Model Changes

If not already present from earlier phases, add:

- `threads.managedByThreadId` (nullable)
- `threads.interactionMode` (default `manual`)

Use existing phase 1+2 task/role fields for orchestration.

## Runtime Behavior

Auto-mode flow:

1. User submits prompt with `interactionMode=auto`.
2. System resolves/creates an open root task for the project.
3. System resolves/creates `agent/manage` thread.
4. Root task is linked to manager thread.
5. Manager receives user prompt + role instructions + compact context envelope.
6. Manager delegates to build roles via task and thread operations.
7. Task closure (`closed` + reason) or blockage bubbles to parent task or root manager task.
8. User sees root task progress and completion summary.

## Manager Context Envelope (Initial Contract)

Each manager turn includes:

- latest user/system input,
- open task snapshot for project,
- dependency snapshot for active task graph (`blocks`, `parent-child`, `related`),
- recent task events window,
- recent manager conversation window,
- current `agent/manage` role instructions.

Hard limit:

- envelope size capped with deterministic truncation policy.

## API

Extend:

- `POST /api/v1/threads` supports `interactionMode=auto`.
- thread responses include orchestration fields (`roleId`, `taskId`, `managedByThreadId`, `interactionMode`).

Phase 3 can keep task/role endpoints unchanged and primarily add orchestration behavior.

## CLI and Skill

- Ensure autoloaded skill teaches manager/worker agents how to use `bb task` and `bb thread`.
- Keep command outputs stable (`--json`) for agent automation.

## Discovery Gates (Revisit Points)

Revisit spec after shipping a thin vertical slice:

1. Manager context quality: is the envelope enough or too noisy?
2. Delegation behavior: does manager over-decompose or under-decompose?
3. Restart recovery: what failure cases are still manual?
4. UX clarity: should root task and manager thread both be visible by default?

## Testing

- Integration tests for end-to-end auto flow.
- Routing tests for parent/root status propagation with close reasons.
- Restart reconciliation tests for open tasks and manager thread recovery.

## Exit Criteria

- User can choose auto mode and get delegated execution managed by `agent/manage`.
- Task graph and status propagation are stable across restarts.
- Manager correctly handles and reports `closed` reason taxonomy (`completed|failed|canceled`).
- Manager behavior is observable and debuggable via task/thread events.
