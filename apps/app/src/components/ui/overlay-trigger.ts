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
