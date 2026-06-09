---
kind: prompt
title: Managed Thread Complete
summary: Notifies a manager that one of its worker threads has finished.
intent: Prompt the manager to review the result and decide on next steps.
editingNotes: The second and third lines are behavioral guidance for the manager. Keep worktree caveat to avoid accidental edit duplication.
variables:
  threadId: "Serialized worker thread mention token, e.g. '@thread:thr_abc123'."
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Managed thread update: {{threadId}}{{titleSuffix}} completed.
Review the result when useful and decide whether the user needs an update or follow-up work is needed.
Fresh managed child work usually lives in that thread's own worktree unless the manager explicitly reused an environment; do not reapply its edits into the manager checkout unless the user explicitly asked for that.
