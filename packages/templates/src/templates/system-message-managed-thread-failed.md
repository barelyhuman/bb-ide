---
kind: prompt
title: Managed Thread Failed
summary: Notifies a manager that one of its worker threads failed.
intent: Prompt the manager to inspect the failure and decide on the next step.
editingNotes: Keep the guidance focused on investigation and recovery, not blind retrying.
variables:
  threadId: The failed worker thread's ID.
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Managed thread update: {{threadId}}{{titleSuffix}} failed.
Inspect the error and decide whether to retry, clarify the task, delegate a follow-up, or update the user.
Inspect the managed thread directly before taking action; do not reapply its edits into the manager checkout unless the user explicitly asked for that.
