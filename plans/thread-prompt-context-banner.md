# Thread Prompt Context Banner Plan

Status: revised draft for Michael review. Do not implement UI or code changes until sign-off.

## Goal

Replace the current git-only strip above the thread follow-up composer with a high-signal thread context banner. The banner should answer: "What should I know before I send this next message?"

The banner should adapt by thread context:

- Regular threads: keep the current git status behavior and add clean ahead/behind/diverged states when available.
- Manager threads: show active managed threads that the manager is waiting on, with a `Stop all` affordance when there are active managed children.
- Managed threads: make manager ownership visible before the user sends a direct message.
- All threads: show pending TODOs collapsed by default, with user-controlled expansion.

## Product Decisions For Michael

Implementation should not start until Michael signs off on these first-pass product choices. The recommendations below are treated as planning assumptions in the rest of this document.

1. Should clean up-to-date regular threads show a banner?
   - Recommendation: no. Keep the surface high-signal.

2. Should errored managed child threads count as managed work worth showing?
   - Recommendation: yes, but label them as needing attention rather than as stoppable active work.

3. Should failed plan steps appear in the TODO section?
   - Recommendation: no for the first pass. Treat failed work as a separate future signal if needed.

4. Should TODO expansion persist across visits?
   - Recommendation: no. Start with local per-thread state that resets on thread change.

5. Should manager threads with no active children show `No active managed threads`?
   - Recommendation: no. Hide the section unless it has signal.

6. Should the CLI adopt the same prompt-context API now?
   - Recommendation: no. Keep this first pass app-focused and avoid widening the scope.

7. If merge-base ahead/behind counts exist but committed file stats are missing or empty, should the banner still show branch divergence?
   - Recommendation: yes. Show textual branch divergence and omit expansion.

8. If the prompt-context query fails, should the banner show a general error?
   - Recommendation: no by default. Preserve managed-by fallback when possible, omit uncertain manager-work/TODO sections, and keep the composer usable.

9. Should a `turn/plan/updated` explanation or plan-level label appear in the TODO banner?
   - Recommendation: no for the first pass. Show step text only unless the explanation is short and clearly useful; revisit after seeing real provider plan snapshots.

## Existing Locations And Data Sources

Current app UI path:

- `apps/app/src/views/ThreadDetailView.tsx`
  - Loads `thread`, `parentThread`, `timeline`, `environment`, and `workspaceStatus`.
  - Computes `workspaceChangedFilesSection`, `promptBannerSummary`, `showPromptGitStatsBanner`, `canExpandPromptChangeList`, and passes banner props into `ThreadDetailPromptArea`.
- `apps/app/src/views/ThreadDetailPromptArea.tsx`
  - Owns current prompt-banner expansion state via `isChangeListExpanded`.
  - Passes a `banner` prop object to `ThreadFollowUpComposer`.
- `apps/app/src/views/ThreadFollowUpComposer.tsx`
  - Renders the current rounded muted git banner above queued follow-ups and `PromptBox`.
  - Uses `WorkspaceChangesList` and `MergeBaseBranchPicker`.
- `apps/app/src/lib/workspace-change-summary.tsx`
  - `selectWorkspaceChangedFilesSection` decides whether a changed-files section exists.
  - This is why clean ahead/behind status currently does not show in the prompt banner.
- `apps/app/src/lib/workspace-status.tsx`
  - `getGitStatusDisplay` already formats `Ahead`, `Behind`, and `Diverged`.
  - `apps/app/src/lib/workspace-status.test.ts` already covers those display states.

Current git data path:

- `useEnvironmentWorkStatus` in `apps/app/src/hooks/queries/environment-queries.ts`
- `api.getEnvironmentWorkStatus` in `apps/app/src/lib/api.ts`
- `GET /api/v1/environments/:id/status` in `apps/server/src/routes/environments.ts`
- Host command `workspace.status`
- Domain contract `WorkspaceStatus` in `packages/domain/src/thread.ts`
  - `workspaceStatus.workingTree.state`
  - `workspaceStatus.mergeBase.aheadCount`
  - `workspaceStatus.mergeBase.behindCount`
  - `workspaceStatus.mergeBase.mergeBaseBranch`
  - `workspaceStatus.mergeBase.files`

Current manager/managed data path:

- `ThreadWithRuntime.type` and `ThreadWithRuntime.parentThreadId` in `packages/domain/src/thread.ts`
- `ThreadListEntry` includes runtime display status and `hasPendingInteraction`.
- `GET /api/v1/threads?projectId=...&parentThreadId=...&archived=false` already exists.
- `ThreadDetailView.tsx` currently loads all project threads only to build manager selector options. The new banner should not rely on that broad list for active managed work.

Current TODO data situation:

- `TodoWrite` is known to thread-view formatting in `packages/thread-view/src/tool-call-parsing.ts`.
- The existing private `asTodoWriteTodos` parser in that file already normalizes loose provider arguments into `{ content, status, activeForm }` values. The implementation should replace it with a canonical zod-backed thread-view helper instead of duplicating ad hoc parsing.
- `TodoRead`, `TodoWrite`, and `ToolSearch` are suppressed from timeline rows by `packages/thread-view/src/tool-call-suppression.ts`.
- Provider plan snapshots also exist as `turn/plan/updated` events. The event has a `plan` array; each step has its own optional `status` field whose value can be `pending`, `active`, `completed`, or `failed`.
- There is no first-class API contract for "pending TODOs" today. The banner should not parse raw timeline rows client-side, especially because the relevant tool calls are intentionally suppressed.

## Recommended Architecture

Keep the banner as an app-composed surface, with two data lanes:

- Git/workspace context stays on the existing environment status route because it depends on host-local workspace inspection.
- Thread-context data that is not workspace state should come from a new typed server route:
  - `GET /api/v1/threads/:id/prompt-context`
  - This avoids broad client-side thread filtering and avoids exposing raw provider tool arguments to the app.

The split is intentional for the first pass:

- Workspace status is host-local, already has an environment-scoped refresh cadence, and already powers diff-panel and merge-base picker behavior.
- Prompt context is server-derived thread state and should not wait on host workspace inspection or make the daemon responsible for manager/TODO policy.
- The app should compose the two lanes into one banner view model so users see one surface even though data ownership remains split.
- Treat this split as the expected architecture until the server has a typed way to request or cache host-local workspace status without taking daemon-owned policy into the server. Do not fold git into the prompt-context route merely because two app queries feel noisy; revisit only if a concrete daemon/server boundary exists for workspace status and the app can keep diff-panel and merge-base behavior equivalent.

