# Goal

Implement a v1 manager agent feature that lets a user hire one primary manager per project, delegate work to it through a dedicated manager thread, let the manager spawn and coordinate child threads, and support handing threads back and forth between the user and the manager.

The plan should fit the current `main` branch architecture:

- projects and threads remain the core product model
- child-thread linkage already exists via `parentThreadId`
- `local`, `worktree`, and newer environment-agent-backed environments already exist and should remain compatible
- the sidebar and thread detail secondary panel are the main UI seams for manager-owned work and manager deliverables

# Scope

In scope:

- Project-level primary manager metadata
- Thread-level manager/standard type metadata
- Manager creation and bootstrap flow
- Manager-owned thread hierarchy in the sidebar
- Thread handoff between user-owned and manager-owned states
- Manager-specific instructions and reply surface
- Manager workspace under `~/.beanbag/`
- File-backed manager deliverables surfaced through chat and the secondary panel

Out of scope:

- Multiple peer managers per project
- Sub-managers in v1
- Rich deliverable cards beyond file links and secondary-panel rediscovery
- A separate check-in surface beyond the manager thread and normal unread state
- Detailed v1 rules for direct worker steering beyond opening/taking over threads

# Implementation Steps

1. Add the product metadata for a primary manager and thread types.

- Extend `Project` persistence/types with a `primaryManagerThreadId` field.
- Extend `Thread` persistence/types with an explicit closed internal type:
  - `standard`
  - `manager`
- Keep `parentThreadId` as the manager-ownership and notification edge in v1.
- Treat ownership and hierarchy as:
  - manager thread: `type="manager"`, `parentThreadId=null`
  - unmanaged user thread: `type="standard"`, `parentThreadId=null`
  - manager-managed thread: `type="standard"`, `parentThreadId=<manager>`
- Enforce that only `manager` threads may be referenced by `parentThreadId` in v1.
- Keep the current `primaryCheckoutThreadId` concept separate from manager ownership.

2. Add manager creation at the project layer.

- Add a daemon/API path to hire or open the primary manager for a project.
- Behavior:
  - if no primary manager exists, create one
  - if one already exists, return/open it
- Creation should:
  - create a thread with `type="manager"`
  - default to `environmentId=local`
  - inject manager-specific `developerInstructions`
  - initialize the manager workspace under `~/.beanbag/managers/<threadId>/`
- Follow the same success/failure contract as thread creation:
  - success => usable manager thread
  - failure => no special half-configured manager state

3. Add manager bootstrap and workspace initialization.

- On first manager creation, seed the manager workspace with initial files such as:
  - `INSTRUCTIONS.md`
- Start the manager thread with instructions that cause it to run its lightweight hatching/onboarding conversation in chat.
- Keep onboarding interactive rather than wizard-driven.
- Ensure the manager workspace path is outside the project repo and gitignored by construction.
- Use `~/.beanbag/workspace/<threadId>/` as the v1 manager workspace root.

4. Add a manager-specific user reply path.

- Introduce a manager-only reply tool or equivalent manager-only response surface.
- Implement this as a custom tool call in v1.
- Keep manager communication user-facing and hide raw orchestration/tool chatter by default.
- Preserve the existing thread timeline model for storage and rendering rather than inventing a separate conversation subsystem.
- The manager’s instructions should make it delegation-first and user-facing, matching the MVP doc’s draft `Manager INSTRUCTIONS.md`.

5. Add type-aware spawning and handoff behavior.

- Add a first-class way for the manager to spawn managed child threads:
  - `type="standard"`
  - `parentThreadId=<manager>`
  - default `environmentId=worktree`
  - manager-specific or worker-specific instructions as needed
- Add bidirectional handoff:
  - unmanaged user thread -> manager-managed standard thread
  - manager-managed standard thread -> unmanaged user thread
- Handoff should update:
  - `parentThreadId`
  - any derived ownership metadata needed for routing
- Emit a visible system event in the thread timeline when ownership changes.
- After handoff, send the affected manager a system message describing the ownership change.
- For user -> manager handoff, the message should look like:
  - `[bb system]: User assigned you the following thread to manage:`
  - `<threadId>: <thread title>`
- The manager decides what to do next; v1 does not require an automatic summary/adoption step.

6. Define the minimal ownership semantics in code and UI.

- Manager-managed thread:
  - appears nested under the manager
  - is part of the manager’s managed workload
  - completion notifications go to the manager
- Unmanaged standard thread:
  - appears as a regular project thread
  - is no longer part of the manager’s managed workload
  - no manager completion notifications
