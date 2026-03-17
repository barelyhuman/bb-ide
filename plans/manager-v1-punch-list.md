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

### 6. Prompt quality pass

Validate and improve the manager prompt against the hero workflows defined in `plans/manager-hero-workflows.md`. If the manager doesn't understand bb, the CLI, and the system model, none of the UI work matters.

The prompt currently only teaches simple delegation (W1). It needs to cover:

- **Pipeline workflows (W2):** Chaining threads (code → review → feedback), reusing environments, triage between threads, storing workflow preferences for automatic reuse.
- **Mid-flight takeover with goals (W3):** Taking over a user's thread, evaluating goal completion (not just idle status), kicking off follow-on workflows.
- **Status survey (W4):** Efficiently inspecting all managed threads and synthesizing an actionable summary.
- **Iterative follow-up (W5):** Knowing when to reuse an existing thread vs spawning a new one.
- **Parallel task management (W6):** Managing multiple independent tasks in flight, reporting on each as they complete.
- **Error triage (W7):** Diagnosing worker errors, deciding what to handle autonomously vs escalate to the user.
- **Plan decomposition and fan-out (W8):** Breaking a plan into parallelizable units, avoiding file conflicts across workers, sequencing dependent work.
- **Retrospective (W9):** Surveying past work, extracting learnings, proposing improvements.
- **Cross-manager coordination (W10):** Discovering and messaging other managers for context sharing.

**Also needed:**
- Expand runtime context to include project name, project id, project root, manager thread id, workspace path.
- Add handoff-language examples ("take over", "@thread...", pasted URLs).

### 7. ~~Environment reuse for pipeline workflows~~ RESOLVED

Resolved by `f25219a2` (Allow CLI attachment to existing environments). A manager can now spawn a thread into an existing environment with `bb thread spawn --environment <environment-id>`. Multiple threads can share the same environment via the `threadEnvironmentAttachments` table. W2 pipeline workflows are unblocked.

### 8. Thread lifecycle / archival guidance

Ensure the manager actively manages thread clutter.

- Prompt should teach when to archive (one-off research done, temporary execution done) vs keep (branch/worktree still relevant, ongoing work)
- Manager should proactively suggest archival after reviewing completed work
- QA scenario: after a coding task completes, does the manager archive the worker thread or explain why it's keeping it?

---

### 9. Extract workflows into a sub-template

The workflows section of the manager instructions is the longest section and is conceptually independent from the behavioral rules. Extract it into `bb-manager-workflows.md` as a standalone sub-template, following the same pattern as `bb-system-overview.md` and `bb-cli-guide.md`. This keeps the main instructions template focused on behavior and communication boundaries, and makes the workflows reusable in other contexts.

### 10. CLI command deduplication audit

Several `bb manager` commands duplicate `bb thread` commands:
- `bb manager threads <id>` = `bb thread list --parent-thread <id>`
- `bb manager status <id>` ≈ `bb thread show <id>` + `bb manager threads <id>`
- `bb manager send <id> <msg>` = `bb thread tell <id> <msg>`
- `bb manager log <id>` = `bb thread log <id>`

Options: remove duplicates, keep as shorthands, or consolidate. The CLI guide should teach one canonical way per operation. Track and decide which commands to keep vs remove.

### 11. Manager instructions heading consistency

The manager instructions template mixes `##` headings (for CLI Reference and System Overview sub-template sections) with bare text headings (for Delegation, Communication, Hatching, etc.). Pick one style and apply it consistently. The sub-template sections use `##` because they're injected as standalone documents; the behavioral sections should either all use `##` or all use bare headings.

---

## P1 — UI Polish

### 12. Surface language audit

Some confirmation modals and UI surfaces use "thread" language where "manager" would be more appropriate.

**Audit targets:**
- Delete confirmation modals (e.g., "Delete this thread?" → "Delete this manager?" for manager threads)
- Archive confirmation
- Thread info panel labels
- Any toast/notification copy that says "thread" generically

**Implementation:** Add type-aware copy that checks `thread.type` and uses "manager" vs "thread" accordingly. Low priority but important for product coherence.

### 13. Sidebar collapsed-manager status cues

When a manager is collapsed in the sidebar, surface enough status to be useful without expanding.

- Show a count of active managed child threads beside the manager name
- Show a spinner/activity indicator if any managed child is actively running a turn
- Keep it minimal — no heavy tree chrome

### 14. UI handoff actions

Add explicit handoff buttons to the thread info panel.

