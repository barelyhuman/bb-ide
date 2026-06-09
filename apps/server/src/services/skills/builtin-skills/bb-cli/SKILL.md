---
name: bb-cli
description: Use the bb CLI to inspect, create, coordinate, schedule, and follow up on bb threads from inside a running thread.
---

# bb CLI

Use the `bb` CLI when you need to inspect bb state or coordinate work across threads.

## Thread Coordination

- Use `bb thread spawn --prompt "..."` to create another thread.
- Use `bb thread spawn --parent-thread <thread-id> --prompt "..."` to create a child thread owned by a parent thread.
- When running inside a thread, `bb thread spawn --prompt "..."` defaults the parent to `BB_THREAD_ID`. Add `--no-context-parent-thread` when you need an unrelated root thread.
- Use `bb thread list` to find threads and `bb thread show <thread-id>` to inspect status, parent, environment, and result fields.
- Use `bb thread tell <thread-id> "..."` to send a follow-up to an existing thread.
- Use `bb thread wait <thread-id>` to wait for a thread to finish.
- Use `bb thread log <thread-id>` to inspect the conversation log.
- Use `bb thread output <thread-id>` to print the latest thread output.

## Scheduling

- Use `bb thread schedule create <thread-id> --name <name> --cron <cron> --timezone <tz> --prompt "..."` to schedule recurring work for a thread.
- Use `bb thread schedule list <thread-id>` to inspect schedules.
- Use `bb thread schedule update <thread-id> <schedule-id>` to change schedule configuration.
- Use `bb thread schedule enable <thread-id> <schedule-id>` and `bb thread schedule disable <thread-id> <schedule-id>` to control whether a schedule runs.
- Use `bb thread schedule delete <thread-id> <schedule-id>` to remove a schedule.

## Context

- Use `bb status` for the current project, thread, and environment context.
- Use `bb project list` and `bb project show <project-id>` to inspect projects.
- Use `bb environment show <environment-id>` when a thread's workspace or branch state matters.
- Prefer generic `bb thread` commands for parent/child work. Manager commands may exist for compatibility, but they are not required to coordinate child threads.