Add shared contracts rather than view-local inline types:

- Domain package: `packages/domain/src/thread-prompt-context.ts`
- Server contract: `packages/server-contract/src/api-types.ts`
- Public route docs: `packages/server-contract/src/public-api.ts`

Use repo naming conventions:

- Schemas: `threadPromptContextResponseSchema`, `threadPromptManagementContextSchema`, `threadPromptManagedThreadListSchema`, `threadPromptPendingTodosSchema`, `threadPromptPendingTodoItemSchema`
- Types: `ThreadPromptContextResponse`, `ThreadPromptManagementContext`, `ThreadPromptManagedThreadList`, `ThreadPromptPendingTodos`, `ThreadPromptPendingTodoItem`

Proposed response shape:

```ts
type ThreadPromptContextResponse = {
  threadId: string;
  management: ThreadPromptManagementContext;
  pendingTodos: ThreadPromptPendingTodos;
};

type ThreadPromptManagementContext = {
  manager: ThreadPromptThreadRef | null;
  activeManagedThreads: ThreadPromptManagedThreadList;
};

type ThreadPromptThreadRef = {
  id: string;
  displayTitle: string;
};

type ThreadPromptManagedThread = ThreadPromptThreadRef & {
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  hasPendingInteraction: boolean;
  latestAttentionAt: number;
  updatedAt: number;
};

type ThreadPromptManagedThreadList = {
  items: ThreadPromptManagedThread[];
  totalCount: number;
  limit: number;
  stoppableCount: number;
};

type ThreadPromptPendingTodos =
  | { kind: "not_observed" }
  | {
      kind: "unparseable";
      observedCandidateCount: number;
      latestCandidateSeq: number;
      latestCandidateSource: "todoWrite" | "turnPlan";
    }
  | {
      kind: "observed";
      source: "todoWrite" | "turnPlan";
      sourceSeq: number;
      updatedAt: number;
      items: ThreadPromptPendingTodoItem[];
    };

type ThreadPromptPendingTodoItem = {
  id: string;
  text: string;
  status: "pending" | "in_progress";
};

type ThreadManagerBulkStopOutcome =
  | "requested"
  | "alreadyStopping"
  | "skipped"
  | "failed";

type ThreadManagerBulkStopSkippedReason =
  | "notStoppable"
  | "missingEnvironment"
  | "environmentUnavailable"
  | "archived"
  | "deleted"
  | "reparented"
  | "crossProject";

type ThreadManagerBulkStopChildResult =
  | {
      threadId: string;
      outcome: "requested" | "alreadyStopping";
    }
  | {
      threadId: string;
      outcome: "skipped";
      reason: ThreadManagerBulkStopSkippedReason;
    }
  | {
      threadId: string;
      outcome: "failed";
      message: string;
    };

type ThreadManagerBulkStopResponse = {
  managerThreadId: string;
  requestedCount: number;
  alreadyStoppingCount: number;
  skippedCount: number;
  failedCount: number;
  results: ThreadManagerBulkStopChildResult[];
};
```

Notes:

- Use zod schemas as the source of truth, exported from shared packages.
- `management.manager: null` means the thread is not managed. This is allowed because unmanaged has distinct semantic meaning.
- `ThreadPromptThreadRef.displayTitle` is computed on the server as `title?.trim() || titleFallback?.trim() || id`.
- `management.activeManagedThreads.limit` is always explicit so the UI can explain truncation without relying on a hidden server default.
- The client computes managed-thread truncation as `totalCount > items.length`; do not include a redundant `truncated` boolean that could drift from the counts.
- `management.activeManagedThreads.items` represents managed work worth showing; `stoppableCount` is a separate lifecycle predicate for stop affordances.
- `pendingTodos.kind === "not_observed"` means no provider TODO or plan snapshot candidate was observed for the thread inside the bounded scan.
- `pendingTodos.kind === "unparseable"` means one or more TODO/plan candidates were observed inside the bounded scan, but none could be converted into a valid snapshot. The server should log or meter this because it usually indicates provider-shape drift or corrupt stored data.
- `pendingTodos.kind === "observed"` with `items: []` means the latest valid snapshot exists and has no pending or in-progress items.
- Do not expose `unknown` to the app. Parse `TodoWrite` arguments at the server/thread-view boundary with a zod-backed helper.

## Data Semantics

### Git Status

Use the existing `WorkspaceStatus` contract and `getGitStatusDisplay`.

Show a git section for standard threads when one of these is true:

- `workingTree.state` is `untracked`, `dirty_uncommitted`, `committed_unmerged`, or `dirty_and_committed_unmerged`.
- `mergeBase.aheadCount > 0` or `mergeBase.behindCount > 0`, including when `workingTree.state === "clean"`.
- `mergeBase.files.length > 0`, when available.
- Workspace is deleted or status failed with a durable error worth surfacing.

Recommendation: keep clean up-to-date regular threads quiet. This preserves the high-signal goal and avoids turning the banner into persistent chrome.

Open git-data edge:

- If `aheadCount` or `behindCount` is positive but `mergeBase.files` is empty or missing, show the ahead/behind/diverged text and omit file expansion. Do not treat missing file stats as an error.

### Active Managed Threads

The new prompt-context server route should query child threads by `parentThreadId` and target `projectId`, then exclude archived children in SQL.

Use two predicates instead of one overloaded "active" concept:

1. Shown managed work: child threads the manager may still be waiting on or needs to handle.
2. Stoppable managed work: child threads that can currently receive a stop request through the existing lifecycle stop path.

Recommendation for shown managed work:

- Include `created`, `provisioning`, `active`, `host-reconnecting`, `waiting-for-host`, and `error`.
- Exclude `idle`.
- Include `hasPendingInteraction` in the returned item so the UI can label approval-blocked work.
- Apply an explicit soft cap, for example `THREAD_PROMPT_ACTIVE_MANAGED_THREAD_LIMIT = 20`.
- Return `{ items, totalCount, limit, stoppableCount }` so the UI can show the visible subset, preserve the true count, and decide whether manager stop controls should appear.
- Sort by status priority first, then `latestAttentionAt` descending:
  - pending interaction
  - error
  - active or host reconnecting
  - waiting for host
  - provisioning or created

This frames the section as "work the manager may still be waiting on or needs to handle" rather than a literal DB status list.

If `totalCount > items.length`, the collapsed summary should use the true count, for example `Waiting on 37 managed threads`, and the expanded list should end with a compact note such as `Showing 20 of 37`.

