# Goal

Consolidate remaining manager-agent work into a single actionable punch list for shipping a credible V1.

The core manager feature is implemented: data model, lifecycle, `message_user` tool, CLI commands, sidebar hierarchy, hire modal, manager prompt, and ownership handoff. This plan covers what's left to make V1 feel complete and coherent.

# Scope

In scope:

- Multi-manager support (remove single-manager assumption)
- Inter-agent / inter-manager communication primitives
- Manager default provider/model configuration
- Hire manager modal improvements
- Manager `@`-mention support
- Prompt and behavioral quality
- Thread lifecycle management (archival, clutter)
- UI surface language audit (thread vs manager copy)
- `@`-mention interaction polish
- Sidebar polish (collapsed-manager cues)
- UI handoff actions
- QA scenarios

Out of scope:

- Sub-managers (managers managing other managers hierarchically)
- Rich deliverable cards beyond file links
- Replacing the `bb` CLI with a separate manager control plane
- Full autonomous planning/memory systems

---

# Work Items

## P0 — Core V1 Gaps

### 1. Multi-manager support

Remove the `primaryManagerThreadId` single-manager assumption and allow multiple managers per project.

**Data model changes:**
- Drop `projects.primaryManagerThreadId` column
- Manager threads are already typed (`threads.type = "manager"`) and linked to a project via `threads.projectId` — this is sufficient for discovery
- Query managers per project by filtering threads where `type = "manager"` and `projectId = X` and not archived
- The hire route should always create a new manager (no "reopen existing" logic)

**API changes:**
- `POST /projects/:id/manager` → creates a new manager, returns it
- Add `GET /projects/:id/managers` → list active managers for a project
- Remove the "if existing manager, return it" guard from the hire route
- Keep stale/archived manager cleanup logic

**CLI changes:**
- `bb manager hire` → creates a new manager (prompt for name)
- `bb manager list [projectId]` → list managers for a project
- Existing `bb manager show/status/send/log/delete/threads` should work with manager IDs as-is

**UI changes:**
- Sidebar: show all managers for a project, each with their managed thread hierarchy underneath
- "Hire Manager" always creates a new one
- Remove any "reopen existing manager" UX paths

**App layout changes:**
- The `AppLayout` hire-manager button currently checks for an existing manager and either opens it or shows the modal — update to always show the modal (creating a new manager) while still listing existing managers in the sidebar

### 2. Inter-agent messaging tool

Add a first-class tool for threads and managers to message each other, beyond shelling out to `bb` CLI.

**Use cases:**
- Manager asks another manager about user preferences
- Worker thread escalates a question to its parent manager
- Manager sends follow-up instructions to a worker
- Cross-project manager coordination

**Design:**
- Add a `message_agent` custom tool available to manager threads (and optionally to managed worker threads)
- Parameters: `targetThreadId`, `message`
- Execution: delivers the message as a system event to the target thread, similar to `tell`
- The target thread sees it as a `[bb system]` message with sender context

**Subscription / notification model:**
- For parent-child (manager-worker), the existing `parentThreadId` completion notification works
- For peer messaging (manager-to-manager, worker-to-manager-of-another-project), the tool delivers a one-shot message — no persistent subscription needed in V1
- If the target thread is idle, the message queues as a pending turn trigger
- Prompt guidance should teach managers when to use `message_agent` vs waiting for completion signals

**Open question:** Should worker threads be able to message arbitrary threads, or only their parent manager? Start with parent-only for workers, any-manager for managers.

### 3. Manager default provider/model

Managers should default to a specific provider/model rather than inheriting the project default (which is optimized for worker threads).

**Current behavior:** Manager hire uses the project's `defaultProviderId` resolution chain (explicit → project default → system default). The system default picks the first available provider.

**Desired behavior:** Managers should default to `claude-code` provider with `claude-opus-4-6` model unless the user explicitly picks something else.

**Implementation:**
- In the hire route (`projects.ts`), if no explicit `providerId`/`model` is provided, default to `claude-code` + `claude-opus-4-6` (or the best available model from that provider)
- Fall back to the normal resolution chain if `claude-code` is not available
- The hire modal should pre-select this default rather than the first provider in the list

### 4. Hire manager modal improvements

Align with the commit/squash-merge modal pattern.

**Current state:** The modal has a provider/model picker and a hire button. No name input.

**Changes:**
- Add an optional text input for manager name (placeholder: "Manager", label: "Name")
- If provided, use it as the thread title instead of the hardcoded "Manager"
- Pre-select `claude-code` + `claude-opus-4-6` as the default provider/model
- Match the visual layout of the commit/squash-merge modals (input field above provider picker, consistent spacing and button treatment)

### 5. Manager `@`-mention support

Users should be able to `@`-mention managers in thread prompts (especially useful in manager-to-manager and thread-to-manager contexts).

**Implementation:**
- The `@`-mention suggestion source should include manager threads for the current project
- Manager suggestions should be visually distinct from file and regular thread suggestions (e.g., manager icon)
- Mentioning a manager should insert a thread reference token (same format as thread mentions)
- In manager threads, `@`-mentioning another manager should be a natural way to initiate the `message_agent` flow

---

## P1 — Behavioral Quality

### 6. Prompt quality pass

Validate and improve the manager prompt against the hero workflows.

**Hero workflows to validate:**
- **Hatching:** Does the meet-and-greet feel natural? Does the manager learn what to call the user and how they like to work?
- **Delegation:** Does the manager spawn threads correctly, give clear assignments, and avoid polling?
- **Ownership transfer:** Does the manager understand "take over this thread" / "give this back" as Beanbag ownership concepts?
- **Completion review:** When a worker finishes, does the manager review, update the user, and decide on archival?
- **Thread lifecycle:** Does the manager archive stale threads and keep important ones?
- **Memory:** Does the manager create `PREFERENCES.md` only when it has useful durable info?

