# Roadmap P1 Execution: Data/Rendering Unification + Titling Simplification

## Goal

Deliver April 2026 P1 items from `plans/ROADMAP.md`: remove daemon-side title orchestration, eliminate legacy runtime compatibility paths, and simplify thread data/rendering flow authority.

## Scope

- `apps/daemon`
  - title ownership and event handling
  - timeline/event projection behavior
- `apps/app`
  - timeline-driven rendering consistency
  - token/context usage derivation updates
- `packages/agent-core`, `packages/agent-server`
  - legacy event compatibility removal
  - parser/projection updates and tests

## Implementation Steps

1. **Titling ownership cleanup**
   - Remove daemon-triggered async title generation/fallback orchestration.
   - Keep provider event + explicit user rename as title authorities.
   - Update tests for manual title lock behavior and provider rename rules.

2. **Legacy compatibility removal**
   - Remove runtime handling paths for `codex/event/*` compatibility where canonical `thread/*`, `turn/*`, `item/*` events exist.
   - Keep tolerant handling only for open external unknown provider events.

3. **Token/context usage migration**
   - Derive context usage from v2 token usage events only (`thread/tokenUsage/updated`).
   - Remove legacy token-count dependencies from app utilities/tests.

4. **Data-flow simplification checks**
   - Ensure canonical message rendering path remains `ConversationEntry` + `ConversationWorkingIndicator`.
   - Minimize mixed authority between timeline and raw events where practical.

## Validation

- `pnpm --filter @beanbag/agent-core test`
- `pnpm --filter @beanbag/app test`
- `pnpm --filter @beanbag/daemon test`
- Thread detail smoke checks across refresh/reconnect for duplicate-row regressions.

## Open Questions/Risks

- How should old persisted legacy events be rendered after runtime compatibility cleanup?
- Do we need a one-time data migration for deterministic title precedence on older threads?
