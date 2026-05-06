import {
  useCallback,
  useEffect,
  useRef,
  type PointerEventHandler,
  type RefObject,
  type TouchEventHandler,
  type UIEventHandler,
  type WheelEventHandler,
} from "react";

export interface StickyBottomScrollBinding<TElement extends HTMLElement> {
  onPointerDown: PointerEventHandler<TElement>;
  onScroll: UIEventHandler<TElement>;
  onTouchMove: TouchEventHandler<TElement>;
  onTouchStart: TouchEventHandler<TElement>;
  onWheel: WheelEventHandler<TElement>;
  ref: RefObject<TElement | null>;
}

export interface UseStickyBottomScrollArgs {
  contentKey: string;
}

const STICKY_BOTTOM_THRESHOLD_PX = 4;
const USER_SCROLL_INTENT_MS = 350;
// Updates that arrive within this window of the previous scroll snap to the
// bottom instantly. Animating each one would start a fresh smooth scroll from a
// stale position before the prior one settled, producing a trailing lag. Slow
// streams (one event per second-ish) clear the gate and animate naturally.
const SMOOTH_SCROLL_MIN_GAP_MS = 250;

function getMaxScrollOffset(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function isNearBottom(element: HTMLElement): boolean {
  return (
    getMaxScrollOffset(element) - element.scrollTop <=
    STICKY_BOTTOM_THRESHOLD_PX
  );
}

function scrollToBottom(element: HTMLElement, smooth: boolean): void {
  const top = getMaxScrollOffset(element);
  if (smooth) {
    element.scrollTo({ top, behavior: "smooth" });
  } else {
    element.scrollTop = top;
  }
}

export function useStickyBottomScroll<TElement extends HTMLElement>({
  contentKey,
}: UseStickyBottomScrollArgs): StickyBottomScrollBinding<TElement> {
  const scrollRef = useRef<TElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pointerScrollIntentRef = useRef(false);
  const userScrollIntentUntilRef = useRef(0);
  const lastScrollAtRef = useRef(0);
  const isFirstScrollRef = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) {
      return;
    }
    const now = window.performance.now();
    const smooth =
      !isFirstScrollRef.current &&
      now - lastScrollAtRef.current >= SMOOTH_SCROLL_MIN_GAP_MS;
    scrollToBottom(element, smooth);
    lastScrollAtRef.current = now;
    isFirstScrollRef.current = false;
  }, [contentKey]);

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current =
      window.performance.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const onPointerDown = useCallback<PointerEventHandler<TElement>>(() => {
    pointerScrollIntentRef.current = true;
  }, []);

  const onPointerEnd = useCallback(() => {
    pointerScrollIntentRef.current = false;
  }, []);

  const onScroll = useCallback<UIEventHandler<TElement>>((event) => {
    if (isNearBottom(event.currentTarget)) {
      shouldStickToBottomRef.current = true;
      return;
    }

    const hasUserScrollIntent =
      pointerScrollIntentRef.current ||
      window.performance.now() <= userScrollIntentUntilRef.current;
    if (hasUserScrollIntent) {
      shouldStickToBottomRef.current = false;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [onPointerEnd]);

  return {
    onPointerDown,
    onScroll,
    onTouchMove: markUserScrollIntent,
    onTouchStart: markUserScrollIntent,
    onWheel: markUserScrollIntent,
    ref: scrollRef,
  };
}
