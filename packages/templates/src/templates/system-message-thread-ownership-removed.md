---
kind: prompt
title: Thread Ownership Removed
summary: Notifies a parent thread that a child thread is no longer assigned to it.
intent: Let the previous parent know a thread moved away so it can update its internal tracking.
editingNotes: Keep the thread mention first in the visible body so collapsed previews show the affected thread.
variables:
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} is no longer assigned to you.
Stop treating it as one of your active child threads unless it is assigned back later.
