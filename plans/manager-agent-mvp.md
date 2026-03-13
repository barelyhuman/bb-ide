# Goal

Define a concise MVP for a manager agent feature in `bb` based on the current product decisions.

This document is the simplified product proposal for the manager agent feature.

The concrete start-work implementation plan lives in [manager-agent-implementation-plan.md](/Users/michael/.codex/worktrees/37ec/bb/plans/manager-agent-implementation-plan.md).

# Scope

In scope:

- The user-facing product shape of the manager agent feature
- The key technical/product model decisions needed for an MVP
- The hero user stories for the feature
- The happy-path end-to-end flows

Out of scope:

- Exact API endpoints and DB schema
- Final UI copy
- Sub-managers in v1
- Multiple peer managers per project in v1
- Rich deliverable cards/panels beyond simple file-backed links
- Detailed rules for direct worker steering in v1

# Implementation Steps

## MVP Summary

`bb` will let a user hire one primary manager agent per project.

From the user’s perspective, the manager is a long-running project assistant they chat with directly. The manager’s job is to delegate work to spawned threads, keep the user informed, and hand back meaningful results without forcing the user to manually coordinate many parallel threads.

Under the hood, the manager is a special long-running thread with:

- manager-specific instructions
- its own workspace under `~/.beanbag/workspace/<threadId>/`
- a dedicated tool for replying to the user
- the ability to spawn and manage child threads

Manager-managed child threads remain normal `standard` threads technically, but they are presented differently in the product:

- they appear nested under the manager in the sidebar
- they are considered managed work
- completion updates go to the manager rather than directly to the user

Regular threads still exist in the same project and remain visible in the sidebar. They are visually separated from manager-managed threads.

Thread ownership is transferable in both directions in v1:

- a user can start a thread directly and then hand it off to the manager
- a manager can start a thread and the user can later take it over

In v1 there is exactly one primary manager per project. If the user tries to hire a manager again, `bb` reopens the existing manager.

## Product Changes

### User-facing changes

1. Projects can now have a primary manager.

- The user hires a manager in the context of a project.
- The manager behaves like a coworker the user can train over time through chat.

2. The manager becomes a new top-level conversation surface.

- The user chats with the manager in a normal IM-like thread.
- The manager does not expose tool calls, internal reasoning, or raw orchestration chatter unless it explicitly chooses to send a user-facing update.

3. The sidebar shows managed work as a hierarchy.

- The manager appears as a thread row.
- Manager-managed child threads appear indented under it.
- Regular user-owned threads still appear in the sidebar as regular threads.

4. The user can hand threads back and forth between themselves and the manager.

- Manager-managed standard thread:
  - shown under the manager
  - treated as part of the manager’s workload
  - completion notifications go to the manager
- Unmanaged standard thread:
  - shown as a regular thread
  - treated as the user’s thread
  - unread state behaves like a normal thread for the user

5. Longer-form outputs are presented as files linked from manager chat.

- In v1, plans, reports, and similar outputs are markdown files in the manager’s workspace.
- The manager presents them by sending a chat message with a link to the file.
- The secondary panel can surface these deliverables through a readonly view of the manager workspace.

### Key technical details

1. One primary manager per project in v1.

- The project stores a stable reference to its primary manager thread.
- Hiring again reopens that manager rather than creating a duplicate.

2. The manager is implemented as a special long-running thread.

- Manager-specific instructions define its role as delegation-first and user-facing.
- The manager replies through a dedicated custom tool call.
- The manager delegates work by spawning child threads.

3. Manager state lives outside the repo.

- Each manager gets a workspace under `~/.beanbag/workspace/<threadId>/`.
- This workspace can hold files such as:
  - `INSTRUCTIONS.md`
  - memory/notes created over time
  - manager-created markdown deliverables

4. Child threads remain normal threads with thread type + ownership metadata.

- `thread.type` distinguishes:
  - `standard`
  - `manager`
- `parentThreadId` indicates whether a `standard` thread is currently managed by a manager.
- Ownership can be added or removed by updating `parentThreadId`.
- Ownership affects sidebar placement and notification routing.

5. Hiring a manager should behave like normal thread creation.

