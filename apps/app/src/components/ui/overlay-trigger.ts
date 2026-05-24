import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";

const OVERLAY_TRIGGER_CLASS_NAME = "select-none";

type OverlayTriggerClassNameResolver = (className?: string) => string;

export const getOverlayTriggerClassName: OverlayTriggerClassNameResolver = (
  className,
) => cn(OVERLAY_TRIGGER_CLASS_NAME, className);

/**
 * Blocks the browser from starting a text-selection drag when the user clicks
 * an overlay trigger. Without this, the pointer-down that opens the menu
 * begins a selection range; the pointer-up that later closes the menu (by
 * clicking outside) ends that range across whatever text now sits between
 * the two points — usually an unrelated chip or label.
 *
 * Bound to `mousedown`, not `pointerdown`, because Radix opens overlays from
 * pointerdown — preventing the default there would suppress the open.
 * mousedown fires after pointerdown, so the menu opens and only the browser's
 * selection-start is suppressed.
 */
export function preventOverlayTriggerSelection(event: MouseEvent): void {
  event.preventDefault();
}

// ---------------------------------------------------------------------------
// Input-modality tracker — mirrors the pattern Radix's `Menu` uses internally
// (isUsingKeyboardRef). Flips to "keyboard" on the next keydown, then back to
// "pointer" on the next pointer event. Capture-phase listeners so we observe
// the user's input before any component handlers consume the event.
//
// Used by DropdownMenuContent's onCloseAutoFocus to decide whether to restore
// focus to the trigger. Radix's DropdownMenu trigger preventDefaults pointer-
// down (so the trigger never gets mouse-set focus), and Radix then programm-
// atically `.focus()`es the trigger on close — which the browser interprets
// as keyboard-modality focus and paints :focus-visible. After a mouse-driven
// close that's a stray ring; suppressing the auto-focus there leaves focus
// where the user's click landed and avoids the visual jitter. Keyboard close
// (Escape, item-Enter) still restores focus to the trigger as expected.
// ---------------------------------------------------------------------------

let lastInputModality: "pointer" | "keyboard" = "pointer";

if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      lastInputModality = "keyboard";
    },
    { capture: true },
  );
  document.addEventListener(
    "pointerdown",
    () => {
      lastInputModality = "pointer";
    },
    { capture: true },
  );
}

export function isLastInputKeyboard(): boolean {
  return lastInputModality === "keyboard";
}
