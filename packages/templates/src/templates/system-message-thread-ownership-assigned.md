---
kind: prompt
title: Thread Ownership Assigned
summary: Notifies a parent thread that a child thread is now assigned to it.
intent: Let the new parent know it owns a thread so it can begin coordinating it.
editingNotes: Keep the thread mention first in the visible body so collapsed previews show the affected thread.
variables:
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} is now assigned to you as a child thread.
Inspect it and decide whether to monitor it, message the user, or send a follow-up.
