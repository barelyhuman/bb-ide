# Goal
Introduce a first-class **workflow type** abstraction so thread behavior is workflow-driven (`direct`, `worktree`, future types), scoped to Phase 1 only.

# Status & Handoff (2026-03-04)
- Phase 1 is implemented and validated.
- Core implementation commit: `2b112ec` (`feat(workflows): add phase-1 workflow abstraction and migration`).
- Follow-up hardening commits merged onto `main`:
  - `1afbb23` (`test: stabilize workspace vitest imports`)
  - `7c86a69` (`cli: support workflow selection in thread spawn`)
  - `20819f9` (`daemon: honor BEANBAG_ENVIRONMENT workflow default`)
- `direct` and `worktree` are first-class workflows with workflow-owned status/actions and deterministic workflow-action events.
- Strict worktree provisioning failures are enabled (no local fallback).
- Unknown explicit workflow IDs are handled as view-only threads (readable, not actionable).
- Temporary unexpected local daemon edits were stashed during merge and then dropped; no outstanding stash/hotfix remains.
- Manager workflow support remains deferred to Phase 2.

## Handoff Snapshot (Phase 2 Start Here)
- Primary workspace/branch for follow-up work: `/Users/michael/Projects/bb` on `main`.
- Current workflow selection precedence in daemon spawn:
  - explicit `workflowId` request,
  - explicit `environmentId` request (legacy mapped to workflow),
  - persisted thread workflow (when applicable),
  - `BEANBAG_ENVIRONMENT` default (when no explicit request/thread value),
  - built-in default (`direct`).
- `BEANBAG_ENVIRONMENT` now fails loudly on invalid values.
- CLI `bb thread spawn` now supports:
  - `--workflow <direct|worktree|local>` (`local` normalizes to `direct`)
  - `--environment <local|worktree>` (compatibility selector)
  - conflict check: incompatible `--workflow` + `--environment` exits with an error.
- E2E caveat that is expected behavior (not a regression):
  - `--workflow worktree` or `--environment worktree` against a non-git project results in `provisioning_failed` with a worktree/git-root error.
- Unknown workflow thread behavior remains:
  - thread is readable/viewable,
  - actionable operations are rejected (view-only guardrails).
- Key files for next-agent orientation:
  - Daemon workflow selection/runtime:
    - `apps/daemon/src/thread-manager.ts`
    - `apps/daemon/src/workflows/built-in-workflows.ts`
  - CLI spawn selectors:
    - `apps/cli/src/commands/thread.ts`
    - `apps/cli/src/__tests__/command-output.test.ts`
  - Thread spawn e2e coverage:
    - `apps/daemon/src/__tests__/e2e/thread-spawn-roundtrip.test.ts`
  - Thread-manager workflow selection unit coverage:
    - `apps/daemon/src/__tests__/thread-manager.test.ts`
  - Workspace test import stability:
    - `vitest.workspace-aliases.ts`
    - package-level `vitest.config.ts` files using that alias map.

# Scope
In scope:
- Replace environment-first modeling with workflow-first modeling.
- Add a `WorkflowDefinition` registry that can control:
  - environment provisioning selection,
  - system/developer instruction augmentation,
  - thread metadata defaults and UI hints,
  - workspace actions policy (commit/squash/promote behavior),
  - diff/status rendering for thread surfaces.
- Preserve current user-visible behavior for existing local/worktree flows in Phase 1, while renaming the local workflow to `direct`.

Out of scope:
- Third-party executable workflow plugins in Phase 1.
- Replacing provider adapters or environment adapters.
- Manager workflow behavior (entirely deferred to a later phase).

User journeys:
1. Phase 1: no behavior change, safer architecture
- User can still create and run direct/worktree threads exactly as today (`direct` maps legacy `local`).
- Internal code resolves behavior through workflow definitions instead of one-off conditionals.

# Workflow Model (Type-First)
Each workflow provides a concrete type that extends a base workflow contract.
Workflow thread data is JSON-serializable and persisted with each thread.

