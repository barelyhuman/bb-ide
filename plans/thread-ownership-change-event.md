# Goal

Add a `system/ownership/updated` event to a thread's timeline when its parent
manager changes. Today the ownership change is only visible as a `[bb system]`
message in the manager threads — the child thread's own timeline has no record
of the reassignment.

This gives users a historical view of who managed a thread and when, similar to
how `system/primary_checkout/updated` records promote/demote changes.

# Scope

In scope:

- New event type `system/ownership/updated` on the child thread's timeline
- Event data includes previous and next parent thread IDs (either may be
  undefined for initial assignment or unassignment)
- Emit the event from the orchestrator's existing `_notifyManagersOfOwnershipChange`
  code path
- Render the event in the UI timeline (similar to the primary checkout pill)
- Render the event in `to-ui-messages.ts` for the conversation timeline projection

Out of scope:

- Changing the `[bb system]` messages sent to managers (those stay as-is)
- Retroactively backfilling events for existing threads
- Ownership history API endpoint (the timeline events are sufficient)

# Implementation Steps

1. Add the event type and data shape.

- Add `"system/ownership/updated"` to the `ThreadEventType` union in
  `packages/core/src/types.ts`
- Define `SystemOwnershipUpdatedEventData` with fields:
  - `previousParentThreadId?: string`
  - `nextParentThreadId?: string`
  - `previousParentThreadTitle?: string`
  - `nextParentThreadTitle?: string`
- Add the type mapping to `ThreadEventDataMap`

2. Emit the event in the orchestrator.

- In `_notifyManagersOfOwnershipChange` (orchestrator.ts ~line 1535), after
  sending the `[bb system]` tells, append a `system/ownership/updated` event
  to the **child** thread's timeline via `_appendEvent`
- The event should be emitted once per ownership change, not once per manager
  notification

3. Render in `to-ui-messages.ts`.

- Add a handler for `system/ownership/updated` in the system event rendering
  section
- Produce a timeline message like:
  - "Thread management transferred from {prev} to {next}"
  - "Thread assigned to manager {next}" (when no previous)
  - "Thread removed from manager {prev}" (when no next)

4. Render in the frontend timeline.

- Add rendering for the new event type in the conversation timeline component
- Use a similar style to the primary checkout updated pill — a subtle system
  info row, not a full message bubble

5. Update tests.

- Add unit test for the new event emission in orchestrator tests
- Add unit test for the `to-ui-messages` rendering
- Verify existing ownership-change tests still pass (the `[bb system]` tells
  should be unaffected)

# Validation

- Reassigning a worker thread's parent manager produces a
  `system/ownership/updated` event on the child thread's timeline
- The event renders correctly in the UI timeline
- The `[bb system]` manager notifications continue to work as before
- Typecheck passes
- Existing manager and ownership tests pass

# Open Questions/Risks

- Should we include the manager thread titles in the event data for display,
  or resolve them at render time? Including them avoids a lookup but means
  stale titles if the manager is later renamed. Leaning toward including them
  since system events are historical snapshots.
- Should initial manager assignment (at spawn time) also emit this event, or
  only reassignments? Leaning toward emitting for all cases so the timeline
  always shows who first managed the thread.