- For unmanaged threads: "Assign to Manager" action (with a picker if multiple managers exist)
- For manager-managed threads: "Take Over" action (removes `parentThreadId`, moves to regular thread list)
- These complement the chat-driven handoff path (asking the manager in conversation)

### 15. `@`-mention interaction polish

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

### 16. Dedicated manager routes (evaluation)

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

### 17. Manager QA scenarios

Create a dedicated manager QA doc with scenarios derived from `plans/manager-hero-workflows.md`.

**Tier 1 scenarios (must pass):**
- W1: Simple delegation — spawn worker, wait, review, report
- W2: Pipeline workflow — code → review → feedback loop with environment reuse
- W3: Mid-flight takeover — take over user thread, monitor for goal, kick off follow-on
- W4: Status survey — "what's going on?" across all managed threads
- W5: Iterative follow-up — send adjustments to existing worker
- W6: Multiple independent tasks — parallel spawning and independent reporting
- W7: Worker error — triage and decide to handle or escalate

**Tier 2 scenarios:**
- W8: Plan → parallel execution — decompose and fan out
- W9: Retrospective — survey past work and extract learnings
- W10: Cross-manager coordination — ask another manager for context
- W11: Memory across sessions — recall preferences and past work

**Anti-pattern checks:**
- Manager shouldn't poll workers
- Manager shouldn't micromanage active threads
- Manager shouldn't leave stale threads indefinitely
- Manager shouldn't dump raw status without synthesis

---

# Completed

1. ~~**CLI audit P0s**~~ — `--title`, `--model`, `--json` on list, `bb provider` commands.
2. ~~**Prompt quality pass**~~ — hero workflows W1–W10, runtime context, sub-templates.
3. ~~**Multi-manager support**~~ — dropped `primaryManagerThreadId`, hire always creates, multi-manager UI.

# Parallel PRs

The remaining work can be split into 6 independent PRs. PRs 1–5 have no hard dependencies on each other and can run in parallel. PR 6 (QA) should go last.

## PR1: Inter-agent messaging tool

**Punch list items:** #2 (inter-agent messaging tool)

**What to build:**
- Add a `message_agent` custom tool available to manager threads (and optionally managed worker threads)
- Parameters: `targetThreadId`, `message`
- Execution: deliver the message as a system event to the target thread (similar to `tell`)
- The target thread sees it as a `[bb system]` message with sender context
- If the target thread is idle, the message queues as a pending turn trigger
- Start with: workers can message their parent only, managers can message any manager
- Update the manager prompt to explain when to use `message_agent` vs waiting for completion signals
- See punch list item #2 for full design details

**Key files:**
- `apps/server/src/manager-tools.ts` — tool registration
- `apps/server/src/orchestrator.ts` — execution and event delivery
- `packages/core/src/types.ts` — new event type
- `packages/templates/src/templates/manager-agent-instructions.md` — prompt guidance

**Soft dependency:** PR3 (@-mentions) is richer with this, but doesn't block it.

## PR2: Manager defaults + Hire modal

**Punch list items:** #3 (manager default provider/model), #4 (hire modal improvements)

**What to build:**
- Default manager provider/model to `claude-code` + `claude-opus-4-6` in the hire route (`apps/server/src/routes/projects.ts`). Fall back to normal resolution if claude-code is unavailable.
- Update the hire modal (`apps/app/src/components/HireManagerModal.tsx`):
  - Add an optional text input for manager name (placeholder: "Manager")
  - Pre-select claude-code + opus-4-6 as defaults
  - Match the visual layout of the commit/squash-merge modals
- Wire the `title` field through the hire API (backend already accepts it after our changes)

**Key files:**
- `apps/server/src/routes/projects.ts` — default provider/model logic
- `apps/app/src/components/HireManagerModal.tsx` — modal UI
- `apps/app/src/hooks/useApi.ts` — mutation hook if title param needs wiring

**Fully independent.** No dependencies on other PRs.

## PR3: Manager @-mention support

**Punch list items:** #5 (manager @-mention support)

**What to build:**
- The `@`-mention suggestion source should include manager threads for the current project
- Manager suggestions should be visually distinct from file and regular thread suggestions (e.g., manager icon or type label)
- Mentioning a manager inserts a thread reference token (same format as thread mentions)
- In manager threads, @-mentioning another manager is a natural way to reference them

**Key files:**
- `apps/app/src/hooks/usePromptFileMentions.ts` (or similar) — suggestion source
- `apps/app/src/components/PromptMentionMenu.tsx` (or similar) — rendering
- Check how thread mentions currently work and extend the pattern to filter/include managers

**Soft dependency:** Richer with PR1 (inter-agent messaging) but works standalone.

