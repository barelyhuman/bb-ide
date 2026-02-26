# Phase 6 Table-Stakes Feature Plan

## Objective

Ship minimum expected ADE interaction quality after Phase 5 topology/contracts work and before scheduler/automation.

## Scope Summary

- Environment provisioning parity (`local`, `worktree`) with predictable UX.
- Prompt composer attachments (files and images) end-to-end.
- Voice input to prompt text with graceful fallbacks.

## Non-Goals

- Cloud sandbox providers.
- Full binary artifact management UI.
- Cross-device voice sync or server-side speech models.

## Workstream A: Environment Provisioning Parity

## Outcomes

- Users can choose environment per thread start.
- Provisioning states and fallback reasons are visible and actionable.
- Worktree lifecycle cleanup is reliable.

## Deliverables

- API contracts:
  - thread spawn/tell execution options include environment choice where needed
  - explicit provisioning result/fallback metadata in thread lifecycle events
- Runtime behavior:
  - deterministic local/worktree setup and cleanup
  - structured failure reasons (for example: missing git root, add failed, cleanup failed)
- UI behavior:
  - environment picker in prompt flow (where applicable)
  - visible provisioning/fallback status in thread view

## Tests

- unit tests for environment adapter fallback and cleanup paths
- route/integration tests for environment selection propagation
- e2e thread spawn tests for both `local` and `worktree`

## Workstream B: File and Image Attachments

## Outcomes

- Users can attach files and images directly from the prompt composer.
- Attachments are visible as chips and included in thread start/tell payloads.

## Deliverables

- Core contracts:
  - extend prompt input union for file attachments (closed-internal)
  - retain existing image/localImage semantics and make ownership explicit
- API and daemon:
  - validate attachment payloads with typed schemas
  - enforce path safety/size limits for local files
- UI:
  - attachment button(s), drag-drop, and paste support
  - removable attachment chips with type/size indicators
  - send pipeline emits typed prompt input array

## Tests

- prompt composer unit tests (attach, remove, keyboard behavior)
- API validation tests for attachment schema
- integration tests that attachment payloads reach provider bridge

## Workstream C: Voice Input

## Outcomes

- Users can dictate prompt text in supported browsers.
- Unsupported browsers fail gracefully without breaking composer flow.

## Deliverables

- UI:
  - microphone control (push-to-talk or toggle mode)
  - live transcription insertion into composer
  - explicit states: idle/listening/transcribing/error
- Capability detection:
  - browser feature detection and UX fallback copy
- Contract policy:
  - voice output is normalized to plain text prompt input at send time

## Tests

- hook/component tests with mocked speech APIs
- failure-state tests (permission denied, unavailable API)
- regression tests for submit/stop behavior while voice mode is active

## Cross-Cutting Requirements

- Strong typing for all new prompt input variants and UI states.
- Clear closed-internal vs open-external union ownership classification.
- No regression in existing text-only prompt flow.
- Performance guardrails for large attachments and long transcripts.

## Suggested Delivery Order

1. Environment provisioning parity baseline and status surfaces.
2. File attachments (lowest-risk multimodal path).
3. Image attachments/paste and payload normalization.
4. Voice input with fallback behavior.
5. Final UX hardening and test sweep.

## Exit Criteria

- A user can run thread workflows in local or worktree modes with transparent status.
- A user can attach files/images and see them represented in sent input.
- A user can use voice to draft text in supported browsers.
- `pnpm typecheck` and `pnpm test` pass with added coverage for all three workstreams.