Recommendation for stoppable managed work:

- `stoppableCount` counts same-project, non-archived child threads that satisfy the same lifecycle predicate as `requestThreadStopIfNeeded`: `thread.status === "active" || hasActiveThreadStartOperation(deps, thread.id)`, and have a usable environment `{ id, hostId }` at read time.
- Because active start operations are not represented by thread status alone, compute `stoppableCount` in the server prompt-context service with the lifecycle helper or equivalent operation lookup. Do not approximate it only from runtime display status.
- `created` and `provisioning` child threads can contribute to `stoppableCount` when they have an active start operation and usable environment. They still render as shown managed work either way.
- `idle` and `error` child threads may still be shown as managed work, but they should not contribute to `stoppableCount` unless the lifecycle owner changes its stop eligibility.
- The `Stop all` button is gated by `stoppableCount > 0`, not by `items.length > 0` or `totalCount > 0`.
- The UI copy should avoid implying that every shown managed child is stoppable. For example, use `Waiting on 6 managed threads` for the section summary and `Stop all` for the lifecycle-stoppable subset.

Manager stop control:

- Show a `Stop all` button only for manager threads where `activeManagedThreads.stoppableCount > 0`.
- Place the button near the managed-work summary as a high-signal manager-control affordance, not buried inside the expanded list.
- The target set is the stoppable managed-work subset above, resolved server-side at action time.
- Do not mutate child `status` client-side. The action must use existing or appropriate lifecycle stop semantics, such as the existing per-thread `POST /api/v1/threads/:id/stop` path or a server-side manager bulk-stop route that calls the same `requestThreadStopIfNeeded` flow for each target child.
- Prefer a server-side bulk stop endpoint for `Stop all` so truncated manager lists still stop every stoppable managed child, not only the visible capped `items`.
- Require a confirmation step when `stoppableCount > 1`, with copy that states how many stoppable managed threads will be stopped. A single stoppable child may use the existing stop interaction pattern.
- The banner should update as children complete, stop, reconnect, or leave active status through the existing child-to-parent prompt-context invalidation path.

Bulk-stop semantics:

- Add or reuse an action route that first authorizes the manager thread with the same project checks as the prompt-context read route: `requirePublicThread`, then `requirePublicProject(managerThread.projectId)`.
- The route must assert the target thread is a manager and resolve child targets by `parentThreadId = managerThread.id`, `projectId = managerThread.projectId`, non-archived/live state, and the stoppable predicate above. Same-project enforcement must happen in the query or service, not only in UI assumptions.
- The route must resolve each target child's environment before calling the lifecycle owner. Use the child `environmentId` to load the environment and obtain `{ id, hostId }`; if the environment is missing, deleted, or otherwise unusable for stop dispatch, return a typed `skipped` result with `missingEnvironment` or `environmentUnavailable`.
- The route should call the existing lifecycle stop owner for each target child, for example `requestThreadStopIfNeeded`, instead of directly mutating child status.
- Repeated clicks are idempotent: already stopping or already stopped children should not cause the whole operation to fail.
- Partial failures should return `ThreadManagerBulkStopResponse`, with per-child outcomes `requested`, `alreadyStopping`, `skipped`, or `failed`, plus aggregate counts. The UI can show a compact failure message and rely on invalidation/refetch for final state.
- If a child is reparented, archived, deleted, or leaves the stoppable state while the route is resolving targets, skip it unless the lifecycle stop owner says the stop request is still valid.
- If the server cannot safely scope the manager and same-project child target set, fail the action before issuing any stop requests.
- Bulk stop is intentionally non-atomic. Target resolution and per-child lifecycle requests have a time-of-check/time-of-use window; correctness comes from rechecking each child before dispatch and reporting typed per-child outcomes, not from wrapping fan-out in one transaction.
- This route should not create a new durable bulk lifecycle unless product later needs one. The durable lifecycle remains per child thread, so lost daemon results, reconnect reconciliation, expired commands, and repeated requests continue to be owned by the existing thread lifecycle module.

### Managed Thread Status

Use the prompt-context `management.manager` reference for the banner copy and link target. This avoids depending on a separate parent-thread query just for the banner.

Ownership invariants:

- Create/update ownership should continue to use `assertValidManagerParentThread` so `parentThreadId` references only a live manager thread in the same project.
- The prompt-context read route should silently exclude dirty cross-project refs rather than failing the whole banner. Include `management.manager` only when the parent exists, is a live manager, and `parent.projectId === thread.projectId`.
- Active managed child queries must be scoped to the target thread's project, so dirty cross-project child refs are not returned.

Recommended collapsed text:

- `Managed by <manager title>`
- Link to the manager thread.
- Treat this as high-signal on its own. A managed thread with no git changes and no pending TODOs should still show the banner so the user does not accidentally bypass the manager.

### Pending TODO Extraction Contract

The server should derive the latest known pending TODO snapshot from raw stored events, not timeline rows.

Ownership:

- SQL owns candidate selection only.
- TypeScript owns event decoding, zod validation, snapshot conversion, ordering, and latest-snapshot selection.
- The app receives only the typed `ThreadPromptPendingTodos` contract.

Candidate rows:

- Define an explicit server constant, for example `THREAD_PROMPT_TODO_CANDIDATE_LIMIT = 200`.
- Rationale: 200 recent actual TODO/plan candidate rows bounds route latency and DB work on long-running threads while covering normal active TODO/plan churn. Treat it as a tunable server constant, not a product-visible limit.
- Apply `THREAD_PROMPT_TODO_CANDIDATE_LIMIT` only after narrowing to actual `TodoWrite` tool calls and `turn/plan/updated` rows. Do not select 200 generic `toolCall` rows and then filter them in TypeScript; a burst of unrelated tool calls could otherwise hide an older valid `TodoWrite` snapshot.
- The current indexed event fields identify only `item_kind = 'toolCall'`; the tool name lives inside event JSON, currently under `item.tool`. The first implementation must add schema/index support before relying on the limit:
  - Recommendation: add an indexed stored-event projection for tool-call base name, for example `item_tool_name` or `item_base_tool_name`, derived when event rows are stored.
  - Acceptable alternative: add an equivalent expression index and SQL predicate over the JSON tool-name path, with `EXPLAIN` verification that the route does not scan recent generic tool calls.
- Select recent rows for the target thread with an explicit two-branch predicate so `turn/plan/updated` rows are not filtered out by `item_kind = 'toolCall'` and unrelated tool calls do not count against the candidate limit:

