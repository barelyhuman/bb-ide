import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  calculateContextWindowUsagePercent,
  formatCompactTokenCount,
  type ThreadContextWindowUsage,
} from "@/lib/thread-context-window-usage";
import { cn } from "@/lib/utils";

interface ThreadContextWindowIndicatorProps {
  usage: ThreadContextWindowUsage;
  className?: string;
}

const POPOVER_CLOSE_DELAY_MS = 160;

export function ThreadContextWindowIndicator({
  usage,
  className,
}: ThreadContextWindowIndicatorProps) {
  const [open, setOpen] = useState(false);
  const [isPointerOverTrigger, setIsPointerOverTrigger] = useState(false);
  const [isPointerOverContent, setIsPointerOverContent] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current === null) return;
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  }, []);

  const isInteractive = useMemo(
    () => isPointerOverTrigger || isPointerOverContent,
    [isPointerOverContent, isPointerOverTrigger],
  );

  useEffect(() => {
    clearCloseTimeout();

    if (isInteractive) {
      setOpen(true);
      return;
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, POPOVER_CLOSE_DELAY_MS);

    return clearCloseTimeout;
  }, [clearCloseTimeout, isInteractive]);

  useEffect(() => {
    return clearCloseTimeout;
  }, [clearCloseTimeout]);

  const usedPercent = calculateContextWindowUsagePercent(usage);
  const leftPercent = Math.max(0, 100 - usedPercent);
  const visualPercent = Math.min(Math.max(usedPercent, 0), 100);

  const toneClass = usedPercent >= 90
    ? "text-destructive/75"
    : usedPercent >= 75
      ? "text-amber-500/75"
      : "text-muted-foreground/60";

  const usedTokensLabel = formatCompactTokenCount(usage.totalTokens);
  const windowTokensLabel = formatCompactTokenCount(usage.modelContextWindow);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
          return;
        }

        setIsPointerOverTrigger(false);
        setIsPointerOverContent(false);
        setOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerEnter={() => {
            setIsPointerOverTrigger(true);
          }}
          onPointerLeave={() => {
            setIsPointerOverTrigger(false);
          }}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={`Context window ${usedPercent}% used`}
          title="Context window usage"
        >
          <span
            className={cn(
              "relative block size-4 rounded-full border border-border/80",
              toneClass,
            )}
            aria-hidden="true"
          >
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(currentColor ${visualPercent}%, transparent 0%)`,
              }}
            />
            <span className="absolute inset-[3px] rounded-full bg-background" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        onPointerEnter={() => {
          setIsPointerOverContent(true);
        }}
        onPointerLeave={() => {
          setIsPointerOverContent(false);
        }}
        className="w-auto max-w-[240px] border-border/80 bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm"
      >
        <div className="space-y-1.5">
          <p className="text-muted-foreground">Context window:</p>
          <p className="font-medium">{usedPercent}% used ({leftPercent}% left)</p>
          <p className="font-medium">{usedTokensLabel} / {windowTokensLabel} tokens used</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