```ts
type WorkspaceRef = { kind: "local"; rootPath: string };

interface WorkflowDefinition<
  TWorkflowData extends JsonObject,
  TWorkflowStatusInfo extends JsonObject,
  TWorkspaceStatusInfo extends JsonObject,
> {
  id: string;
  version: number;
  displayName: string;
  icon: string;

  // Must fail loudly if contract cannot be satisfied.
  createWorkspace(
    input: CreateWorkspaceInput<TWorkflowData>,
    api: CreateWorkspaceApi,
  ): Promise<{
    workspace: WorkspaceRef;
    workflowDataPatch: Partial<TWorkflowData>; // serializable, persisted on thread
  }>;

  // Called when the thread is archived. Direct can no-op.
  deleteWorkspace?(
    input: DeleteWorkspaceInput<TWorkflowData>,
    api: DeleteWorkspaceApi,
  ): Promise<void> | void;

  getWorkflowStatusInfo(
    input: WorkflowStatusInput<TWorkflowData>,
    api: WorkflowStatusApi,
  ): Promise<TWorkflowStatusInfo> | TWorkflowStatusInfo;
  getWorkflowStatusInfoWatchTargets?(
    input: WorkflowStatusInput<TWorkflowData>,
  ): WatchTarget[];

  // Workspace health/details used by status pill + action gating.
  getWorkspaceStatusInfo(
    input: WorkspaceStatusInput<TWorkflowData>,
    api: WorkspaceStatusApi,
  ): Promise<TWorkspaceStatusInfo> | TWorkspaceStatusInfo;
  getWorkspaceStatusInfoWatchTargets?(
    input: WorkspaceStatusInput<TWorkflowData>,
  ): WatchTarget[];

  // Diff banner (verbose=false) and secondary diff panel (verbose=true).
  getWorkspaceDiffInfo(
    input: WorkspaceDiffInput<TWorkflowData> & { verbose: boolean },
    api: WorkspaceDiffApi,
  ): Promise<WorkspaceDiffInfo>;
  getWorkspaceDiffInfoWatchTargets?(
    input: WorkspaceDiffInput<TWorkflowData>,
  ): WatchTarget[];

  // Optional thread metadata rows in detail/header surfaces.
  getThreadMetadataInfo?(
    input: ThreadMetadataInput<TWorkflowData>,
    api: ThreadMetadataApi,
  ): Promise<ThreadMetadataInfo>;
  getThreadMetadataInfoWatchTargets?(
    input: ThreadMetadataInput<TWorkflowData>,
  ): WatchTarget[];

  // Actions shown to the user are derived from workflow + workspace status.
  getWorkflowActions(
    input: WorkflowActionsInput<
      TWorkflowData,
      TWorkflowStatusInfo,
      TWorkspaceStatusInfo
    >,
    api: WorkflowActionsApi,
  ): WorkflowAction[];

  runWorkflowAction(
    input: RunWorkflowActionInput<TWorkflowData>,
    api: RunWorkflowActionApi,
  ): Promise<WorkflowActionResult>;

  // Optional instruction customization.
  buildDeveloperInstructions?(
    input: BuildInstructionsInput<TWorkflowData>,
    api: InstructionApi,
  ): string | undefined;
}
```

Key rules:
- `TWorkflowData` must be JSON-serializable and versioned.
- Every method takes `(input, api)` where `input` is pure data and `api` is capability-scoped DI (better isolation and testability).
- No implicit fallback across workflows/environments.
- `createWorkspace` failure results in `provisioning_failed`.
- Status and actions are workflow-owned, not hardcoded global enums.
- Workflow events use constrained daemon-owned envelopes with deterministic projection (no workflow-specific renderer functions).
- Phase 1 keeps secondary panel customization out of the base API. Both the prompt diff banner and diff panel are driven by `getWorkspaceDiffInfo({ verbose: false|true })`.

## Provisioning Event Ownership
Provisioning lifecycle boundaries are daemon-owned, not workflow-owned:
- `system/provisioning/started`
- `system/provisioning/completed`
- `system/provisioning/failed`
- `system/provisioning/cleanup_failed`

Workflows can only emit provisioning detail entries during `createWorkspace` via `api.logWorkflowEvent(...)`:

