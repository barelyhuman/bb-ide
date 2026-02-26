# Phase 6 Table-Stakes Feature Plan

## Status

- State: active
- Last updated: 2026-02-26
- Owner: Beanbag core

## Objective

Ship minimum expected ADE interaction quality after Phase 5 topology/contracts work and before scheduler/automation.

## Scope

- Environment provisioning parity for `local` and `worktree`.
- Prompt composer file attachments end-to-end.
- Prompt composer image attachments/paste end-to-end.
- Voice input capture to prompt text with graceful fallback behavior.
- Test coverage across all of the above.

## Non-Goals

- Cloud sandbox provisioning.
- Multi-device media sync.
- Provider-specific binary upload pipelines beyond local trusted workflows.
- Scheduler/automation features (Phase 7).

## Planning Documents

- `plans/extensible-ade-phase6-environment-provisioning.md`
- `plans/extensible-ade-phase6-prompt-attachments.md`
- `plans/extensible-ade-phase6-voice-input.md`
- `plans/extensible-ade-phase6-test-matrix.md`

## Cross-Cutting Contract Rules

- Keep `closed_internal` unions exhaustive with `assertNever`.
- Keep tolerant fallbacks only for `open_external` provider/runtime values.
- Add typed decode/guard helpers at every boundary crossing.
- Preserve compatibility for existing text-only prompt flow.

## Proposed Delivery Chunks

1. Contracts and persistence baseline:
   - environment selection contract and thread ownership
   - prompt attachment union and schema updates
2. Provisioning parity implementation:
   - local/worktree lifecycle parity
   - provisioning/fallback status surfaces
3. File and image composer flows:
   - attach/remove UI, drag-drop, paste
   - daemon/API validation and path policy
4. Voice input flow:
   - capability detection, listening/transcribing states
   - transcription insertion and fallback UX
5. Hardening pass:
   - integration and e2e coverage
   - performance and regression checks

## Exit Criteria

- Users can reliably choose and run `local` or `worktree` with visible status/fallback.
- Users can attach files/images and send them through thread spawn/tell flows.
- Users can dictate prompt text in supported browsers without breaking composer UX.
- `pnpm typecheck` and `pnpm test` pass with new table-stakes coverage.