```sql
WHERE threadId = ?
  AND (
    (
      type IN ('item/started', 'item/completed')
      AND item_kind = 'toolCall'
      AND item_tool_name = 'TodoWrite'
    )
    OR type = 'turn/plan/updated'
  )
```

- TypeScript should still validate that selected tool-call rows are actually `TodoWrite`, but this must be a defensive check, not the first real narrowing step after the limit.
- Confirm index coverage for both branches before implementation. If the combined `OR` produces a poor query plan, use an indexed `UNION ALL` of tool-call and `turn/plan/updated` candidates before applying the shared ordering and limit.
- Order candidates by `sequence DESC`, with deterministic fallback ordering by `createdAt DESC`, then `id DESC`.
- Apply `LIMIT THREAD_PROMPT_TODO_CANDIDATE_LIMIT` after actual `TodoWrite`/`turn/plan/updated` filtering and ordering. Do not scan an unbounded event history on this route.
- Stored event `sequence` is unique per thread today, but the fallback keeps behavior deterministic if fixtures, migrations, or future sources ever produce ambiguous ordering.

Parser reuse:

- Replace the existing private `asTodoWriteTodos` parsing path in `packages/thread-view/src/tool-call-parsing.ts` with one canonical exported helper, for example `parseTodoWriteTodos`.
- Back that helper with zod schemas such as `todoWriteArgsSchema` and `todoWriteTodoSchema`.
- Remove the current `toRecord`/`asString` TodoWrite shortcuts as part of the parser extraction. The implementation should not merely wrap or rename defensive parsing that the zod schema should own.
- Keep the helper tolerant at the provider boundary, but return a strongly typed internal result. Invalid entries and invalid statuses should be dropped from the snapshot rather than passed through.
- Update the `formatTodoWriteCommand` caller in the same commit as the parser extraction and delete `asTodoWriteTodos` so no dead parser path remains.
- Keep `ParsedTodoWriteArgs` and `ParsedTodoWriteTodo` internal to `@bb/thread-view`; the app-facing and server-contract shape remains `ThreadPromptPendingTodos`, which hides completed/failed entries and provider-specific parser details.
- Define a text cap such as `THREAD_PROMPT_TODO_TEXT_MAX_LENGTH = 240`.
- At the parser boundary, trim TODO content and plan-step text, drop items whose text is empty after trim, and truncate accepted text to the cap before returning typed prompt-context data.

Proposed parser shape:

```ts
type ParsedTodoWriteTodo = {
  content: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  activeForm: string | null;
};

type ParsedTodoWriteArgs = {
  todos: ParsedTodoWriteTodo[];
};
```

Snapshot selection:

- Convert each parseable candidate row into one snapshot candidate. A parsed-empty candidate is valid and represents an observed empty snapshot.
- Pick the newest valid snapshot by sequence and fallback ordering.
- Prefer `TodoWrite` only when it is the newest valid snapshot. Do not let an older `TodoWrite` override a newer `turn/plan/updated` snapshot.
- If the newest valid snapshot comes from an interrupted turn, keep it as the latest known state. Interruption does not imply the TODO list is invalid.
- If a `TodoWrite` row is orphaned from a completed turn or has no matching result, still accept it when its arguments parse. The TODO snapshot is the requested list state, not a tool success audit.
- If a candidate fails zod validation or cannot be decoded into the expected source shape, skip that invalid candidate and continue searching older candidates within the bounded scan.
- If a candidate parses successfully but yields no TODO items or no plan steps, stop at that candidate and return `{ kind: "observed", items: [] }`. This preserves newest-empty semantics and prevents an older `TodoWrite` snapshot from resurrecting stale work.
- If no TODO/plan candidate rows exist within `THREAD_PROMPT_TODO_CANDIDATE_LIMIT`, return `{ kind: "not_observed" }`; do not perform a second unbounded scan.
- If candidate rows exist within the limit but every candidate is invalid or unparseable, return `{ kind: "unparseable", ... }`, log or meter the parse failures, and omit the TODO section in the UI.
- For `turn/plan/updated`, treat `event.explanation` as source metadata only. Do not include it in the first-pass banner unless Michael signs off on the product question below.

Mapping:

- `TodoWrite.status === "in_progress"` maps to `in_progress`.
- `TodoWrite.status === "pending"` or missing status maps to `pending`.
- Invalid explicit `TodoWrite.status` values are parser-boundary failures for that item and must not surface as `unknown`.
- For `turn/plan/updated`, iterate `event.plan` and map each step independently.
- `step.status === "active"` maps to `in_progress`.
- `step.status === "pending"` or missing status maps to `pending`.
- Completed items are excluded from the banner.
- Failed plan steps should not be included in this first pass unless Michael wants failed work treated as a separate high-signal state.

Empty snapshot semantics:

- A latest valid snapshot with no steps/items, or with only completed or failed items, returns `{ kind: "observed", items: [] }`.
- The UI hides the TODO section for observed-empty snapshots.
- Tests should assert the distinction between `not_observed`, `unparseable`, and observed-empty.

Stable IDs:

- Since provider TODO items do not carry stable IDs, use a server-generated ID derived from source kind, source sequence, and item index, such as `seq:<source>:<sourceSeq>:<index>`.

## UI Structure

Introduce a dedicated component and view model rather than growing the current `banner` prop object:

- `apps/app/src/components/thread/ThreadPromptContextBanner.tsx`
- `apps/app/src/views/threadPromptContextBannerModel.ts`
- Tests alongside the component and helper.

Use existing primitives:

- `StatusPill` from `@bb/ui-core`
- `CollapsibleHeader` or `ExpandablePanel` from `@bb/ui-core`
- `Button`, `Link`, `WorkspaceChangesList`, `MergeBaseBranchPicker`
- Lucide icons for section affordances.

UI consistency constraints:

- Use sanctioned typography utilities already present in nearby components, such as `text-xs`, `text-sm`, and muted foreground tokens.
- Do not introduce arbitrary `text-[Npx]` classes.
- Keep one canonical rendering path for prompt context by the end of the migration.
- Extend `ExpandablePanel` or `CollapsibleHeader` in `@bb/ui-core` if needed to satisfy the accessibility contract below. Do not create a banner-local disclosure primitive or a parallel class bundle for expansion behavior.
- Do not nest UI cards inside the banner.

Banner layout:

- Single rounded strip above queued follow-ups and the prompt box.
- Sections render as compact rows within the same strip:
  - Managed ownership or manager work summary.
  - Git/workspace summary.
  - TODO summary.
