# Goal

Capture the frontend and React cleanup work needed to reduce recurring UI regressions, especially around auto-scroll behavior, scroll preservation, effect misuse, inconsistent shared UI behavior, and maintainability risks in large components.

# Scope

- Frontend React code under `apps/app/src/**`
- High-signal issues identified during the audit:
  - competing timeline scroll logic
  - scroll preservation and auto-scroll edge cases
  - effect-driven state synchronization that can reset local UI state
  - inconsistent shared interaction patterns across components
  - oversized components/hooks that make future hook-order mistakes easier to introduce
- Include both implementation changes and guardrails to prevent regressions.

# Implementation Steps

1. Consolidate timeline scroll management
   - Replace the split between `useAutoScroll`, `useScrollToBottomIndicator`, and timeline-specific anchor handling with one controller for:
     - sticky-bottom state
     - scroll-to-bottom indicator visibility
     - programmatic scroll requests
     - scroll anchor capture and restoration
     - resize / content-growth handling
   - Remove duplicated observers and event coordination on the same scroll container.

2. Harden scroll preservation behavior
   - Audit timeline and diff panel transitions that resize or reflow content.
   - Ensure panel resizing, composer height changes, tool-group expansion, and diff navigation preserve the user’s viewport unless they are intentionally pinned to bottom.
   - Add focused tests for:
     - staying pinned when already at bottom
     - preserving viewport when scrolled away from bottom
     - panel open/close and resize behavior
     - composer growth and shrink behavior

3. Remove effect-driven state mirroring where render/event logic is enough
   - Refactor places where fetched props/data are copied into local state via `useEffect` and can overwrite user edits or optimistic UI.
   - Priority targets:
     - `ProjectSettingsView`
     - merge-base selection flow in `ThreadDetailView`
     - option/state syncing in `usePromptModelReasoning`
     - dialog/reset flows where state can instead be keyed to the active entity
   - Prefer:
     - keyed component resets
     - deriving values during render
     - doing interaction-specific work in event handlers
     - explicit draft state models where local edits are intentional

4. Standardize shared interaction primitives
   - Extract duplicated hover-popover behavior into one shared hook or primitive and apply it to status/context indicators first.
   - Review other repeated UI behaviors that should use shared primitives instead of component-local bundles.
   - Align status presentation and detail surfaces with existing shared primitives from `@beanbag/ui-core` and app-level shared components.

5. Break up oversized components and hooks
   - Split large files with mixed responsibilities into smaller hooks/components with clearer ownership boundaries.
   - Highest-risk refactor candidates:
     - `ThreadDetailView.tsx`
     - `PromptBox.tsx`
     - `useGitDiffPanel.ts`
     - `usePromptModelReasoning.ts`
   - Suggested extraction boundaries:
     - data loading / mutation orchestration
     - scroll behavior
     - prompt composition and attachments
     - environment/model/reasoning option state
     - secondary panel and diff interactions

6. Add guardrails for hooks and effects
   - Keep `eslint-plugin-react-hooks` enforced and avoid local disables.
   - Add a lightweight review checklist for large React changes:
     - any state copied from props/query data?
     - any effect doing event-specific work?
     - any conditional early return introduced before all hooks?
     - any duplicated UI behavior that should become shared?
   - Where useful, add small tests around extracted hooks so regressions are caught earlier.

7. Stage the work in small commits
   - Commit by subsystem so regressions are isolated:
     - plan / documentation
     - shared interaction primitives
     - timeline scroll controller
     - effect cleanup by feature area
     - component decomposition

# Validation

- Run `pnpm --filter @beanbag/app lint` after each React/frontend change set.
- Run targeted frontend tests for touched areas, then broader app tests where warranted.
- For scroll changes, manually verify:
  - new messages while pinned to bottom
  - new messages while scrolled up
  - composer resize
  - secondary panel open/close
  - diff file navigation
  - tool-group expansion/collapse
- For effect cleanup, verify that refetches do not wipe in-progress user edits or optimistic selections.
- For shared UI primitives, verify matching hover/focus behavior across all migrated components.

# Open Questions/Risks

- Scroll behavior is sensitive to DOM timing, content virtualization-like optimizations, and ResizeObserver timing; changes need targeted regression coverage.
- Some state-sync effects may currently mask backend or query timing assumptions, so removing them may expose hidden data-flow issues that need explicit modeling.
- Breaking up large components can improve safety but may temporarily increase churn if extraction boundaries are chosen poorly.
- Shared interaction primitives should not accidentally regress keyboard accessibility while optimizing pointer behavior.
