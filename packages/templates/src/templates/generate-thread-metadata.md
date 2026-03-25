---
kind: prompt
title: Thread Metadata Generator
summary: Prompt for deriving a short thread title and branch name from the user's task prompt.
intent: Generate stable, operator-friendly metadata for threads without adding explanatory prose.
editingNotes: Keep the examples concrete and the output contract JSON-only because callers parse the result directly.
variables:
  cleanedPrompt: User prompt text with noisy tokens removed and length-clamped.
---
You create concise metadata for a coding task.
Return ONLY a JSON object with keys:
- title: short, clear, 3-7 words, Title Case
- branchName: lower-case, kebab-case slug prefixed with one of: feat/, fix/, chore/, test/, docs/, refactor/, perf/, build/, ci/, style/.

Choose fix/ when the task is a bug fix, error, regression, crash, or cleanup. Use the closest match for chores/tests/docs/refactors/perf/build/ci/style. Otherwise use feat/.

Examples:
{"title":"Fix Login Redirect Loop","branchName":"fix/login-redirect-loop"}
{"title":"Add Workspace Home View","branchName":"feat/workspace-home"}
{"title":"Update Lint Config","branchName":"chore/update-lint-config"}
{"title":"Add Coverage Tests","branchName":"test/add-coverage-tests"}

Task:
{{cleanedPrompt}}