```ts
type WorkflowProvisioningDetailEventInput = {
  kind: "provisioning_detail";
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
};
```

Projection rule:
- `to-ui-messages` bundles `started` + `detail*` + terminal provisioning events by `runId`.
- Workflow detail lines are rendered as details of the provisioning bundle, not as independent custom message types.
- Workflows cannot emit or override provisioning lifecycle boundary events.

## Workflow Action Event Ownership
Workflow actions are also emitted through `api.logWorkflowEvent(...)` using the action variant:

```ts
type WorkflowActionEventInput = {
  kind: "action";
  actionId: string;
  phase: "requested" | "started" | "completed" | "failed" | "info";
  message: string;
  detail?: string;
  metadata?: Record<string, string>;
};
```

Projection rule:
- `to-ui-messages` maps `system/workflow_action` through one deterministic formatter.
- Title is derived from `{workflowId, actionId, phase}` with an exhaustive fallback.
- Details are appended from `detail` + selected `metadata`.
- No workflow-defined message renderer path.

Phase 1 migration map (direct/worktree; direct maps legacy local):
- `system/thread_operation` -> `system/workflow_action`
- `system/primary_checkout/updated` -> `system/workflow_action`
- `system/worktree/commit` -> `system/workflow_action`
- `system/worktree/squash_merge` -> `system/workflow_action`

# Implementation Steps
1. Phase 1: add workflow contract and registry layer. ✅ Completed (2026-03-04)
- Add closed internal union `WorkflowId = "direct" | "worktree"` for Phase 1.
- Define a base generic `WorkflowDefinition<TWorkflowData, TWorkflowStatusInfo, TWorkspaceStatusInfo>`.
- Implement built-in typed workflows for `direct` and `worktree`.
- Implement `createBuiltInWorkflowRegistry()` in daemon startup and pass into `ThreadManager`.

2. Phase 1: add persistence/API compatibility seam. ✅ Completed (2026-03-04)
- Add `threads.workflow_id` and `threads.workflow_data` (JSON text) via migration.
- Add `threads.workflow_version` for workflow-data schema upgrades.
- Keep `environmentId` fully supported; derive it from workflow when omitted.
- API/schema changes:
  - Add optional `workflowId` to `SpawnThreadRequest`/`spawnThreadSchema`.
  - Keep accepting `environmentId` as legacy input and map it to Phase 1 workflows (`local` -> `direct`, `worktree` -> `worktree`).
  - Keep accepting `workflowId: "local"` as a compatibility alias and normalize to `workflowId: "direct"` at ingestion.
  - If both are present and conflict, return a clear validation error.

3. Phase 1: rewire spawn and operation resolution to workflow. ✅ Completed (2026-03-04)
- In `ThreadManager.spawn`, resolve workflow first and invoke `workflow.createWorkspace`.
- Persist `workflowDataPatch` onto `threads.workflow_data`.
- Provisioning behavior is fail-loud by default (no transparent degradation to another environment).
- Compose instructions in one place:
  - project workflow instructions,
  - `workflow.buildDeveloperInstructions(...)`,
  - request-specific developer instructions.

4. Phase 1: implement built-in workflows with parity. ✅ Completed (2026-03-04)
- `direct` workflow:
  - `createWorkspace` returns project root `cwd`,
  - minimal `workflow_data`,
  - no special workspace action rules beyond current defaults.
- `worktree` workflow:
  - `createWorkspace` provisions git worktree and persists relevant workspace info in `workflow_data`,
  - retains current guided instructions and promotion/squash semantics.

5. Phase 1: move actions to workflow-owned status model. ✅ Completed (2026-03-04)
- Add `getWorkflowStatusInfo` + `getWorkspaceStatusInfo` call paths in daemon and UI hydration.
- Refactor thread actions to resolve via `workflow.getWorkflowActions(...)` instead of hardcoded `environmentId` branches.
- Keep API compatibility by mapping existing operation endpoints to built-in workflow action ids.
- Keep behavior parity for built-ins (`direct`, `worktree`) in Phase 1.
- Emit action lifecycle using `system/workflow_action`.
- Migrate existing direct/worktree operation events into `system/workflow_action` envelope.