**Prompt improvements (if needed after validation):**
- Strengthen Beanbag mental model section with concrete examples
- Add anti-patterns (don't poll, don't micromanage, don't leave stale threads)
- Add handoff-language examples ("take over", "@thread...", pasted URLs)
- Expand runtime context to include project name, project id, project root, manager thread id, workspace path

### 7. Thread lifecycle / archival guidance

Ensure the manager actively manages thread clutter.

- Prompt should teach when to archive (one-off research done, temporary execution done) vs keep (branch/worktree still relevant, ongoing work)
- Manager should proactively suggest archival after reviewing completed work
- QA scenario: after a coding task completes, does the manager archive the worker thread or explain why it's keeping it?

---

## P2 — UI Polish

### 8. Surface language audit

Some confirmation modals and UI surfaces use "thread" language where "manager" would be more appropriate.

**Audit targets:**
- Delete confirmation modals (e.g., "Delete this thread?" → "Delete this manager?" for manager threads)
- Archive confirmation
- Thread info panel labels
- Any toast/notification copy that says "thread" generically

**Implementation:** Add type-aware copy that checks `thread.type` and uses "manager" vs "thread" accordingly. Low priority but important for product coherence.

### 9. Sidebar collapsed-manager status cues

When a manager is collapsed in the sidebar, surface enough status to be useful without expanding.

- Show a count of active managed child threads beside the manager name
- Show a spinner/activity indicator if any managed child is actively running a turn
- Keep it minimal — no heavy tree chrome

### 10. UI handoff actions

Add explicit handoff buttons to the thread info panel.

- For unmanaged threads: "Assign to Manager" action (with a picker if multiple managers exist)
- For manager-managed threads: "Take Over" action (removes `parentThreadId`, moves to regular thread list)
- These complement the chat-driven handoff path (asking the manager in conversation)

### 11. `@`-mention interaction polish

Clean up the prompt mention interaction for both file and thread mentions.

**File mention improvements:**
- Fix suggestion duplication (avoid rendering same path as both title and subtitle)
- Single-line suggestions when there's no useful secondary context
- Primary label = basename or relative path, secondary = parent directory only when helpful

**Thread/manager mention improvements:**
- Reduce thread suggestions to minimum context needed to disambiguate (title, type indicator)
- Don't show full thread IDs in visible subtitle by default
- Manager suggestions should be visually distinct (icon or type label)

**Menu copy:**
- Query hint should reflect actual search surface (files only vs files + threads)
- Loading/empty states should match the active mention context
- Manager thread prompt should have especially clean thread-mention UX since it's the highest-value surface

**Icon treatment:**
- Audit whether suggestion row icons are needed
- If kept, reduce visual weight — keep them secondary to text
- If rows read better without, prefer removing

### 12. Dedicated manager routes (evaluation)

Currently manager-specific operations (workspace files, workspace file content, preferences) live under the threads route (`/threads/:id/manager-workspace/*`). Evaluate whether managers should have their own top-level route namespace.

**Arguments for separate routes:**
- Cleaner API surface — manager-specific operations don't need thread-route guards
- Easier to add manager-specific endpoints without cluttering threads
- Aligns with multi-manager support (managers are a distinct concept)

**Arguments against:**
- Managers are threads under the hood — sharing the route keeps this simple
- More routes to maintain

**Decision:** Evaluate during multi-manager work. If manager-specific endpoints grow beyond workspace access, extract to `/managers/*` routes.

---

## P3 — Validation

### 13. Manager QA scenarios

Create a dedicated manager QA doc covering hero workflows.

**Scenarios to cover:**
- Fresh hire + hatching quality
- Delegate a coding task → worker spawns, completes, manager reviews and updates user
- Hand off an existing thread to the manager
- Take a thread back from the manager
- Manager archives a completed worker thread
- Manager remembers user preferences across sessions
- Manager-to-manager preference sharing (once inter-agent messaging lands)
- `@`-mention a manager in a thread prompt
- Multiple managers in one project operating independently

**Include:**
- Handoff-language scenarios ("take over this thread", pasted URLs, `@thread:...`)
- Anti-pattern checks (manager shouldn't poll, shouldn't micromanage, shouldn't leave stale threads)

---

# Recommended Build Order

1. **Multi-manager support** — unblocks the rest; data model change is foundational
2. **Manager default provider/model** + **Hire modal improvements** — can ship together, quick wins
3. **Inter-agent messaging tool** — core V1 primitive, enables manager-to-manager workflows
4. **Manager `@`-mention support** — natural companion to inter-agent messaging
5. **Prompt quality pass** — validate against hero workflows with the above infrastructure in place
6. **UI polish** (surface language audit, sidebar cues, handoff actions, mention interaction) — parallel work
7. **QA scenarios** — write alongside implementation, run as final validation

# Open Questions/Risks

- Multi-manager: should the sidebar have a single "Managers" section or show each manager as a top-level entry? Top-level is simpler and more visible.
- Inter-agent messaging: should workers message arbitrary threads or only their parent? Starting with parent-only for workers is safer.
- Manager defaults: if `claude-code` provider isn't configured, should we show a warning or silently fall back?
- Mention polish: should manager-thread mention search bias managers ahead of regular threads, or keep mixed ordering?
- Route separation: defer decision until multi-manager work reveals whether the current thread-route approach is becoming awkward.
