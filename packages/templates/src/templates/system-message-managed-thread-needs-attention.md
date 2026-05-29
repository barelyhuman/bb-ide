---
kind: prompt
title: Managed Thread Needs Attention
summary: Notifies a manager that one of its worker threads is blocked on a pending interaction.
intent: Prompt the manager to inspect the blocker and decide whether to involve the user or redirect the work.
editingNotes: Keep this focused on manager triage; do not imply the manager can approve or reject on the user's behalf.
variables:
  threadId: The worker thread's ID.
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Managed thread needs attention: {{threadId}}{{titleSuffix}}
The thread is blocked on a pending interaction. Inspect it and decide whether to ask the user, redirect the worker, or take another management action.
