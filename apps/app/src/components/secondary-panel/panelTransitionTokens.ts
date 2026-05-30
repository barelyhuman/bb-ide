/**
 * Shared collapse/expand easing for the thread-detail panels that animate
 * between sizes (the secondary panel, the terminal panel, and the collapsible
 * conversation/timeline panel). Kept in one place so the duration and easing
 * stay in lockstep across all of them.
 */
export const PANEL_COLLAPSE_TRANSITION_CLASS =
  "duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]";

/**
 * Hit-area margins for the thread-detail `PanelResizeHandle`s.
 *
 * The handles render a 1px hairline and widen their *grab + cursor* region with
 * a `before:` pseudo-element that overhangs the hairline by `1.5` (6px) on each
 * side. react-resizable-panels does its own window-level hit detection against
 * the handle's bounding box (the 1px hairline) expanded by these margins — it
 * ignores the pseudo-element. Its default `fine` margin is only 5px, so the
 * outer ~1px of the pseudo-element showed the resize cursor while sitting
 * outside the library's hit area: the cursor promised a resize the drag never
 * delivered.
 *
 * The `fine` margin must therefore be at least as large as the 6px overhang.
 * We make it strictly larger (8px) rather than an exact 6px match so the
 * draggable region fully *envelops* the cursor region even at fractional pixel
 * boundaries (sub-pixel flex layout positions, HiDPI rounding) — an exact match
 * can still leave a ~1px sliver where the cursor shows but the drag has not yet
 * engaged. The library treats an edge-adjacent panel as non-overlapping
 * (strict intersection), so the wider margin genuinely extends the live drag
 * zone instead of being vetoed by the neighbouring panel. `coarse` (touch)
 * already exceeds the overhang, so it stays at the library default.
 */
export const PANEL_RESIZE_HIT_AREA_MARGINS = { coarse: 15, fine: 8 };
