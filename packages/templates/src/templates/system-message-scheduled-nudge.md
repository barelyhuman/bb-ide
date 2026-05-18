---
kind: prompt
title: Scheduled Nudge
summary: Wakes up a manager on its declared cron schedule.
intent: Prompt the manager to read the matching ASYNC.md section and decide if there's real work to do.
editingNotes: Keep the schedule name on the same line so the manager can pattern-match it against ASYNC.md.
variables:
  name: The schedule name as declared in the manager's ASYNC.md frontmatter.
---
[bb system]

Scheduled nudge: {{name}}. Check ASYNC.md.