## PR4: Template cleanup

**Punch list items:** #9 (extract workflows sub-template), #10 (CLI command dedup audit), #11 (heading consistency)

**What to build:**
- Extract the "Workflows" section (lines 106–163) of `manager-agent-instructions.md` into a new `bb-manager-workflows.md` sub-template. Follow the same pattern as `bb-system-overview.md` and `bb-cli-guide.md`:
  - New template file with frontmatter
  - New variable in `registry.ts`
  - Render in `manager-thread.ts` and pass as variable with empty-string guard
  - Replace inline content with `{{{bbManagerWorkflows}}}`
- Audit CLI command duplication between `bb manager` and `bb thread`:
  - `bb manager threads <id>` = `bb thread list --parent-thread <id>`
  - `bb manager status <id>` ≈ `bb thread show <id>` + threads list
  - `bb manager send <id> <msg>` = `bb thread tell <id> <msg>`
  - `bb manager log <id>` = `bb thread log <id>`
  - Decide: remove duplicates, keep as shorthands, or document the canonical way. Update CLI guide template accordingly.
- Fix heading consistency in `manager-agent-instructions.md`: the sub-template sections use `##` headings while behavioral sections use bare text headings. Pick one style.

**Key files:**
- `packages/templates/src/templates/manager-agent-instructions.md`
- `packages/templates/src/templates/bb-manager-workflows.md` (new)
- `packages/templates/src/templates/bb-cli-guide.md`
- `packages/templates/src/registry.ts`
- `apps/server/src/manager-thread.ts`
- `apps/cli/src/commands/manager.ts`

**Fully independent.** No backend or UI dependencies.

## PR5: UI polish

**Punch list items:** #12 (surface language audit), #13 (sidebar cues), #14 (handoff actions), #15 (@-mention interaction polish), #16 (dedicated manager routes evaluation)

**What to build:**
- **Surface language audit:** Add type-aware copy that uses "manager" vs "thread" in confirmation modals, archive dialogs, thread info panel labels, and toasts. Check `thread.type` and branch.
- **Sidebar collapsed-manager cues:** Show active managed thread count and a spinner when children are running. Keep minimal.
- **Handoff action buttons:** "Assign to Manager" (with picker if multiple managers) on unmanaged threads, "Take Over" on managed threads in the info tab.
- **@-mention interaction polish:** Fix file suggestion duplication, simplify thread suggestion rows, fix menu hint copy, reduce icon visual weight.
- **Dedicated manager routes:** Evaluate whether manager-specific endpoints should move from `/threads/:id/manager-workspace/*` to `/managers/*`. Decide during implementation.

**Key files:**
- `apps/app/src/components/layout/ProjectList.tsx` — sidebar
- `apps/app/src/views/ThreadDetailView.tsx` — info panel, handoff actions
- `apps/app/src/components/PromptMentionMenu.tsx` — mention UX
- Various modal/dialog components for language audit
- `apps/server/src/routes/threads.ts` — route evaluation

**Fully independent.** Can be split further into sub-PRs if needed.

## PR6: QA scenarios

**Punch list items:** #17 (manager QA scenarios)

**What to build:**
- Create a dedicated manager QA doc under `qa/` covering all hero workflows (W1–W11)
- Include tier 1 scenarios (simple delegation, pipeline, takeover, status survey, follow-up, parallel tasks, error handling)
- Include tier 2 scenarios (plan decomposition, retrospective, cross-manager, memory)
- Include anti-pattern checks
- Run the scenarios against the current implementation and document results

**Depends on:** PRs 1–5 being stable. Run this last.

# Related Plans

- `plans/cli-audit.md` — CLI flag gaps and task list
- `plans/manager-hero-workflows.md` — definitive workflow definitions driving prompt and CLI work

# Open Questions/Risks

- ~~**Environment reuse:**~~ RESOLVED by `f25219a2`. `bb thread spawn --environment <env-id>` attaches to existing environments.
- **Notification → turn trigger:** When a managed thread completes, does the system message actually start a new manager turn? If not, W7 (error handling) is reactive only. Needs verification.
- **Workflow preferences:** Should pipeline workflows be stored as structured config or natural language in `PREFERENCES.md`?
- **Multi-manager:** Should the sidebar have a single "Managers" section or show each manager as a top-level entry?
- **Inter-agent messaging:** Should workers message arbitrary threads or only their parent?
- **Manager defaults:** If `claude-code` provider isn't configured, should we warn or silently fall back?
- **Route separation:** Defer decision until multi-manager work reveals whether the thread-route approach is becoming awkward.
