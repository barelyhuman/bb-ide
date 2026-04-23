# Touch vs Viewport Sizing

## Problem

The app currently bumps font sizes and tap-target dimensions up at `max-width: 767px` to make dense UI legible and finger-friendly on phones. But Tailwind width breakpoints fire the same way regardless of input device, so **tiled desktop windows narrower than 768px get the full mobile bump** — fonts and buttons grow to phone size even though the user has a precise mouse cursor.

The axis the bumps actually care about is **input device (touch vs mouse)**, not window width. Today we conflate the two.

## Current state

### Global font bump
`apps/app/src/app.css:87-96` overrides the `--text-xs`, `--text-sm`, `--text-base` theme tokens inside `@media (max-width: 767px)`. Because these are token overrides, *every* `text-xs`/`text-sm`/`text-base` class in the app scales up when the viewport is narrow, including tiled desktop windows.

The inline comment at `app.css:72-76` intentionally couples this to Tailwind's `md:` breakpoint so layout and typography bump together ("avoids an intermediate state where icons have grown but text hasn't").

### `useIsMobile` hook
`apps/app/src/hooks/useMobile.ts` exposes `MOBILE_QUERY = "(max-width: 767px)"` via `useSyncExternalStore`. Used for:
- **Layout decisions** (legitimately width-based): `components/ui/responsive-overlay.tsx`, `components/ui/sidebar.tsx`, `views/ThreadDetailHeader.tsx`, `views/ThreadDetailSecondaryContent.tsx`, `components/promptbox/PromptProviderModelPicker.tsx:166`.
- **Pointer-capability decisions** (should be pointer-based): `hooks/useHoverPopover.ts` — decides hover-vs-click interaction. Touch devices have no hover at all; this has nothing to do with width.

## Approach

Swap the trigger from "narrow viewport" to "narrow viewport AND touch input" everywhere the motivation is touch ergonomics. Leave width-only triggers in place where the motivation is layout fit.

### CSS change

`apps/app/src/app.css:87`:
```css
@media (max-width: 767px) and (pointer: coarse) {
```

Keeps the author's original width+layout coupling intact; only adds the touch requirement. Real phones still match. Tiled desktop windows do not.

### Decision point: component-level swap strategy

The 18 touch-ergonomic component locations currently use plain `md:` variants like `md:h-9 md:text-sm`. Two translation options:

**Option A — mirror the CSS (narrow AND touch):**
```
h-10 md:h-9  →  h-9 max-md:pointer-coarse:h-10
```
Direct translation of the CSS change. Preserves "font + layout breakpoints stay in sync" intent. iPad with external display behaves like desktop.

**Option B — pure pointer (decouple from width):**
```
h-10 md:h-9  →  h-9 pointer-coarse:h-10
```
Cleaner mental model: "touch always gets the bigger target." iPad with external display still gets touch ergonomics. Bigger behavioral shift.

**Not yet decided.** Default to A for consistency with the CSS change.

## Touch-ergonomic locations to sweep (18)

Each location currently applies `md:`-gated size reductions whose motivation is "desktop can be denser." They should swap to the chosen Option A/B pattern.

### Form controls
- `apps/app/src/components/ui/input.tsx:11` — `md:h-9 md:text-sm`
- `apps/app/src/components/promptbox/PromptBox.tsx:746` — `md:text-sm` (textarea)
- `apps/app/src/components/promptbox/PromptBox.tsx:806,826,838,854,864,877,888,900` — `md:h-8 md:px-2` / `md:h-8 md:w-8` (footer buttons)
- `apps/app/src/components/promptbox/PromptProviderModelPicker.tsx:187,196` — `md:h-7 md:w-6`, `md:text-xs`
- `apps/app/src/components/ui/split-button.tsx:15` — `md:h-8`