- Expanded content appears inside the same strip below its summary row.
- Preserve the current changed-file expansion behavior, but route it through the new banner model.

Recommended section order:

1. Management context: shown managed work or managed-by notice.
2. Git context: workspace or branch state.
3. TODO context: pending work from the latest TODO snapshot.

Collapsed TODO behavior:

- Default collapsed on thread load.
- Summary examples:
  - `3 TODOs - 1 in progress, 2 pending`
  - `TODO in progress: Update prompt banner model`
- Expanded list shows each pending or in-progress item with a small status pill.
- Expansion state should be local component state keyed by `thread.id`; do not persist until there is evidence users need persistence.
- Expanded TODO list max height should be quantified, for example `max-h-32`, then scroll.

Git expanded behavior:

- Keep file list collapsed by default when a file list exists.
- Clean ahead/behind/diverged states have no file-list expansion unless `mergeBase.files.length > 0`.
- Git summary remains clickable to open the diff panel when `canUseGitUi` is true.
- The merge-base picker stays in the git row when branch comparison is available.

Managed work expanded behavior:

- Collapsed summary: `Waiting on 3 managed threads`.
- If `activeManagedThreads.stoppableCount > 0`, show a `Stop all` button next to the collapsed summary or in the same manager-control row.
- Expanded list rows link to child threads and show title, runtime display status, and pending-approval marker when present.
- Expanded managed-thread list max height should be quantified, for example `max-h-40`, then scroll.

## Transition From Current Banner

Replace the current git banner in small implementation steps after sign-off:

1. Add `ThreadPromptContextBannerModel` and build only the current git section from existing props/data.
2. Replace `ComposerBannerProps` with a new cohesive `promptContextBanner` prop while keeping visual parity for the existing git banner.
3. Replace `isChangeListExpanded` with section expansion state keyed by section:
   - `gitFiles`
   - `managedThreads`
   - `todos`
4. Map the current changed-file toggle to `gitFiles`.
5. Add manager and TODO sections to the same component after git parity is covered by tests.
6. Delete the old git-only banner branch and old `ComposerBannerProps` path once parity and new states pass.

End state:

- `ThreadFollowUpComposer.tsx` has one canonical context-banner render path.
- Git, manager, managed-by, and TODO rows are sections in `ThreadPromptContextBanner`.
- The old `banner.showPromptGitStatsBanner` branch no longer exists.

## Loading, Error, And Empty States

Overall banner:

- Hide the entire banner when there are no high-signal sections and no durable error.
- Do not reserve empty vertical space.

Git:

- If cached workspace status exists, keep showing it during refetch.
- If no cached status exists and status is loading, omit the git section unless another section is already rendering, then show compact `Checking workspace...`.
- If the workspace was deleted, show `Workspace deleted`.
- For transient status failures, prefer a compact unavailable state over a toast.

Prompt context:

- Use cached prompt-context data during refetch.
- If loading with no cached data, show no prompt-context sections unless the thread is known managed; for managed threads show `Checking manager...` only if the manager reference is not already available from `thread.parentThreadId`.
- If the prompt-context query fails:
  - A managed thread should still show a fallback managed-by notice when `thread.parentThreadId` is known, even if the manager title is unavailable.
  - Manager active-child and TODO sections should be omitted because stale or failed context could mislead.
  - If no other section renders, show no banner unless Michael wants a visible `Thread context unavailable` state.

Empty states:

- Regular clean up-to-date unmanaged thread with no pending TODOs: no banner.
- Manager thread with no shown managed work and no pending TODOs: no banner.
- Managed thread with no other context: show the managed-by notice because managed ownership is itself high-signal.
- Latest TODO source exists but no pending or in-progress items: no TODO section.

## Accessibility

- Wrap the banner in a `section` with `aria-label="Thread context before sending"`.
- Use real buttons for expandable sections with `aria-expanded` and `aria-controls`.
- Expanded bodies should be named regions, for example `role="region"` with `aria-labelledby` pointing to the section button.
- Do not put click handlers on non-interactive parent divs for primary actions.
- Keep links to manager and managed child threads keyboard-focusable.
- Expanded TODO and managed-thread lists should have clear list semantics.
- Status-only icons must have text labels or `aria-hidden`.
- The banner must remain usable at narrow widths:
  - Truncate thread titles and paths.
  - Keep action buttons from shrinking below their icon target.
  - Move secondary metadata to the next line rather than overlapping.

## App Implications

Add app API and hooks:

- `api.getThreadPromptContext(threadId)`
- `useThreadPromptContext(threadId, { enabled })`
- `threadPromptContextQueryKey(threadId)`
- `allThreadPromptContextQueryKeyPrefix()`

Refactor app composition:

- `ThreadDetailView.tsx` should build a `ThreadPromptContextBannerModel` from:
  - `thread`
  - `workspaceStatus`
  - `workspaceStatusError`
  - `workspaceChangedFilesSection`
  - `showBranchComparisonUi`
  - `effectiveMergeBaseBranch`
  - `threadPromptContext`
  - relevant loading/error flags
- `ThreadDetailPromptArea.tsx` should own only local section expansion state and pass a cohesive context-banner prop.
- `ThreadFollowUpComposer.tsx` should render `ThreadPromptContextBanner` above `QueuedFollowUpList`.

## Realtime Invalidation Plan

Current realtime cache effects mostly invalidate by changed thread id and by environment id. Parent-child prompt context needs explicit plumbing.

Add query-key plumbing:

- Add a dedicated prompt-context query key and an all-query prefix.
- Do not add `threadPromptContextQueryKeyPrefix(threadId)` in the first pass because there is only one prompt-context query shape per thread. Add a thread-scoped prefix only if future prompt-context queries become parameterized.
- Add `allThreadPromptContextQueryKeyPrefix()` to invalidate all prompt-context queries on reconnect/global fallbacks.

Self invalidations:

- Invalidate `threadPromptContextQueryKey(threadId)` when that thread receives:
  - `events-appended`
  - `interactions-changed`
  - `status-changed`
  - `title-changed`
  - `archived-changed`
- For `thread-deleted`, invalidating the deleted thread's own prompt-context query is not useful after the detail view leaves. The important work is parent/all-query invalidation so a manager banner stops showing the deleted child.

Omitted self invalidations:

- Do not invalidate prompt context on `queue-changed`; queued follow-up drafts are already rendered and invalidated through thread draft queries, and they do not affect git, managed ownership, shown managed work, stoppable counts, or TODO snapshots.
- Do not invalidate prompt context on `read-state-changed`; read/unread state does not affect any prompt-context section.

