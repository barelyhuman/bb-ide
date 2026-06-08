---
kind: prompt
title: Managed Thread Outcome Batch
summary: Notifies a manager about one or more managed worker thread outcomes.
intent: Give the manager batched outcome context without forcing immediate action for every child thread.
editingNotes: Keep this concise. The updates variable is a preformatted Markdown bullet list.
variables:
  updates: "Markdown bullet list of managed thread outcome updates."
---
[bb system]

Managed thread updates:
{{updates}}

Review the listed threads when useful and decide whether the user needs an update or follow-up work is needed.