### Icon buttons / tap targets (`md:h-8 md:w-8 md:[&_svg]:size-4` pattern)
- `apps/app/src/components/layout/AppPageHeader.tsx:11`
- `apps/app/src/components/layout/AppSidebar.tsx:61,75`
- `apps/app/src/components/ui/sidebar.tsx:298`
- `apps/app/src/views/ThreadDetailHeader.tsx:17`
- `apps/app/src/components/ui/dropdown-menu.tsx:281,283,305,307`
- `apps/app/src/components/layout/ProjectList.tsx:203,205`
- `apps/app/src/components/promptbox/EnvironmentPicker.tsx:194,208,384,389`
- Icon sizes in: `PromptOptionPicker.tsx:166`, `HostPicker.tsx:79`, `PromptProviderModelPicker.tsx:194`, `ProjectActionsMenu.tsx:52`, `ThreadActionsMenu.tsx:67`, `MergeBaseBranchPicker.tsx:165-166`, `ThreadDetailSecondaryContent.tsx:187-188`, `AppSettingsView.tsx:235-246`, `ThreadSecondaryPanel.tsx:185`

### Row layouts (list-item tap zones)
- `apps/app/src/components/layout/project-list/ThreadRow.tsx:76,78,113,174,211,214,223,254`
- `apps/app/src/components/layout/project-list/ProjectRow.tsx:106,130,158,165`

## Width-driven locations to leave alone (9)

Layout reflow that legitimately depends on available space, not input device:
- `components/ui/sidebar.tsx:239,260,329,491,637` (drawer-vs-fixed)
- `components/ui/dialog.tsx:195,221` (modal reflow)
- `components/settings/SettingsWithControl.tsx:16,26` (form stacking)
- `components/layout/AppLayout.tsx:421` (content padding)
- `components/layout/PageShell.tsx:18` (shell margins)
- `views/ThreadDetailSecondaryContent.tsx:502` (panel margins)
- `views/ThreadFollowUpComposer.tsx:502` (composer element visibility)
- `components/layout/AppSidebar.tsx:88` (sidebar resize handle)

## Bonus: `useHoverPopover`

`apps/app/src/hooks/useHoverPopover.ts:27` uses `useIsMobile()` to disable hover interactions. The correct signal is `(pointer: coarse)`, not viewport width. Swap to `window.matchMedia('(pointer: coarse)')` (mirror the `useIsMobile` shared-listener pattern in a new `usePointerCoarse` hook, or inline).

This is independent of the sizing work but belongs in the same conceptual change.

## Non-goals

- **`clamp()` fluid typography.** Considered; rejected for this pass. It solves "smooth scaling with width" but doesn't address the touch-vs-mouse axis — a real phone at 375px would get the *min* clamp value, losing the legibility bump we want. Revisit later if we want breakpoint-free typography in general.
- **Changing layout breakpoints.** The 9 width-driven locations stay width-based.
- **Touching `useIsMobile` consumers that drive layout.** Sidebar drawer swap, overlay type swap, etc. remain width-based.

## Exit criteria

- `apps/app/src/app.css:87` media query includes `and (pointer: coarse)`.
- All 18 touch-ergonomic component locations use the chosen Option A or Option B pattern consistently; no touch-motivated `md:` sizing remains.
- `useHoverPopover` keys off pointer capability, not viewport width.
- No regression in tap target size on real phones (visual check on iOS Safari + Android Chrome).
- No regression in text legibility on real phones.
- Tiled desktop window at ~600px wide shows desktop-sized text and buttons (the originating complaint).

## Validation

1. **Resize sweep (desktop)**: open the app in dev, resize the window smoothly from 1400px → 400px. Fonts and tap targets must not grow. Sidebar should still collapse to drawer at 767px (layout concern — unchanged).
2. **Real phone**: load dev URL on an iPhone and an Android device. Fonts and tap targets must match current mobile sizing.
3. **iPad + Magic Keyboard**: fonts and targets should still show the mobile bump (iPad reports `pointer: coarse` regardless of keyboard attachment). Verify on a physical device or BrowserStack.
4. **Desktop with touchscreen (edge case)**: a Windows laptop with touchscreen and mouse attached reports `pointer: fine` — will get desktop sizing. Accept; document.
5. **`useHoverPopover`**: verify hover-to-open still works on desktop; verify tap-to-open works on a real phone.

## Open questions

- **Option A vs Option B.** Decide before sweeping the 18 component locations.
- **Should we introduce a `pointer-coarse:` / `pointer-fine:` Tailwind alias** to make the 18 swaps more readable? Tailwind v4 ships these built-in, no plugin needed — just confirming we use the canonical names.
- **Is there a case for a shared `TouchEnlarged` utility class** (combining the common `h-10 max-md:pointer-coarse:h-12` pattern into one class) to keep consistency across the 18 sites? Probably yes if Option A, since the pattern is verbose.