6. Phase 1: UI migration with compatibility. ✅ Completed (2026-03-04)
- Prefer workflow terminology in UI; show `Direct Workspace` for `direct`.
- Thread display metadata (icon/label/sort hint) resolves from workflow definition.
- Action menus/buttons render from workflow action catalogs filtered by workflow status.
- Diff surfaces are unified behind `getWorkspaceDiffInfo`:
  - prompt banner uses `verbose: false`,
  - secondary diff panel uses `verbose: true`.
- No `getSecondaryPanelInfo*` hook in Phase 1.
- No manager-specific UI in Phase 1.

7. Phase 1: archive lifecycle integration. ✅ Completed (2026-03-04)
- On thread archive, resolve workflow and invoke `workflow.deleteWorkspace` with persisted `workflow_data`.
- Remove cleanup responsibility from runtime return objects.

8. Phase 1: registry diagnostics and precedence groundwork. ✅ Completed (2026-03-04)
- Borrow `pi-mono` style ideas:
  - source metadata (`source/scope/origin`) for workflow definitions,
  - deterministic precedence (project > user > built-in),
  - collision diagnostics instead of silent overrides.
- Phase 1 can keep registration internal-only, but with external-ready code paths.

9. Phase 1: post-merge hardening and operational handoff. ✅ Completed (2026-03-04)
- Stabilized workspace test resolution so `pnpm test` does not depend on stale package `dist` outputs.
- Added CLI workflow/environment spawn selectors with strict conflict validation.
- Restored daemon support for `BEANBAG_ENVIRONMENT` as the default workflow selector when explicit request/thread data is absent.
- Added daemon unit/e2e coverage for the above behavior and documented handoff context for Phase 2.

# Validation
1. Phase 1 compatibility checks
- Existing flows that only send `environmentId` continue to work.
- Existing local/worktree operation behaviors are unchanged except that provisioning failures are explicit (no implicit fallback), with local mapped to direct.
- Existing tests for provisioning, operations, and UI pass with workflow plumbing enabled.

2. Phase 1 status and actions
- `getWorkflowStatusInfo` and `getWorkspaceStatusInfo` return deterministic status objects for direct/worktree.
- UI action visibility and enabled/disabled state match workflow status outputs.
- Legacy operation endpoints correctly dispatch to workflow actions.

3. Phase 1 diagnostics
- Workflow collision/precedence tests verify deterministic winner selection and surfaced warnings.
- Workflow data validation tests ensure malformed `workflow_data` fails fast.
- Workflow data migration tests verify `workflow_version` upgrades are deterministic.
- Provisioning contract tests verify failures are surfaced and threads enter `provisioning_failed` without silent fallback.
- Archive lifecycle tests verify `deleteWorkspace` receives persisted workflow data and performs cleanup/no-op per workflow.
- Provisioning projection tests verify deterministic bundling of `started/detail*/terminal` events.
- Workflow action projection tests verify deterministic rendering for migrated direct/worktree action events.

4. 2026-03-04 merged-main verification
- Full workspace test suite passed on `main` after cherry-picking follow-up commits:
  - `pnpm test` -> passing (`41` test files, `545` tests at time of run).
- Targeted daemon checks passed for workflow selector hardening:
  - `pnpm --filter @beanbag/daemon test src/__tests__/thread-manager.test.ts`
  - `pnpm --filter @beanbag/daemon test src/__tests__/e2e/thread-spawn-roundtrip.test.ts`

# Open Questions/Risks
- Naming lock: use `direct` as the canonical workflow id/display name; keep `local` as a legacy alias for environment/workflow compatibility paths.
- Phase 1: do we permit only built-ins initially, or enable project-level registration behind a flag?
- Should `workflow_data` be typed per workflow version to support migrations safely?
- What is the trust model for future external workflow definitions (code execution risk)?

Deferred explicitly:
- Manager workflow (`HATCH.md`, `INSTRUCTIONS.md`, long-lived notes/preferences memory, manager-specific sidebar/panel UX).
