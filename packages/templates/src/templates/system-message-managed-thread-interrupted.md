---
kind: prompt
title: Managed Thread Interrupted
summary: Notifies a manager that one of its worker threads was interrupted.
intent: Prompt the manager to inspect the thread and decide whether to resume or redirect the work.
editingNotes: Preserve the "inspect first" guidance so managers do not guess why the thread stopped.
variables:
  threadId: "Serialized worker thread mention token, e.g. '@thread:thr_abc123'."
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Managed thread update: {{threadId}}{{titleSuffix}} was interrupted.
Inspect the managed thread directly before taking action. If it was stopped manually by the user, treat that as intentional; update the user if useful, but do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.
Otherwise decide whether to resume it, redirect it, or update the user.
Do not reapply its edits into the manager checkout unless the user explicitly asked for that.
