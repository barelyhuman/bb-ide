# Deterministic Daemon Execution Issue Register

## Goal
Deliver a single deterministic commit/squash workflow owned by the daemon, with clear operation state and no manual memory steps (especially around demotion, merge tracking, and archiving). Treat workspace-status trust as a separate observability problem with explicit confidence bounds.

## Scope
- Commit and squash-merge execution for thread workspaces.
- Promote/demote coordination with commit/squash.
- Thread timeline/system-event UX for operation progress and outcomes.
- Archive behavior and warning copy tied to real risk states.
- Workspace-status observability/semantics as a separate workstream.

Issue register (single source of truth):

| ID | Issue | Root Cause | End-State Fix | Exit Criteria |
| --- | --- | --- | --- | --- |
| I-01 | Agent-driven commit/squash is slow | Git mutation waits on model turn | Daemon executes happy-path git operations directly | Median commit/squash latency bounded by local git operations only |
| I-02 | Behavior is unpredictable | Operation success inferred from prompt dispatch | Typed daemon operation state machine with terminal outcomes | UI only reports success on `completed`/`merged`, never on `dispatched` |
| I-03 | Thread log clutter | Prompt + dispatch chatter rendered in thread timeline | Collapse to canonical operation lifecycle events | One operation card per request with phase updates |
| I-04 | Concurrent thread operations conflict | Mutex covers promote/demote only | Single per-project git-mutation lock for promote/demote/commit/squash | Parallel operations are queued or rejected deterministically |
| I-05 | Workspace/metadata trust issues | Mixed cached/inferred state and weak provenance | Operation results persist merge provenance + forced status refresh | Thread metadata can always answer "merged to main?" with commit SHA + timestamp |
| I-06 | Auto-archive after squash regressed | Setting exists but not wired to operation completion | Archive policy evaluated on successful daemon squash completion | Successful squash into target branch auto-archives when enabled |
| I-07 | Manual archive warning is scary/inaccurate | Warning text does not distinguish safe vs destructive archive | State-specific warning copy driven by merge + dirtiness facts | Clean merged threads show non-destructive copy; risky states show explicit data-loss warning |
| I-08 | Easy to forget demote | Demotion depends on client path/flags | Server-enforced auto-demote before follow-up and before operations when needed | No user-visible flow requires remembering demote |
| I-09 | Workspace Status can differ from "main + this branch" reality | Status is observational and can diverge due to external git actions/processes outside Beanbag control | Separate status-trust workstream: canonical compare tuple + freshness/confidence metadata + reconciliation checks | UI shows compare tuple + freshness; users can distinguish "current observation" vs "guaranteed by daemon operation result" |
| I-10 | Popover blocks while operation runs | Popover is treated like operation surface | Popover closes immediately; timeline card becomes operation surface | User sees live operation state in thread details, not modal waiting UI |

Workstream separation:

- Workstream A (deterministic mutation pipeline): `I-01..I-08`, `I-10`
- Workstream B (status trust/reconciliation): `I-09`

Rule:

- Workstream A must not be blocked by perfect status guarantees from Workstream B.
- Workstream B must expose explicit confidence/freshness so status is never presented as stronger truth than it is.

## Implementation Steps
1. Define operation domain model
   - Add daemon-owned operation record: `id`, `threadId`, `projectId`, `type`, `status`, `phase`, `startedAt`, `endedAt`, `result`.
   - Terminal statuses: `completed`, `conflicted`, `failed`, `noop`.
2. Introduce deterministic operation executor in daemon
   - Execute git steps locally for `commit` and `squash_merge`.
   - Keep optional agent fallback only for explicit "help resolve conflict" actions, not default execution.
3. Unify project git-mutation lock
   - Reuse one lock path for promote/demote/commit/squash.
   - Reject or queue conflicting operations with explicit reason.
4. Persist operation provenance for merge tracking
   - Persist merge/commit provenance fields on thread and operation records.
   - Ensure merge truth comes from deterministic operation completion, not status inference.
5. Enforce demotion guardrails server-side
   - Auto-demote on follow-up/operation when thread is active in primary checkout.
   - Remove dependency on client flags for correctness.
6. Replace intent chatter with operation lifecycle events
   - Emit canonical events: `requested`, `validating`, `executing`, `verifying`, terminal status.
   - Stop rendering prompt text/log-heavy intent rows in normal timeline.
7. Update UI flow
   - Commit/squash popover submits and closes immediately.
   - Thread detail timeline shows live operation card with phase and final result.
8. Restore and enforce archive policy
   - Run auto-archive only after deterministic successful completion conditions.
   - Use state-specific archive confirmation copy.
9. Decommission legacy behavior
   - Remove success inference from dispatch state.
   - Remove stale/dead preference wiring paths or reconnect them to operation completion.
10. Parallel Workstream B: status trust/reconciliation
   - Extend work-status payload with compare tuple (`baseRef`, `baseSha`, `mergeBaseSha`, `headSha`, `computedAt`).
   - Add freshness/confidence fields (for example `freshnessMs`, `sourceEpoch`, `confidence`).
   - Add explicit UI copy separating observed status from daemon-confirmed operation results.
   - Add reconciliation probe endpoint/command to compare daemon status vs direct git for diagnosis.

## Validation
- Unit tests (daemon):
  - Operation executor state transitions and terminal status outputs.
  - Per-project lock across promote/demote/commit/squash.
  - Server-side auto-demote behavior for follow-up and operations.
- Unit tests (status workstream):
  - Compare tuple correctness and freshness metadata updates.
  - Confidence downgrade behavior when external divergence is detected/suspected.
- Integration tests:
  - "Squash merged to main" persists provenance (`mergedAt`, `mergedSha`, `operationId`) and survives restart.
  - Reconciliation checks report drift between daemon status and direct git commands with clear diagnostics.
  - Auto-archive applies only when completion policy conditions are met.
- UI tests:
  - Popover closes immediately after submit.
  - Timeline shows operation progress and terminal state.
  - Archive confirmation copy changes based on safe/risky thread state.

## Open Questions/Risks
- Should conflicting operations queue by default or fail fast with retry UX?
- How strict should commit message policy be for mainline history (template vs lint-enforced)?
- Should operation events live in existing thread event stream or a dedicated operation stream with thread projection?
- How do we handle very large repos where full post-op status refresh may be expensive (sampling vs full scan)?
