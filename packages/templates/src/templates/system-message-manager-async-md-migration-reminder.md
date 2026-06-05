---
kind: system-message
title: Manager ASYNC.md Migration Reminder
summary: Tells a manager that ASYNC.md is deprecated and must be migrated to thread schedules.
intent: Remind legacy managers that ASYNC.md no longer drives scheduled work, without reintroducing ASYNC.md parsing or scheduling.
---

[bb system]

`ASYNC.md` is deprecated. You still have `ASYNC.md` in thread storage, but bb no longer reads it for scheduled work.

Please migrate any reminders or recurring check-ins from `ASYNC.md` to thread schedules with `bb thread schedule create ...`. Run `bb guide schedules` for syntax and constraints.

After migrating, delete or rename `ASYNC.md`; it is now only a legacy note and will not schedule future wakeups.
