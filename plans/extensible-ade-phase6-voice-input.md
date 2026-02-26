# Phase 6C: Voice Input Plan

## Goal

Add browser voice dictation to the prompt composer with reliable fallbacks and no regression to existing keyboard-first flow.

## Current Gaps

- No voice capture controls in composer UI.
- No state model for listening/transcribing/error.
- No feature detection or permission-state UX.

## Product Constraints

- Local browser capture only for Phase 6.
- No server-side speech model dependency.
- Output is plain text inserted into composer draft.

## Contract Decisions

- Voice is a composer concern, not a new `PromptInput` variant.
- Sent requests remain standard text/image/file prompt inputs.
- Voice state union is `closed_internal` and exhaustively handled:
  - `idle`
  - `checking-capability`
  - `listening`
  - `transcribing`
  - `error`

## UX Model

1. Mic action in prompt composer footer.
2. Explicit status badge/text for listening/transcribing/error.
3. User controls:
   - start capture
   - stop capture
   - clear last transcript chunk (optional)
4. Fallback behavior:
   - unsupported browser: disabled control with tooltip/copy
   - permission denied: actionable error state without blocking text entry

## Technical Design

- Add `useVoiceInput` hook in app:
  - capability detection
  - speech recognition lifecycle
  - transcript callback for composer insert
- Insert policy:
  - append transcript at cursor with whitespace normalization
  - preserve undo-friendly update boundaries
- Concurrency policy:
  - prevent duplicate listeners
  - stop voice capture on submit or thread switch

## Test Plan

- hook tests with mocked speech APIs:
  - capability available/unavailable
  - permission denied
  - result event and transcript merge behavior
- PromptBox integration tests:
  - start/stop controls
  - disabled state in unsupported environments
  - submit while listening transitions correctly

## Commit Chunks

1. Voice hook + state model + unit tests.
2. Prompt UI control integration.
3. Fallback/error messaging and interaction polish.
4. Regression tests for submit/stop/thread switch behavior.

## Exit Criteria

- Supported browsers can dictate text into the prompt box.
- Unsupported/denied flows degrade cleanly without blocking typed prompts.
- Voice mode does not break submit, stop, or draft persistence behavior.
