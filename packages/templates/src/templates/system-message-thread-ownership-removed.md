---
kind: prompt
title: Thread Ownership Removed
summary: Notifies a manager that a worker thread is no longer assigned to it.
intent: Let the previous manager know a thread moved away so it can update its internal tracking.
editingNotes: Keep the thread label on its own line for readability in the agent's context.
variables:
  threadLabel: "Thread identifier and title, e.g. 'thr_abc123: Fix login bug'."
---
[bb system]: The following thread is no longer assigned to you:
{{threadLabel}}
Stop treating it as one of your active managed threads unless it is assigned back later.
