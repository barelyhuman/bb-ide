# Phase 6D: Test Matrix and Quality Gates

## Goal

Define the minimum coverage and validation gates required to ship Phase 6 safely.

## Required Coverage by Package

### `@beanbag/agent-core`

- prompt input schema expansion tests (`localFile` and attachment unions)
- event projection tests for provisioning lifecycle messages (if new app event types are added)
- exhaustive union handling checks for new closed-internal states

### `@beanbag/db`

- thread `environmentId` persistence tests
- migration tests for new columns/default behavior
- repository decode/guard tests for new fields

### `@beanbag/agent-server`

- environment adapter tests:
  - local prepare success
  - worktree prepare success
  - worktree fallback metadata for non-git root and add failure
  - cleanup behavior and error propagation
- provider input mapping tests for attachment fallback behavior

### `@beanbag/daemon`

- route tests:
  - spawn with `environmentId`
  - attachment payload validation
  - optional upload endpoint validation (if added)
- thread-manager tests:
  - provisioning lifecycle event emission
  - attachment propagation into provider params
  - cleanup failure event behavior

### `@beanbag/app`

- PromptBox and composer-state tests:
  - attach/remove file
  - attach/remove image
  - drag/drop and paste flows
  - draft persistence for attachments + text
- voice tests:
  - unsupported browser
  - permission denied
  - transcript insertion and stop behavior
- view-level tests:
  - project/thread prompt submit includes attachments and selected environment

## E2E Scenarios

1. Spawn thread in `local` mode with text + file attachment.
2. Spawn thread in `worktree` mode and verify fallback metadata when project is non-git.
3. Tell existing thread with image attachment.
4. Voice dictate text, submit, verify sent prompt text.

## CI Gates

- `pnpm typecheck` passes.
- `pnpm test` passes.
- No reduction in coverage for touched modules.
- Contract docs updated when schema/event type changes are introduced.

## Release Checklist

1. Validate migration path on fresh and existing DBs.
2. Validate supported browser matrix for voice behavior.
3. Validate attachment size limits and error copy.
4. Validate thread replay still renders legacy rows correctly.
