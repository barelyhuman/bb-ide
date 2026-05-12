import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared animation tokens for height transitions across the timeline.
// Exported so adjacent surfaces (future affordances) can match the easing
// without duplicating the curve.
export const HEIGHT_TRANSITION_DURATION_MS = 180;
// Cubic-bezier ease-out-expo: fast initial expansion, gentle settle.
export const HEIGHT_TRANSITION_EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

// While content is reflowing (window/panel resize, sidebar collapse, font
// load), the wrapper's height changes every frame. Letting the CSS height
// transition fire in that case queues a fresh 180ms interpolation each frame
// and the continuously-animating wrapper invalidates layout for the whole
// subtree underneath — the source of the resize lag. Snap-mode disables the
// transition for the duration of the resize burst, identified by the inner
// element's width changing, and re-enables it one quiet rAF after the last
// width change so streaming-driven height changes (stable width) still
// animate.
interface SnapState {
  savedDuration: string | null;
  restoreFrame: number | null;
}

function enterSnapMode(target: HTMLElement, state: SnapState): void {
  if (state.savedDuration === null) {
    state.savedDuration = target.style.transitionDuration;
  }
  // Re-apply on every fire: a parent React render mid-resize would re-write
  // the `transition` shorthand and reset the duration longhand.
  target.style.transitionDuration = "0s";
}

function scheduleRestore(target: HTMLElement, state: SnapState): void {
  if (state.restoreFrame !== null) {
    cancelAnimationFrame(state.restoreFrame);
  }
  state.restoreFrame = requestAnimationFrame(() => {
    state.restoreFrame = null;
    if (state.savedDuration === null) return;
    target.style.transitionDuration = state.savedDuration;
    state.savedDuration = null;
  });
}

function applyHeight(
  target: HTMLElement,
  nextHeight: string,
  widthChanged: boolean,
  state: SnapState,
): void {
  if (widthChanged) {
    enterSnapMode(target, state);
    scheduleRestore(target, state);
  }
  target.style.height = nextHeight;
}

function cleanupSnapState(target: HTMLElement | null, state: SnapState): void {
  if (state.restoreFrame !== null) {
    cancelAnimationFrame(state.restoreFrame);
    state.restoreFrame = null;
  }
  // Restore eagerly so a re-running effect (HeightTransition's `visible`
  // toggle) doesn't inherit `transitionDuration: 0s` and skip its animation.
  if (state.savedDuration !== null && target) {
    target.style.transitionDuration = state.savedDuration;
    state.savedDuration = null;
  }
}

export interface HeightTransitionProps {
  visible: boolean;
  children: ReactNode;
  durationMs?: number;
  className?: string;
}

/**
 * Animates between collapsed (0 height + 0 opacity) and intrinsic height as
 * `visible` toggles. A `ResizeObserver` tracks the inner content's natural
 * height; the wrapper's inline pixel `height` is set to either that value
 * or `0` based on `visible`, and CSS `transition: height, opacity` smooths
 * the change. Native browser interpolation — no transforms, no spring
 * physics. Children stay mounted across the transition so consumer state
 * (e.g. an expandable panel's open flag) survives a hide/show cycle.
 */
export function HeightTransition({
  visible,
  children,
  durationMs = HEIGHT_TRANSITION_DURATION_MS,
  className,
}: HeightTransitionProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner) return;
    wrapper.style.height = visible ? `${inner.offsetHeight}px` : "0px";
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth: number | null = null;
    const snapState: SnapState = { savedDuration: null, restoreFrame: null };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const target = wrapperRef.current;
      if (!entry || !target) return;
      const { width, height } = entry.contentRect;
      const widthChanged = lastWidth !== null && width !== lastWidth;
      lastWidth = width;
      const nextHeight = visible ? `${height}px` : "0px";
      applyHeight(target, nextHeight, widthChanged, snapState);
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      cleanupSnapState(wrapperRef.current, snapState);
    };
  }, [visible]);
  return (
    <div
      ref={wrapperRef}
      className={cn("overflow-hidden", className)}
      style={{
        opacity: visible ? 1 : 0,
        transition: `height ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}, opacity ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}`,
      }}
    >
      {/*
        `display: flow-root` gives the inner element a BFC so child margins
        (e.g. the working indicator's `mt-4`) are contained inside its box.
        Without this, those margins margin-collapse outward to the wrapper
        and `inner.offsetHeight` returns less than the visually-needed
        height — the wrapper would clip the indicator's top.
      */}
      <div ref={innerRef} style={{ display: "flow-root" }}>
        {children}
      </div>
    </div>
  );
}

export interface AutoHeightContainerProps {
  children: ReactNode;
  className?: string;
  durationMs?: number;
}

/**
 * Smoothly animates a wrapper's height to match its inner content's natural
 * height via a `ResizeObserver` + CSS `transition: height`. Native browser
 * height interpolation — no transforms, no spring physics, no text warping.
 *
 * The first sync (`auto` → `Npx`) snaps because CSS can't interpolate from
 * `auto`; subsequent `Npx` → `Mpx` changes ease through the transition. Use
 * for surfaces where content size grows over time (a row list receiving new
 * rows) and you want the boundary to glide instead of snap.
 */
export function AutoHeightContainer({
  children,
  className,
  durationMs = HEIGHT_TRANSITION_DURATION_MS,
}: AutoHeightContainerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner || typeof ResizeObserver === "undefined") return;
    wrapper.style.height = `${inner.offsetHeight}px`;
    let lastWidth: number | null = null;
    const snapState: SnapState = { savedDuration: null, restoreFrame: null };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const target = wrapperRef.current;
      if (!entry || !target) return;
      const { width, height } = entry.contentRect;
      const widthChanged = lastWidth !== null && width !== lastWidth;
      lastWidth = width;
      applyHeight(target, `${height}px`, widthChanged, snapState);
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      cleanupSnapState(wrapperRef.current, snapState);
    };
  }, []);
  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        overflow: "hidden",
        transition: `height ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}`,
      }}
    >
      <div ref={innerRef} style={{ display: "flow-root" }}>
        {children}
      </div>
    </div>
  );
}