Child-to-parent invalidations:

- When a changed thread has a known cached `parentThreadId`, invalidate `threadPromptContextQueryKey(parentThreadId)`.
- Derive the parent id from cached `ThreadWithRuntime` entries first, then cached `ThreadListEntry` entries.
- If the parent id is not cached but the change could affect manager active-child context, invalidate `allThreadPromptContextQueryKeyPrefix()` as a conservative fallback.
- For `thread-created`, `thread-deleted`, and global list changes where the parent cannot be known from the changed id, use the all-query fallback unless the server extends changed messages with parent metadata.

Parent-to-child invalidations:

- Managed child prompt-context responses embed `management.manager.displayTitle`, link target, and live/existence status. A manager `title-changed`, `archived-changed`, or `thread-deleted` message arrives on the manager thread id, not on each child.
- When a changed manager thread has cached children, derive child ids from cached `ThreadWithRuntime` and `ThreadListEntry` records where `parentThreadId === managerThreadId`, then invalidate `threadPromptContextQueryKey(childThreadId)` for each child.
- If cached child coverage is incomplete or the manager was deleted/archived and child ids cannot be trusted, invalidate `allThreadPromptContextQueryKeyPrefix()` so managed-child banners do not retain stale manager names, links, or existence.
- Add tests for manager title, archive, and delete changes invalidating managed-child prompt-context queries.

Ownership and reparenting invalidations:

- Reparenting is supported by broad invalidation in the first pass:
  - Invalidate the child thread prompt-context query when the changed child is known.
  - Invalidate `allThreadPromptContextQueryKeyPrefix()` on `events-appended` changes that may represent a thread ownership event, because the current realtime message only carries `{ id, changes }` and does not identify appended event types.
  - Invalidate `allThreadPromptContextQueryKeyPrefix()` on project `threads-changed` or global list changes that could represent reparenting.
  - Do not pretend targeted old/new parent invalidation is available from today's realtime payloads.
- A targeted ownership-change path is explicitly out of scope for the first pass. It would require adding a new `ThreadChangeKind`, updating realtime schemas, and emitting a payload with `previousParentThreadId` and `nextParentThreadId` from the server hub.
- Cached parent-id derivation is acceptable for ordinary child status, interaction, title, and archive changes because stale parent data only causes extra invalidation or the all-query fallback. It is not sufficient for ownership changes, where stale cache can miss either the old or new parent.

Open implementation choice:

- Recommendation: start with cached parent-id derivation for ordinary child changes, cached child derivation for manager-to-child title/archive/delete changes, and all-query fallback for ownership-related `events-appended` cases. Do not extend realtime message payloads in this first pass unless performance data shows the fallback is too broad.

## API And CLI Implications

API:

- Add `GET /api/v1/threads/:id/prompt-context`.
- Document it in `packages/server-contract/src/public-api.ts`.
- Keep the route read-only and derived from existing DB state.
- Do not add accepted-but-ignored query fields.
- Resolve the target with `requirePublicThread(deps.db, threadId)`, then explicitly call `requirePublicProject(deps.db, thread.projectId)`.
- This is intentionally stricter than the current `GET /api/v1/threads/:id` route, which currently relies on `requirePublicThread` alone. The new endpoint should close that route gap rather than copying it.
- Include the sibling route auth alignment in the same backend slice: update existing `GET /api/v1/threads/:id` to require `requirePublicProject(thread.projectId)` after `requirePublicThread`. Leaving the old route looser would make the new prompt-context auth behavior inconsistent and confusing.
- Only include manager and child thread references from the same project as the target thread. Dirty cross-project refs should be silently excluded from this read endpoint.
- Add or reuse an action route for manager `Stop all`. Recommendation: add a server-side manager bulk-stop route so the server resolves all same-project stoppable managed children and calls the existing lifecycle stop path for each child. This avoids client fan-out over a capped list and avoids any client-only status mutation.
- The manager bulk-stop route must mirror prompt-context route authorization: resolve the manager with `requirePublicThread`, require `requirePublicProject(managerThread.projectId)`, assert the manager type, and enforce same-project child targeting before fan-out.
- The manager bulk-stop route response should make partial outcomes observable with typed counts/results rather than a single ambiguous success boolean.

CLI:

- No required CLI change for the first implementation.
- Existing `bb status` and `bb manager` commands already show basic parent/managed thread information.
- Future CLI enhancement could use the same prompt-context route to show pending TODOs or active managed work, but that should be a separate product decision.

## Implementation Slices After Sign-Off

1. Contract and server data
   - Add domain/server-contract schemas for prompt context.
   - Add domain/server-contract schemas for `ThreadManagerBulkStopResponse`, `ThreadManagerBulkStopChildResult`, and their outcome/reason enums.
   - Include manager `stoppableCount` in the prompt-context response.
   - Replace the existing `asTodoWriteTodos` TodoWrite parser with a canonical exported zod-backed parser, and update existing call sites in the same commit.
   - Add a server service to build prompt context from thread records and candidate stored events.
   - Add zod and server route/service tests for unmanaged, managed, manager shown-work vs stoppable predicates, managed-child truncation, route auth/project scoping, existing `GET /api/v1/threads/:id` project-auth alignment, dirty cross-project ref exclusion, TODO extraction, non-`TodoWrite` tool-call filtering, unrelated tool calls not consuming the TODO candidate limit, mixed `TodoWrite` and `turn/plan/updated` newest-wins selection, TODO candidate limit exhaustion, unparseable TODO candidates, observed-empty TODO snapshots, interrupted snapshots, and orphaned `TodoWrite` snapshots.
   - Add server action tests for manager `Stop all`: route auth/project scoping, no stoppable children, one stoppable child, multiple stoppable children, active-start-operation stoppability, per-child missing/unusable environment skips, mixed shown/stoppable/idle/archived children, partial failure, repeated clicks, children deleted or reparented during resolution, and already-stopping children.
   - Server route/service/action tests must use in-memory SQLite with `createConnection(":memory:")` plus `migrate(db)`, not mocked database modules.

2. App query and cache invalidation
   - Add API client function, query hook, and query keys.
   - Extend realtime cache effects with self invalidations, child-to-parent invalidations, and all-query fallback.
   - Add invalidation tests for self event changes, omitted `queue-changed` and `read-state-changed` changes, cached child parent invalidation, parent-to-child manager title/archive/delete invalidation, first-pass ownership-related `events-appended` all-query fallback, uncached child fallback, deleted child parent/all-query invalidation, and global list fallback.

