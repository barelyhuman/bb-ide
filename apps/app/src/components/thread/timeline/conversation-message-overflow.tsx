import {
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

interface UseIsOverflowingArgs {
  elementRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  measurementKey: string;
}

interface ConversationMessageOverflowToggleLabels {
  collapsed: string;
  expanded: string;
}

interface ConversationMessageOverflowToggleProps {
  expanded: boolean;
  labels: ConversationMessageOverflowToggleLabels;
  onToggle: () => void;
}

interface ConversationMessageInlineOverflowToggleProps {
  buttonBackgroundClassName: string;
  fadeFromClassName: string;
  label: string;
  onToggle: () => void;
}

export function useIsOverflowing({
  elementRef,
  enabled,
  measurementKey,
}: UseIsOverflowingArgs): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  // useLayoutEffect (not useEffect) so the first measurement runs before
  // paint. Otherwise the first paint renders without the overflow toggle,
  // and the button appears on the next frame after the effect runs.
  useLayoutEffect(() => {
    if (!enabled) {
      setIsOverflowing(false);
      return;
    }

    const element = elementRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      setIsOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [elementRef, enabled, measurementKey]);

  return isOverflowing;
}

export function ConversationMessageOverflowToggle({
  expanded,
  labels,
  onToggle,
}: ConversationMessageOverflowToggleProps) {
  return (
    <div className="mt-1 flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        {expanded ? labels.expanded : labels.collapsed}
      </button>
    </div>
  );
}

export function ConversationMessageInlineOverflowToggle({
  buttonBackgroundClassName,
  fadeFromClassName,
  label,
  onToggle,
}: ConversationMessageInlineOverflowToggleProps) {
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[1lh] items-stretch justify-end">
      <span
        className={cn("w-12 bg-gradient-to-l to-transparent", fadeFromClassName)}
      />
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "pointer-events-auto cursor-pointer whitespace-nowrap pl-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
          buttonBackgroundClassName,
        )}
        aria-expanded={false}
      >
        {label}
      </button>
    </span>
  );
}
