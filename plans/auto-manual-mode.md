# Auto vs Manual Modes

In "Manual mode", a user's prompt is used to kickoff an new agent thread. That thread is expected to do the work directly and the user is responsible for managing it (steering, follow ups etc). This is great for quick tasks, tight control and very synchronous workflows with lots of back and forth.

In "Auto mode", a user's prompt is sent to an agent who delegates the work to other agents and track progress until completion.

## Roles

Auto mode introduces the concept of agent roles. Roles define a structure to help coordinate the work between agents.

By default, there are 3 roles in the system:

| role             | description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| agent/manage     | interface with user, creates task and assigns to agent/build/main |
| agent/build/main | works with agent/build/code to complete the task                  |
| agent/build/code | write the code                                                    |

> The `agent/build/` convention is used to visually group a team of roles together but do not mean anything otherwise. You can imagine adding an `agent/build/review` role to the `agent/build/` team.

Here's an example flow:

- user: submits prompt
- agent/manage: creates a task and assigns it to an agent/build/main
- agent/build/main: gives the task to agent/build/code
- agent/build/code: write the code
- agent/build/main: reviews the work of the agent/build/code, potentially follows up / steers it
- agent/build/code: performs follow up
- agent/build/main: when done, changes the status of the task
- agent/manage: notifies the user of the change in task status

# How it works

## Role definitions

Roles are defined in markdown files: `.beanbag/roles/*.md `. Example:

```md
---
id: agent/manage
name: Manage
description: "..."
---

You are a manager of agents. When prompted to do work, you should create a task and assign it to the agent/build/main agent.
```

In the sidebar, all the roles will be listed above the list of projects and threads. For the mvp, the "edit" button for a role will simply open the system default markdown editor.

When using auto mode, the user has a long running thread with agent/manage. Its behavior is defined by its `role/*.md` but by default it is asked to create a task and assign the task to agent/build/main.

For the MVP, we won't worry about memory and compaction for this long running thread but the goal is to give this agent a way to see its history using the `bb` cli so we only need to give it the last few messages everytime.

## Task Model

Tasks are the unit of orchestration. TaskEvents track events associated to a task

Task Fields:

- `id`
- `title`
- `description` (nullable)
- `projectId`
- `parentTaskId` (nullable)
- `roleId` (intended owner role)
- `assigneeThreadId` (nullable runtime worker thread)
- `status`
- `blockedByTaskIds` (JSON array)
- `createdAt`, `updatedAt`
- `completedAt` (nullable)
- `resultSummary` (nullable)

Status enum:

- `pending`
- `in_progress`
- `blocked`
- `completed`
- `failed`
- `canceled`

TaskEvents should be a strongly type discriminated union to capture:

- creation
- status/assignee changes
- key updates like threads created etc

Task status changes will forwarded to the parentTaskId's assignee or the primary agent/manage if there's no parentTaskId.

## Extending thread

The thread model will have the following additions:

- **role**: The agent's role (nullable for manual mode)
- **taskId**: The associated task id (nullable for manual mode)
- **managedBy**: A reference to the threadId of another thread managing this thread. (nullable for manual mode). This is how we know which thread to notify when a thread is done with a turn.

## `bb` cli and skill

As part of auto mode, we need to make sure that the `bb` provides functionality for agents to work autonomously. Agents will learn how to use the `bb` cli via an autoloaded skill.

- read, create and update tasks
- read, spawn and update threads
- steer/follow-up on threads
