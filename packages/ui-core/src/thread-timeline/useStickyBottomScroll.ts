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

function getMaxScrollOffset(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function isNearBottom(element: HTMLElement): boolean {
  return (
    getMaxScrollOffset(element) - element.scrollTop <=
    STICKY_BOTTOM_THRESHOLD_PX
  );
}

function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = getMaxScrollOffset(element);
}

export function useStickyBottomScroll<TElement extends HTMLElement>({
  contentKey,
}: UseStickyBottomScrollArgs): StickyBottomScrollBinding<TElement> {
  const scrollRef = useRef<TElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pointerScrollIntentRef = useRef(false);
  const userScrollIntentUntilRef = useRef(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) {
      return;
    }
    scrollToBottom(element);
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
