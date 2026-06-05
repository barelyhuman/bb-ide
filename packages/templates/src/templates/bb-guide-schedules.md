---
kind: instruction
title: bb Guide - Thread Schedules
summary: Thread schedule reference for recurring wakeups.
intent: Explain how to create, inspect, update, and remove thread schedules.
editingNotes: Keep this as the canonical thread schedule CLI reference. Do not describe storage-file schedule syntax.
---
Thread schedules

Use thread schedules when the system should wake an existing thread later for
reminders, recurring check-ins, or follow-up work. A schedule stores its cron
expression, timezone, enabled state, and the prompt that will be submitted when
it fires.

Create a schedule:

```bash
bb thread schedule create <thread-id> \
  --name daily-recap \
  --cron "0 8 * * 1-5" \
  --timezone America/Los_Angeles \
  --prompt "Review current project state and send a concise recap if there is useful progress to report."
```

List schedules:

```bash
bb thread schedule list <thread-id>
bb thread schedule list --self
```

Update a schedule:

```bash
bb thread schedule update <thread-id> <schedule-id> \
  --cron "0 */2 * * *" \
  --timezone UTC \
  --prompt "Check whether any deployment follow-up is needed."
```

Enable, disable, or delete a schedule:

```bash
bb thread schedule disable <thread-id> <schedule-id>
bb thread schedule enable <thread-id> <schedule-id>
bb thread schedule delete <thread-id> <schedule-id>
```

Constraints:

- Schedule names are unique per thread.
- The cron month field must stay `*`.
- Schedules must not run more frequently than every 5 minutes.
- Scheduled turns deny permission escalation.

For one-off reminders, create a schedule for the next desired occurrence and
include instructions in the prompt to delete or disable the schedule after it
fires.
