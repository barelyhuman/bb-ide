---
kind: prompt
title: Thread Metadata Generator
summary: Prompt for deriving a short thread title from the user's task prompt.
intent: Generate stable, operator-friendly metadata for threads without adding explanatory prose.
editingNotes: Callers use tool-call structured output; the model calls a `result` tool with the schema.
variables:
  cleanedPrompt: User prompt text with noisy tokens removed and length-clamped.
---
You create concise titles for coding tasks.
Call the `result` tool with:
- title: short, clear, 3-7 words, Title Case

Task:
{{cleanedPrompt}}
