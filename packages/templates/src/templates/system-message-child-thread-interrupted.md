---
kind: prompt
title: Child Thread Interrupted
summary: Notifies a parent thread that one of its child threads was interrupted.
intent: Prompt the parent thread to inspect the thread and decide whether to resume or redirect the work.
editingNotes: Preserve the "inspect first" guidance so parent threads do not guess why the thread stopped.
variables:
  threadId: The interrupted child thread's ID.
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Child thread interrupted: {{threadId}}{{titleSuffix}}
Inspect the child thread directly before taking action. If it was stopped manually by the user, treat that as intentional; update the user if useful, but do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.
Otherwise decide whether to resume it, redirect it, or update the user.
Do not reapply its edits into the parent checkout unless the user explicitly asked for that.
