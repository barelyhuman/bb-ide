---
kind: prompt
title: Thread Ownership Assigned
summary: Notifies a parent thread that a child thread is now assigned to it.
intent: Let the new parent know it owns a thread so it can begin coordinating it.
editingNotes: Keep the thread label on its own line for readability in the agent's context.
variables:
  threadLabel: "Serialized thread mention token and title suffix, e.g. '@thread:thr_abc123 (Fix login bug)'."
---
[bb system]

The following thread is now assigned to you as a child thread:
{{threadLabel}}
Inspect it and decide whether to monitor it, message the user, or send a follow-up.
