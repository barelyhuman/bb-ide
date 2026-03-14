# Goal

Define the manager's hero workflows before doing more prompt, CLI, or UI refinement work, so the next iteration is driven by concrete end-to-end jobs rather than isolated polish ideas.

This plan should answer:

- what a manager is primarily for in Beanbag
- which workflows matter enough to optimize explicitly
- what the manager must understand about Beanbag to handle those workflows correctly
- which prompt, CLI, tool, and UI improvements fall out of those workflows

# Scope

In scope:

- Identifying the core hero workflows for a project manager in Beanbag
- Breaking each workflow into:
  - user intent
  - manager mental model requirements
  - prompt requirements
  - CLI/tooling requirements
  - UI requirements
  - QA scenarios
- Prioritizing workflows that should drive the next refinement pass
- Using those workflows to derive concrete follow-on changes for:
  - manager prompt redesign
  - Beanbag mental-model guidance
  - CLI audit
  - agent-to-agent communication
  - memory/workspace behavior
  - thread archival behavior

Out of scope:

- Re-implementing the manager feature itself
- Final wording for the full prompt rewrite
- Detailed command-by-command CLI spec changes
- General non-manager thread UX cleanup unless a hero workflow requires it

# Implementation Steps

1. Establish the manager's core product role.

- Treat the manager as a long-running project employee, not just a thread spawner.
- The manager's primary jobs are:
  - understand the user and how they like to work
  - coordinate meaningful work across threads
  - keep the user informed and unblocked
  - maintain enough durable memory to improve over time
  - keep the project's thread/workspace state organized
- Use this role definition as the filter for what counts as a hero workflow.

2. Define the initial hero workflows.

- Workflow A: Meet-and-greet / hatching
  - User hires a manager for the first time.
  - The manager introduces itself, learns what to call the user, learns preferred collaboration style, learns likely task types, and starts durable preference capture.
  - This workflow should feel like meeting a new employee, not filling out a form.

- Workflow B: Delegate a new coding task
  - User asks the manager to make a change, investigate a bug, or implement a feature.
  - The manager decides whether the task is substantive enough to delegate, spawns the right worker, gives the worker a clear assignment, then waits instead of polling.
  - When the worker finishes, the manager reviews the result and updates the user.

- Workflow C: Take over an existing thread
  - User says things like:
    - "Take over this thread"
    - "Can you manage this for me?"
    - "Take over @thread..."
    - pastes a thread URL
  - The manager should understand this as an ownership-transfer request in Beanbag, identify the target thread, assign it to itself, and decide what to do next.

- Workflow D: Give a thread back to the user
  - User says:
    - "I'm taking this back"
    - "Unassign this"
    - "Give me this thread back"
  - The manager should understand this as relinquishing ownership, update state appropriately, and stop treating the thread as managed work.

- Workflow E: Review and summarize completed managed work
  - A managed thread finishes or times out.
  - The manager decides whether to:
    - report completion
    - request follow-up work
    - archive the thread
    - keep it around because the worktree/branch is still relevant
  - This workflow is core to making the manager feel responsible rather than passive.

- Workflow F: Manage thread clutter
  - The manager decides whether a worker thread should remain visible and active, or be archived because its purpose has been fulfilled.
  - This is especially important for short-lived research, verification, or implementation threads.

- Workflow G: Reuse memory and workspace context
  - Over time, the manager should remember stable collaboration preferences and write useful artifacts to its workspace.
  - It should know what belongs in `PREFERENCES.md`, what belongs in other notes, and what should not be stored durably.

- Workflow H: Coordinate with another agent or manager
  - The manager needs to ask another agent or another project's manager for information or coordination.
  - This is rare but strategically important because it drives the need for first-class agent-to-agent communication and a more manager-aware CLI.

3. For each workflow, document the required Beanbag mental model.

- The manager must understand, at minimum:
  - project
  - project root
  - manager thread
  - standard thread
  - managed thread
  - `parentThreadId` as management/ownership
  - local vs worktree environments
  - archived vs active threads
  - manager workspace
  - `PREFERENCES.md`
  - project-level primary manager
- The prompt should teach these concepts using the hero workflows above, not as an abstract glossary.

4. Use the hero workflows to drive prompt requirements.

- Hatching must be optimized around Workflow A.
- Delegation guidance must be optimized around Workflows B and E.
- Ownership-transfer language and examples must be optimized around Workflows C and D.
- Archival guidance must be optimized around Workflows E and F.
- Memory/workspace guidance must be optimized around Workflow G.
- Agent-to-agent coordination guidance must be optimized around Workflow H.
- The prompt should include:
  - best-practice patterns
  - anti-patterns
  - concrete Beanbag-native examples
  - runtime context sufficient to orient the manager immediately

5. Use the hero workflows to drive CLI and tool requirements.

- Workflow B requires strong support for:
  - spawning threads
  - checking status/log/output
  - sending follow-up instructions
  - waiting without repeated polling
- Workflows C and D require strong support for:
  - identifying target threads from links or mentions
  - assigning and unassigning ownership
- Workflow E requires strong support for:
  - quickly seeing what changed
  - seeing whether a worker succeeded, failed, or timed out
- Workflow H requires:
  - manager-friendly cross-project discovery
  - manager-to-manager or agent-to-agent messaging
- Audit the existing CLI against these exact needs rather than against generic completeness.

6. Use the hero workflows to drive UI requirements.

- Workflow A should influence how the manager thread is presented as a distinct conversation surface.
- Workflows C and D should influence thread reference and ownership UI.
- Workflows E and F should influence collapsed-manager status and thread-count display.
- Workflow G should influence manager workspace and memory visibility.
- UI changes should be justified by a workflow, not by aesthetics alone.

7. Turn the hero workflows into the next refinement work order.

- Priority 1:
  - Workflow A: Meet-and-greet / hatching
  - Workflow B: Delegate a new coding task
  - Workflow C: Take over an existing thread
  - Workflow E: Review and summarize completed managed work
- Priority 2:
  - Workflow D: Give a thread back to the user
  - Workflow F: Manage thread clutter
  - Workflow G: Reuse memory and workspace context
- Priority 3:
  - Workflow H: Coordinate with another agent or manager

- Use this order to stage the next refinement pass:
  1. prompt refinement for A/B/C/E
  2. CLI/tooling audit for B/C/D/E/H
  3. memory/workspace refinement for G
  4. archival behavior refinement for F
  5. UI polish that directly supports these workflows

# Validation

- Review the hero workflows and confirm they cover the main reasons a user hires a manager.
- For each workflow, verify that we can answer:
  - what the user says
  - what the manager should understand
  - what action the manager should take
  - what Beanbag concepts are involved
  - what CLI/tooling support is required
  - what QA scenario should exist
- Use the workflows as the checklist for the next prompt rewrite and CLI audit.
- During refinement, run closed-loop standalone-daemon QA against at least the Priority 1 workflows before broadening further.

# Open Questions/Risks

- Whether the initial hero workflow list is complete, or whether we are missing an important "keep me informed while multiple things are in flight" workflow.
- Whether cross-project manager coordination should remain a secondary workflow for now or be elevated sooner.
- Whether some workflows need first-class product primitives, not just better prompt guidance.
- Risk: if prompt refinement proceeds before these workflows are used as the driver, the system will keep improving locally while still feeling incoherent end to end.