- When a thread is handed to the manager, the manager should be able to inspect it using existing `bb` tooling rather than needing a bespoke transcript-transfer system in v1.

7. Update the sidebar to show manager hierarchies without losing regular threads.

- Replace the current “hide all child threads” behavior with a type-aware/thread-tree view.
- Keep regular threads visible in their normal project section.
- Show:
  - the primary manager as a top-level row
  - manager-managed standard threads indented under it
  - unmanaged standard threads separately in the same project area
- Keep managed child rows lightweight in v1:
  - title
  - active state
  - unread state if relevant
- Reuse the existing collapsible project/thread list patterns rather than introducing a new sidebar system.

8. Make the thread detail UI role-aware.

- In the main thread view, show clear metadata for:
  - manager thread
  - manager-managed standard thread
  - unmanaged standard thread
- For manager-managed threads, show a parent-manager link in the thread metadata/info panel.
- Add a clear banner or status treatment so the user can tell when they are talking to:
  - a manager
  - a manager-managed standard thread
  - an unmanaged standard thread
- Use:
  - `user-round` icon for manager threads
  - indented, slightly muted rows for manager-managed standard threads
  - current regular styling for unmanaged standard threads
- Keep the main timeline unchanged; use the secondary panel/info tab for additional manager metadata and linked deliverables.

9. Support file-backed manager deliverables.

- Use the manager workspace as the default location for plans, reports, and similar markdown outputs.
- In v1, the manager presents longer-form outputs by sending a normal chat message that links to the file.
- Add a readonly manager-workspace tab in the secondary panel for rediscovering manager files and deliverables.
- Do not build a custom deliverable object model yet; use the current message + file link path.

10. Add project and thread actions for handoff.

- Add a `Hire Manager` action at the project level.
- In v1, place this as a `user-round-plus` action beside the archive and settings icons in the project main view.
- Add thread-level actions for:
  - hand off to manager
  - take over from manager
- Expose:
  - `take over` on manager-managed threads
  - `assign to manager` for unmanaged threads via the info tab
- Keep chat-driven handoff possible too:
  - when chatting with the manager, the user can `@`-mention unarchived threads
  - the manager can use `bb` tooling to update `parentThreadId`

11. Keep environment behavior aligned with the current architecture.

- Manager threads should default to `local`.
- Manager-owned workers should default to `worktree`.
- Do not special-case or regress the newer environment-agent-backed environments.
- Keep manager feature work focused on project/thread/product layers unless a concrete environment issue appears during implementation.

12. Add end-to-end coverage before rollout.

- Persistence/tests:
  - project primary manager metadata
  - thread type metadata
  - type constraints + `parentThreadId` handoff updates
- Daemon/tests:
  - hire manager create/open behavior
  - manager creation failure rollback
  - manager-managed thread spawn
  - handoff in both directions
  - parent-manager completion notification behavior
- App/tests:
  - project main view `Hire Manager` action
  - sidebar hierarchy rendering
  - unmanaged threads vs manager-managed threads in the same project
  - thread-level manager ownership metadata
  - banner/state when viewing manager vs managed vs unmanaged thread
  - readonly manager-workspace secondary-panel tab
  - info-tab `assign to manager` and managed-thread `take over` actions

# Validation

- `Project` types, schema, and routes support a primary manager reference cleanly.
- `Thread` types, schema, and routes support explicit `standard|manager` types cleanly.
- Hiring a manager either succeeds fully or fails without leaving special partial manager state.
- Existing non-manager thread flows still work.
- Manager thread defaults to `local`.
- Manager-managed standard thread defaults to `worktree`.
- Sidebar shows:
  - primary manager
  - nested manager-managed threads
  - unmanaged regular threads still visible
- Ownership handoff changes both data and UI consistently.
- Manager deliverables can be opened from the manager conversation and rediscovered from the secondary panel.
- Manager workspace files are readonly in the secondary panel in v1.

# Open Questions/Risks

- V1 intentionally uses unread manager replies as the only check-in/status surface beyond opening the manager thread directly. This is acceptable for v1, but may need revisiting if real usage shows users want more ambient visibility.
- V1 intentionally uses chat-only manager customization plus readonly secondary-panel inspection. This is acceptable for v1, but may need revisiting if users want more explicit settings controls.
- V1 intentionally keeps the manager workspace lightweight: seeded `INSTRUCTIONS.md` plus manager-created files. This is acceptable for v1, but may need revisiting if stronger workspace structure becomes necessary.
