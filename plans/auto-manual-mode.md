# Auto/Manual Roadmap (Consolidated)

This is the canonical roadmap for task-thread orchestration and role-based execution.

## Current State In Code (As Implemented)

### Shipped Task Model

- `tasks` table with `open|in_progress|blocked|closed` status and close reasons (`completed|failed|canceled`)
- typed dependency graph via `task_dependencies` (`blocks|parent-child|related`)
- append-only `task_events` with typed event payloads
- archived tasks (`archivedAt`) and closed timestamp (`closedAt`)
- assignment compare-and-swap semantics (`assign` succeeds only when task is unassigned)
- parent-child task relationship represented as a `parent-child` dependency

### Shipped Thread Linkage and Orchestration Primitives

- thread metadata: `taskId`, `taskRole` (`primary|worker`), `agentRoleId`, `parentThreadId`
- task assignment and task chat can auto-create a deterministic primary thread for that task
- worker threads can be linked to a parent thread for completion notifications
- child thread completion sends a system notification to parent thread (deduped by turn/lifecycle)
- tell behavior supports provider routing modes (`auto|start|steer`)

### Shipped Role Surface

- role APIs/UI exist, but are currently backed by static in-process role definitions
- current default role catalog is minimal (`agent/generic`)
- role instructions are injected into spawned threads when role metadata is provided

### Shipped Product Surfaces

- daemon task APIs: create/list/get/update/assign/chat/archive/dependencies/events
- daemon thread APIs: spawn/list/get/tell/stop/archive/events/output
- CLI task flows: create/list/status/show/update/assign/close/dependencies/events
- CLI thread flows: spawn/tell/steer/status/show/log with context defaults (`BB_*`)
- web task detail includes assignment, task chat, status transitions, primary-thread linkage, and activity timeline
- web sidebar includes roles and project-level task/thread navigation

## Gap Analysis Against Previous Phase Plans

### Landed

- phase 1 core task model and dependency/event foundation
- atomic assignment behavior
- CLI/API/web visibility for tasks
- role-aware thread spawning and persisted thread-role/task linkage

### Landed Differently Than Planned

- role ownership is currently modeled on threads (`agentRoleId`) plus task assignee string, not a dedicated `tasks.roleId` + `tasks.assigneeThreadId`
- role definitions are static, not loaded from `.beanbag/roles/*.md`
- orchestration currently relies on task chat + parent-thread completion notifications, not manager-driven task graph execution

### Not Landed Yet

- project-managed role files (`.beanbag/roles/*.md`) with reload/edit flows
- manager role (`agent/manage`) and root-task orchestration loop
- explicit interaction mode (`manual|auto`) on thread/task entry
- task-status bubbling to parent/root task owners
- manager context envelope contract and restart reconciliation semantics

## Delivery Plan From Current Baseline

### Phase A: Stabilize Current Task-Thread Model

- formalize the current data model as the stable contract (task assignee + thread role metadata)
- close test gaps with end-to-end coverage across CLI -> API -> daemon -> mocked provider
- harden task chat and assignment kickoff behavior under retries/restarts

### Phase B: Project-Defined Roles

- introduce project role sources from `.beanbag/roles/*.md`
- add daemon role reload/edit endpoints
- add CLI role commands (`list`, `reload`, optional `edit`)
- keep static defaults as fallback when project roles are absent

### Phase C: Manager Orchestration (True Auto Mode)

- add explicit `interactionMode` at work-entry points
- introduce long-lived `agent/manage` thread per project (or workspace contract)
- manager creates/delegates tasks to role threads and tracks completion
- route closure/blocking updates through parent/root task graph
- expose manager observability via task/thread events and web UX affordances

## Aspirational Backlog (Not In Active Scope)

- multi-role build teams beyond generic role defaults (for example build/review/test specializations)
- richer manager memory and compaction strategy
- advanced decomposition heuristics for manager delegation behavior
- expanded auto-mode UX defaults and user-visible orchestration controls
