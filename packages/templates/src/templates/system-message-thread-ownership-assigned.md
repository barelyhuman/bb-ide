---
kind: prompt
title: Thread Ownership Assigned
summary: Notifies a manager that a worker thread is now assigned to it.
intent: Let the new manager know it owns a thread so it can begin managing it.
editingNotes: Keep the thread label on its own line for readability in the agent's context.
variables:
  threadLabel: "Serialized thread mention token and title suffix, e.g. '@thread:thr_abc123 (Fix login bug)'."
---
[bb system]

The following thread is now assigned to you for management:
{{threadLabel}}
Inspect it and decide whether to monitor it, message the user, or send a follow-up.
