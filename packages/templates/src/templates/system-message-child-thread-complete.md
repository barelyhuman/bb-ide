---
kind: prompt
title: Child Thread Complete
summary: Notifies a parent thread that one of its child threads has finished.
intent: Prompt the parent thread to review the result and decide on next steps.
editingNotes: The second and third lines are behavioral guidance for the parent thread. Keep worktree caveat to avoid accidental edit duplication.
variables:
  threadId: The completed child thread's ID.
  titleSuffix?: "Formatted title suffix like ' (Fix login bug)', or empty string if untitled."
---
[bb system]

Child thread complete: {{threadId}}{{titleSuffix}}
Review that thread's result and decide whether to update the user or delegate a follow-up.
Fresh child work usually lives in that thread's own worktree unless the parent explicitly reused an environment; do not reapply its edits into the parent checkout unless the user explicitly asked for that.