- Either the manager is created successfully and is usable
- Or hiring fails, the user stays in their current UI state, and `bb` shows a retryable error
- There is no special half-configured manager state in v1

## Draft `Manager INSTRUCTIONS.md`

The MVP should include a concrete manager instructions file so the manager behavior is explicit and testable.

```md
# Manager Instructions

You are the manager agent for this project.

Your job is to help the user by managing threads on their behalf.
You should behave like a strong delegating coworker, not like a normal coding thread.

## Core role

- You are the primary user-facing agent for this project.
- The user talks to you directly in chat.
- Your main job is to delegate work to other threads.
- You should generally not do the substantive implementation work yourself.

## User communication

- Reply to the user using the dedicated user-reply tool.
- Do not expose raw tool calls, hidden reasoning, or internal orchestration chatter.
- Give concise updates when there is something meaningful to report.
- If work completes, is blocked, or needs input from the user, tell them.
- Do not be noisy.

## Delegation

- Delegate essentially all implementation work.
- Spawn child threads when work needs to be done.
- Use separate child threads for separate workstreams when helpful.
- Keep track of which child thread owns which task.
- When a child thread finishes, decide whether the user needs an update.

## Ownership model

- Some threads are manager-managed and some are unmanaged.
- A manager-managed standard thread is part of your managed workload.
- An unmanaged standard thread is not your responsibility unless the user explicitly asks you to manage it.
- The user may hand a thread to you.
- The user may take a thread back from you.
- When a thread is handed to you, you will receive a system message describing the ownership change, for example:
  - `[bb system]: User assigned you the following thread to manage:`
  - `<threadId>: <thread title>`
- You can then decide what to do.
- When a thread is taken back by the user, stop treating it as part of your managed workload.

## Hatching / onboarding

- When you first start, run a lightweight meet-and-greet with the user.
- Ask how they like to work and how they want to be addressed.
- Learn their preferences through conversation rather than a rigid setup wizard.
- Save durable preferences in your workspace so you can improve over time.

## Memory and files

- Your workspace lives outside the repo under `~/.beanbag/workspace/<threadId>/`.
- Use it for durable files such as:
  - `INSTRUCTIONS.md`
  - notes/memory files
  - plans, reports, and other markdown deliverables
- Do not store secrets in memory files.

## Deliverables

- If you produce a longer-form output, write it as a file in your workspace.
- Present that file to the user by sending a chat message with a link to it.
- Do not dump very long docs inline into chat if a file is more appropriate.

## Interaction style

- Be proactive when it matters, quiet when it does not.
- Keep updates useful and concrete.
- Optimize for reducing the user’s coordination burden.
```

This file does not need to be final yet, but it gives the MVP a concrete behavioral contract for:

- delegation-first behavior
- user-facing communication
- thread handoff behavior
- onboarding/hatching
- file-backed deliverables
- manager workspace usage

## Hero Use Cases / User Stories

1. Offload coordination of parallel work

- As a user, I want to give one high-level request to a manager and let it coordinate multiple worker threads for me so I do not have to manually manage every thread myself.

2. Train a manager over time

- As a user, I want the manager to learn my preferences and workflow through ongoing chat so it becomes more useful over repeated sessions.

3. Keep regular threads alongside managed work

- As a user, I want to keep using normal threads in the same project while also having a manager for delegated work.

4. Hand work to the manager after starting it myself

- As a user, I want to start a thread directly and later ask the manager to take it over when I no longer want to manage it myself.

5. Take work back from the manager

- As a user, I want to take over a manager-managed thread when I decide I want to work with that thread directly.

6. Receive useful outputs, not just status chatter

- As a user, I want the manager to hand me plans, reports, and other longer-form outputs as actual files I can open, not only as long chat messages.

## Happy-Path Flows

### Flow 1: Hire a manager for a project

1. The user opens a project.
2. The user chooses `Hire Manager`.
   - In v1 this is a `user-round-plus` action beside the archive and settings icons in the project main view.
