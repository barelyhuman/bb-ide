# Frontend Test Quality Audit And Cleanup

## Purpose

Audit the frontend test suite and remove or rewrite tests that mostly verify wiring, mocked implementation details, or low-value component plumbing. The goal is a smaller, clearer suite that catches real regressions without slowing down everyday frontend work or creating false confidence.

This plan is intentionally file-agnostic. The specific test files should be selected when the cleanup branch is created, after active feature branches have stabilized.

## Goals

- Identify frontend tests that do not exercise meaningful user-visible behavior, state transitions, data transformations, or contract boundaries.
- Delete tests whose assertions would still pass if the real product behavior were broken.
- Rewrite tests when there is valuable behavior hidden behind a poor harness.
- Prefer pure behavior tests, focused hook tests, route/API contract tests, and small integration tests over broad component wiring tests.
- Reduce frontend test maintenance cost, mock complexity, and runtime where practical.

## Non-Goals

- Do not remove tests solely because they are slow.
- Do not preserve tests solely because they are fast.
- Do not replace deleted tests with snapshot coverage.
- Do not audit backend, daemon, CLI, or integration tests as part of this pass.
- Do not make broad React component refactors unless they are required to extract testable behavior.

## Audit Criteria

Classify each frontend test into one of these buckets:

1. Keep
   - Tests a real outcome: rendered user-visible state, persisted state, query cache state, validation result, request body, route response, or returned value.
   - Uses minimal mocking, limited to true external boundaries such as network, browser APIs, timers, or websocket transport.
   - Would fail for a plausible product regression.

2. Rewrite
   - Covers real behavior, but only through a brittle or over-mocked component harness.
   - Mostly asserts calls into internal hooks, providers, or private implementation paths.
   - Can be replaced by a pure helper test, focused hook test, or smaller integration test.

3. Delete
   - Tests only that props, hooks, providers, or mocked modules are connected.
   - Mocks most of the module's collaborators from inside the app.
   - Asserts call order or call presence without validating user-visible or persisted results.
   - Would continue passing if the feature stopped working in the real app.

## Audit Workflow

1. Generate a fresh inventory of frontend tests.
   - Count files and tests.
   - Capture per-file runtime.
   - Identify tests using heavy mocks, fake component probes, dynamic imports, fake routers, fake query clients, and fake websocket harnesses.

2. Review the highest-risk tests first.
   - Prioritize tests with many app-local mocks.
   - Prioritize tests that mount large component trees to verify one callback.
   - Prioritize slow files only when the assertions are also low-value or brittle.

3. For each reviewed area, write a short decision note.
   - Keep, rewrite, or delete.
   - What real behavior is protected today, if any.
   - What replacement coverage is needed before deletion, if any.
   - Whether production code needs a small extraction to make the behavior testable.

4. Make cleanup changes in small batches.
   - Delete clear wiring-only tests without replacement.
   - Rewrite mixed-value tests before deleting their old harness.
   - Extract pure helpers only when the extraction improves production readability too.
   - Avoid broad component restructuring during the audit unless the existing design blocks meaningful coverage.

5. Re-run the inventory after each batch.
   - Confirm test count changes are intentional.
   - Confirm runtime changes are measured rather than assumed.
   - Confirm no remaining test imports or references point to deleted files.

## Rewrite Guidelines

- Test behavior at the narrowest stable boundary.
- Prefer testing pure functions for policy, filtering, grouping, request construction, and state transitions.
- Prefer hook tests only when the hook itself owns meaningful behavior.
- Prefer one small integration test for a critical UI workflow over many tests that assert internal calls.
- Avoid mocking app-local hooks or components unless the test boundary is explicitly above them and the mocked part is irrelevant to the behavior under test.
- Avoid test-only component probes when a user interaction or direct helper call would express the same behavior more clearly.
- Keep React performance in mind when extracting helpers: avoid moving render-only derived state into effects, avoid broad subscriptions in components, and keep callback-only state reads out of render paths when practical.

## Validation

Run validation with Turbo after each cleanup batch:

```sh
pnpm exec turbo run test --filter=@bb/app > /tmp/bb-app-test-cleanup.txt 2>&1
pnpm exec turbo run typecheck --filter=@bb/app > /tmp/bb-app-typecheck-cleanup.txt 2>&1
pnpm exec turbo run lint --filter=@bb/app > /tmp/bb-app-lint-cleanup.txt 2>&1
```

Then inspect the output files directly and record:

- Passing or failing status.
- Frontend test file count.
- Frontend test count.
- Total wall time.
- Any materially slow remaining files that still look low-value.

## Exit Criteria

- Every reviewed frontend test is classified as keep, rewrite, or delete.
- Wiring-only tests identified during the audit are deleted.
- Mixed-value tests are either rewritten or have a documented reason to keep them temporarily.
- Remaining tests have assertions tied to real behavior or stable contracts.
- The frontend test, typecheck, and lint tasks pass through Turbo.
- The cleanup branch includes a short summary of deleted tests, rewritten tests, remaining risk, and measured runtime before and after.
