---
kind: prompt
title: Child Thread Failed
summary: Notifies a parent thread that one of its child threads failed.
intent: Prompt the parent thread to inspect the failure and decide on the next step.
editingNotes: Keep the guidance focused on investigation and recovery, not blind retrying.
variables:
  threadId: The failed child thread's ID.
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Child thread failed: {{threadId}}{{titleSuffix}}
Review that thread's error and decide whether to retry, clarify the task, or update the user.
Inspect the child thread directly before taking action; do not reapply its edits into the parent checkout unless the user explicitly asked for that.