3. `bb` creates the project’s primary manager thread.
4. `bb` initializes the manager workspace under `~/.beanbag/workspace/<threadId>/`.
5. The manager starts its first turn and runs its hatching/onboarding behavior.
6. The user lands in the manager chat.
7. The manager begins a lightweight interactive onboarding in chat and starts learning the user’s preferences.

Outcome:

- The project now has one primary manager.
- The manager is available as an ongoing chat surface.

### Flow 2: User delegates a high-level task to the manager

1. The user opens the manager thread.
2. The user sends a high-level request such as “Can we work on X?”
3. The manager decides how to break the work down.
4. The manager spawns one or more child threads.
5. Those child threads appear indented under the manager in the sidebar.
6. The manager receives completion updates as child threads finish.
7. The manager sends user-facing updates only when there is something meaningful to report.

Outcome:

- The user talks to one manager instead of manually coordinating several worker threads.

### Flow 3: User checks on manager work

1. The manager has meaningful progress or a result to share.
2. The manager sends a user-facing message in the manager thread.
3. The manager thread shows unread state in the sidebar.
4. The user opens the manager thread to read the update.

Outcome:

- In v1, unread manager messages are the main check-in mechanism.

### Flow 4: Manager produces a plan or report

1. The user asks the manager for a plan, report, or similar output.
2. The manager delegates work as needed.
3. The manager writes a markdown file in its workspace.
4. The manager sends a chat message linking to that file.
5. The user opens the file from the message.
6. The secondary panel can surface that deliverable later.

Outcome:

- Longer-form outputs are delivered as files linked from the manager chat.

### Flow 5: User hands a thread off to the manager

1. The user starts a regular thread directly.
2. Later, the user decides they want the manager to handle it.
3. The user either:
  - asks the manager in chat to take over the thread, or
  - uses an `assign to manager` action in the thread info tab
4. The thread becomes manager-managed by setting its parent manager link.
5. The thread moves under the manager in the sidebar.
6. The manager receives a system message about the ownership change in the format:
   - `[bb system]: User assigned you the following thread to manage:`
   - `<threadId>: <thread title>`
7. The manager can inspect the thread with `bb` tooling and continues the work if needed.

Outcome:

- Existing user-started work can become managed work without starting over.

### Flow 6: User takes over a manager-managed thread

1. The manager has spawned a child thread.
2. The user decides they want to work with that thread directly.
3. The user either:
  - asks the manager to hand it back, or
  - uses a `take over` action on the managed thread
4. The thread becomes unmanaged by clearing its parent manager link.
5. The thread moves out of the manager hierarchy and into the regular thread list.
6. The manager stops receiving completion updates for that thread.

Outcome:

- Managed work can return to direct user ownership cleanly.

## MVP Design Principles

1. Keep the user-facing model simple.

- “Hire a manager for this project.”
- “Talk to the manager.”
- “The manager can create and manage threads for you.”

2. Keep threads as the technical primitive.

- The manager is special in product behavior, but not a separate orchestration universe.

3. Prefer simple v1 surfaces over rich new UI concepts.

- No separate check-in system in v1
- No sub-managers in v1
- No multiple managers per project in v1
- No complex deliverable UI in v1

4. Optimize for experimentation.

- The feature should be coherent enough to use for real work, but flexible enough to evolve quickly as usage teaches us where the real value is.

# Validation

- The feature can be explained simply: hire a manager for a project and chat with it to delegate work.
- There is one primary manager per project in v1.
- Regular threads and manager-managed threads coexist.
- Ownership can move in both directions between user and manager.
- The sidebar hierarchy is straightforward:
  - manager row
  - indented manager-managed threads
  - regular threads alongside them
- The main check-in mechanism is simple:
  - unread manager messages
  - open manager thread
- Longer-form outputs have a pragmatic v1 path:
  - markdown files linked from manager chat
  - readonly manager-workspace view in the secondary panel

# Open Questions/Risks

- V1 intentionally relies on unread manager messages as the main status/check-in surface.
- V1 intentionally keeps manager customization chat-only, with readonly secondary-panel inspection.
- V1 intentionally keeps the manager workspace lightweight: seeded `INSTRUCTIONS.md` plus manager-created files.
- Worker-specific durable memory may add complexity depending on how often threads are handed off or reused.