3. Banner view model and component
   - Add `ThreadPromptContextBannerModel` and `ThreadPromptContextBanner`.
   - Extend and reuse `ExpandablePanel` or `CollapsibleHeader` so expandable banner sections get `aria-controls`, named regions, and `aria-labelledby` without adding a banner-local disclosure primitive.
   - Move current git banner behavior into the new component first.
   - Add collapsed TODO and managed-work expansion states.
   - Add the manager `Stop all` affordance near the managed-thread summary, gated by `stoppableCount > 0`.
   - Add confirmation for multiple active stop targets.
   - Add UI behavior for bulk-stop partial failure/retry states without directly mutating child status.
   - Preserve diff-panel and merge-base picker behavior.
   - Add view-model and component tests for all numbered scenarios in the exit criteria.

4. Thread detail integration
   - Replace the current git-only banner prop shape in `ThreadDetailView`, `ThreadDetailPromptArea`, and `ThreadFollowUpComposer`.
   - Replace `isChangeListExpanded` with section expansion state.
   - Keep queued follow-ups and `PromptBox` behavior unchanged.
   - Remove the old banner render branch once the new path covers git parity and new context sections.

5. Verification and polish
   - Run Turbo validation.
   - Run the app locally and verify with desktop and mobile viewport checks.
   - Confirm typography uses existing tokens and no arbitrary `text-[Npx]` classes.

## Exit Criteria

Planning exit criteria:

1. This plan is committed under `plans/`.
2. Michael reviews the open product decisions and signs off before implementation begins.

Implementation exit criteria after sign-off:

1. Given a standard thread with `workspaceStatus.workingTree.state === "dirty_uncommitted"` and changed files, the banner shows a Dirty git summary, the git file section is collapsed by default, expansion reveals the changed files, and clicking a file opens the diff panel.
2. Given a standard thread with `workspaceStatus.workingTree.state === "untracked"` and untracked files, the banner shows an Untracked git summary and expandable files.
3. Given a standard thread with `workspaceStatus.workingTree.state === "committed_unmerged"` and `mergeBase.files.length > 0`, the banner shows committed-unmerged git context and expandable committed files.
4. Given a standard thread with `workingTree.state === "clean"`, `mergeBase.aheadCount > 0`, and `mergeBase.behindCount === 0`, the banner shows an Ahead git summary even when no files are listed.
5. Given a standard thread with `workingTree.state === "clean"`, `mergeBase.aheadCount === 0`, and `mergeBase.behindCount > 0`, the banner shows a Behind git summary even when no files are listed.
6. Given a standard thread with `workingTree.state === "clean"`, `mergeBase.aheadCount > 0`, and `mergeBase.behindCount > 0`, the banner shows a Diverged git summary.
7. Given a standard unmanaged thread with clean up-to-date workspace status, no prompt-context error, `pendingTodos.kind === "not_observed"`, and no managed ownership, the banner is hidden.
8. Given a standard unmanaged thread with clean up-to-date workspace status, no prompt-context error, `pendingTodos.kind === "unparseable"`, and no managed ownership, the banner is hidden and the server log/metric records the unparseable candidates.
9. Given a standard unmanaged thread with clean up-to-date workspace status, no prompt-context error, observed-empty TODOs, and no managed ownership, the banner is hidden.
10. Given a manager thread with child threads in active, host-reconnecting, waiting-for-host, provisioning, created, or error runtime display states, the banner shows the shown managed-thread count and expansion reveals child links, statuses, and pending-approval markers.
11. Given a manager thread with shown managed work that is not stoppable, such as only `created` without an active start operation or `error` children, the managed-work section renders but the `Stop all` button is hidden.
12. Given a manager thread with a `created` or `provisioning` child that has an active start operation, that child contributes to `stoppableCount` and `Stop all` can target it.
13. Given a manager thread with no shown or stoppable managed children and only idle or archived child threads, the managed-work section is hidden when no pending TODOs exist and no `Stop all` button is shown.
14. Given a manager thread with exactly one stoppable managed child, the banner shows `Stop all` near the managed-thread summary and invokes lifecycle stop semantics for that child without client-side status mutation.
15. Given a manager thread with multiple stoppable managed children, `Stop all` requires confirmation that states how many stoppable managed threads will be stopped.
16. Given a manager thread with mixed shown, stoppable, idle, archived, and dirty cross-project children, `Stop all` targets only same-project stoppable children and excludes idle, archived, non-stoppable, and cross-project children.
17. Given the manager bulk-stop route is called repeatedly while children are already stopping, the route remains idempotent and returns typed per-child outcomes.
18. Given a manager bulk-stop request where a child has no usable environment, the route skips that child with `missingEnvironment` or `environmentUnavailable` and continues handling other children.
19. Given a manager bulk-stop request where one child fails, is deleted, is archived, or is reparented during resolution, the route reports partial outcomes and does not mutate any child status directly.
20. Given shown or stoppable managed children complete or stop, the banner updates so the shown count and `Stop all` visibility reflect the latest child lifecycle state.
21. Given `activeManagedThreads.totalCount > activeManagedThreads.items.length`, the collapsed summary uses `totalCount` and the expanded list shows a truncation note such as `Showing 20 of 37`.
22. Given a managed thread with `management.manager` present, the banner shows a managed-by notice with a link to the manager even when no git or TODO sections render.
23. Given a managed thread where prompt-context loading/error prevents resolving the manager title but `thread.parentThreadId` is known, the banner shows a fallback managed-by notice using the manager id.
24. Given a latest `turn/plan/updated` snapshot with `plan: []`, the route returns `pendingTodos.kind === "observed"` with `items: []` and does not select an older `TodoWrite`.
25. Given a latest valid `turn/plan/updated` snapshot and an older valid `TodoWrite`, the route selects the newer plan snapshot.
26. Given an interrupted turn has the newest valid TODO or plan snapshot, the route keeps it as the latest known TODO state.
27. Given an orphaned `TodoWrite` row has parseable arguments, the route accepts it as a TODO snapshot even without a matching successful tool result.
28. Given 200 newer non-`TodoWrite` tool-call rows and an older valid `TodoWrite` row within the actual TODO/plan candidate limit, the route still selects the `TodoWrite` snapshot because unrelated tool calls do not count against `THREAD_PROMPT_TODO_CANDIDATE_LIMIT`.
29. Given a non-`TodoWrite` tool-call row is returned despite the SQL/index predicate, the TypeScript base-tool-name validation ignores it and does not create a TODO snapshot from it.
30. Given `pendingTodos.kind === "observed"` with one in-progress item and two pending items, the banner shows a collapsed TODO summary with those counts.
31. Given the TODO section is expanded, the UI renders a list of pending/in-progress TODO items with status labels and no completed items.
32. Given `pendingTodos.kind === "observed"` with `items: []`, the TODO section is hidden.
33. Given no TODO/plan candidate rows appear within `THREAD_PROMPT_TODO_CANDIDATE_LIMIT`, the route returns `pendingTodos.kind === "not_observed"` without an unbounded scan.
34. Given TODO/plan candidate rows exist within the limit but every candidate is invalid or unparseable, the route returns `pendingTodos.kind === "unparseable"`, logs or meters the condition, and the UI omits the TODO section.
35. Given any expandable section, the toggle is a button with `aria-expanded`, `aria-controls`, and an associated region.
36. Given mobile-width viewport checks, banner text truncates or wraps without overlapping the prompt box, queued follow-ups, manager `Stop all` button, or footer controls.
37. Given a caller cannot access the target thread's project, `GET /api/v1/threads/:id/prompt-context` rejects after `requirePublicProject(thread.projectId)` even if `requirePublicThread` finds the thread.
38. Given a caller cannot access the target thread's project, existing `GET /api/v1/threads/:id` also rejects after the same project check.
39. Given a caller cannot access a manager thread's project, the manager bulk-stop route rejects before resolving or stopping child threads.
40. Given dirty cross-project manager or child refs exist in the database, prompt-context reads silently exclude them and same-project refs still render.
41. Given a managed child changes status, interactions, archive state, or title, the relevant parent manager prompt-context query is invalidated.
42. Given a manager title changes, cached managed-child prompt-context queries for that manager are invalidated so `management.manager.displayTitle` refreshes.
43. Given a manager is archived or deleted, cached managed-child prompt-context queries for that manager are invalidated or the app falls back to all prompt-context invalidation so child banners do not retain stale manager links.
44. Given a managed child is reparented in the first pass and the realtime message only reports `events-appended`, the app invalidates all prompt-context queries rather than relying on a non-existent old/new parent realtime payload.
45. Given a managed child is deleted and the parent id is unavailable, the app uses all prompt-context query invalidation so manager banners do not retain deleted children.
46. The implementation uses shared contracts and existing UI primitives, and the old git-only banner render path is removed.
47. Turbo typecheck and targeted tests pass.

