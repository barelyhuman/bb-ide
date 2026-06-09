---
kind: prompt
title: Child Thread Needs Attention
summary: Notifies a parent thread that one of its child threads is blocked on a pending interaction.
intent: Prompt the parent thread to inspect the blocker and decide whether to involve the user or redirect the work.
editingNotes: Keep this focused on parent-thread triage; do not imply the parent can approve or reject on the user's behalf.
variables:
  threadId: The child thread's ID.
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Child thread needs attention: {{threadId}}{{titleSuffix}}
The thread is blocked on a pending interaction. Inspect it and decide whether to ask the user, redirect the child thread, or take another coordination action.
