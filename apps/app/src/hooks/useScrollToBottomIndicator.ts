import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  DEFAULT_SCROLL_STICK_THRESHOLD_PX,
} from "@beanbag/ui-core";

function shouldShowIndicator(el: HTMLDivElement): boolean {
  const maxScrollOffset = el.scrollHeight - el.clientHeight;
  if (maxScrollOffset <= DEFAULT_SCROLL_STICK_THRESHOLD_PX) {
    return false;
  }
  const distanceFromBottom = maxScrollOffset - el.scrollTop;
  return distanceFromBottom > DEFAULT_SCROLL_STICK_THRESHOLD_PX;
}

export function useScrollToBottomIndicator({
  containerRef,
  containerElement,
  onBaseScroll,
  onBaseScrollToBottom,
  resetDep,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  containerElement?: HTMLDivElement | null;
  onBaseScroll?: () => void;
  onBaseScrollToBottom?: () => void;
  resetDep?: unknown;
}) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const syncVisibility = useCallback(() => {
    const el = containerElement ?? containerRef.current;
    if (!el) return;
    setShowScrollToBottom(shouldShowIndicator(el));
  }, [containerElement, containerRef]);

  useEffect(() => {
    setShowScrollToBottom(false);
  }, [resetDep]);

  useEffect(() => {
    syncVisibility();
  }, [containerElement, syncVisibility]);

  const handleScroll = useCallback(() => {
    onBaseScroll?.();
    syncVisibility();
  }, [onBaseScroll, syncVisibility]);

  const scrollToBottom = useCallback(() => {
    if (onBaseScrollToBottom) {
      onBaseScrollToBottom();
    } else {
      const el = containerElement ?? containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      // Keep upstream auto-scroll "stick to bottom" state in sync even when a
      // programmatic scroll does not fire a scroll event (or does not change).
      onBaseScroll?.();
    }
    setShowScrollToBottom(false);
  }, [containerElement, containerRef, onBaseScroll, onBaseScrollToBottom]);

  useEffect(() => {
    const el = containerElement ?? containerRef.current;
    if (!el) return;

    let frameId: number | null = null;
    const scheduleSync = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncVisibility();
      });
    };

    const mutationObserver = new MutationObserver(() => {
      scheduleSync();
    });
    mutationObserver.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleSync();
      });
      resizeObserver.observe(el);
    }

    window.addEventListener("resize", scheduleSync);
    scheduleSync();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [containerElement, containerRef, syncVisibility]);

  return {
    showScrollToBottom,
    handleScroll,
    scrollToBottom,
  };
}