## Validation Instructions After Implementation

Run targeted checks with Turbo:

```sh
pnpm exec turbo run typecheck --filter=@bb/domain
pnpm exec turbo run typecheck --filter=@bb/thread-view
pnpm exec turbo run typecheck --filter=@bb/server-contract
pnpm exec turbo run typecheck --filter=@bb/server
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/thread-view
pnpm exec turbo run test --filter=@bb/server
pnpm exec turbo run test --filter=@bb/app
```

Manual app scenarios:

- Standard thread with uncommitted files: banner shows git summary, file list expands, file click opens diff panel.
- Standard thread clean but ahead/behind/diverged: banner shows branch comparison summary.
- Standard clean up-to-date thread: banner is hidden unless TODOs or managed-by context exist.
- Manager thread with shown but non-stoppable managed children: managed-work section renders and no `Stop all` button is shown.
- Manager thread with a provisioning child that has an active start operation: `Stop all` is shown and targets that child after environment resolution succeeds.
- Manager thread with no shown or stoppable managed children: no managed-work section and no `Stop all` button are shown.
- Manager thread with one stoppable managed child: banner shows `Stop all`, and activating it uses lifecycle stop semantics for that child.
- Manager thread with multiple stoppable managed children: `Stop all` shows confirmation before stopping workers.
- Manager thread with mixed shown, stoppable, idle, archived, and cross-project children: `Stop all` targets same-project stoppable children only, and the expanded list identifies visible child statuses.
- Manager bulk stop with a child missing a usable environment: response reports a skipped child and still reports other child outcomes.
- Manager thread with more shown managed children than the cap: summary uses true count, expanded list shows capped rows and a truncation note.
- Manager thread after children complete, stop, reparent, or are deleted: banner refreshes and hides `Stop all` when no stoppable children remain.
- Managed thread: banner shows managed-by notice and links to manager.
- Any thread with pending TODOs: TODO section is collapsed by default and expands with keyboard and pointer.
- TODO snapshot with all completed items: TODO section is hidden.
- TODO snapshot where the latest valid candidate is empty: TODO section is hidden and older snapshots do not reappear.
- TODO candidates present but unparseable: TODO section is omitted and the server log/metric is observable.
- Non-`TodoWrite` tool-call events: route ignores them for TODO extraction and they do not consume the TODO candidate limit.
- Existing `GET /api/v1/threads/:id`: project auth matches the new prompt-context route.
- Managed child banner after manager title/archive/delete: child prompt-context refetches or all prompt-context queries are invalidated.
- Managed child reparenting: first pass uses ownership-related `events-appended` all-query invalidation.
- Workspace status loading/error/deleted states do not block sending a follow-up.
- Prompt-context query failure does not hide the managed-by fallback when `thread.parentThreadId` is known.
- Mobile viewport: banner rows wrap or truncate without overlapping the prompt box.

## AGENTS.md Review Notes

- Plan only: no UI or code implementation before sign-off.
- Contracts should live in shared packages, not inline function signatures.
- Provider TODO data must be parsed at a boundary and not leak `unknown` into app code.
- Use targeted server queries for managed children instead of loading all project threads and filtering in the app.
- Use SQL for candidate selection, then TypeScript for parsing and snapshot selection.
- Keep candidate scans and managed-child lists bounded with explicit count/limit fields for client-side truncation handling.
- Apply explicit prompt-context route authorization with both `requirePublicThread` and `requirePublicProject(thread.projectId)`.
- Replace/reuse the existing `asTodoWriteTodos` parsing path instead of duplicating it, and remove the old helper once the zod-backed parser is canonical.
- Reuse `StatusPill`, `CollapsibleHeader` or `ExpandablePanel`, `WorkspaceChangesList`, `MergeBaseBranchPicker`, `Button`, and existing layout conventions.
- Use sanctioned typography utilities; do not add arbitrary `text-[Npx]` classes.
- Use Turbo for typecheck and tests.
- Do not add route/query fields unless implemented end to end.
