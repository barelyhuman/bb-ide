import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared animation tokens for height transitions across the timeline.
// Exported so adjacent surfaces (future affordances) can match the easing
// without duplicating the curve.
export const HEIGHT_TRANSITION_DURATION_MS = 180;
// Cubic-bezier ease-out-expo: fast initial expansion, gentle settle.
export const HEIGHT_TRANSITION_EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

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
    const syncHeight = () => {
      const target = wrapperRef.current;
      const source = innerRef.current;
      if (!target || !source) return;
      target.style.height = visible ? `${source.offsetHeight}px` : "0px";
    };
    syncHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncHeight);
    observer.observe(inner);
    return () => observer.disconnect();
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
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height;
      if (next === undefined || !wrapperRef.current) return;
      wrapperRef.current.style.height = `${next}px`;
    });
    observer.observe(inner);
    return () => observer.disconnect();
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
