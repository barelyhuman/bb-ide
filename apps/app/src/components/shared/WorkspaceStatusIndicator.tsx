import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ThreadWorkStatus } from "@beanbag/agent-core";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  threadWorkStatusDescription,
} from "@/lib/thread-work-status";
import { cn } from "@/lib/utils";
import { StatusPill, type StatusPillVariant } from "@beanbag/ui-core";

const POPOVER_CLOSE_DELAY_MS = 160;

interface WorkspaceStatusIndicatorProps {
  status: ThreadWorkStatus | undefined;
  label: string;
  variant: StatusPillVariant;
  className?: string;
}

export function WorkspaceStatusIndicator({
  status,
  label,
  variant,
  className,
}: WorkspaceStatusIndicatorProps) {
  const [open, setOpen] = useState(false);
  const [isPointerOverTrigger, setIsPointerOverTrigger] = useState(false);
  const [isPointerOverContent, setIsPointerOverContent] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current === null) {
      return;
    }
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

  useEffect(() => clearCloseTimeout, [clearCloseTimeout]);

  const description = threadWorkStatusDescription(status);

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
            "flex w-fit items-center rounded-sm p-0 leading-none text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={`${label}: ${description}`}
        >
          <StatusPill variant={variant}>{label}</StatusPill>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onPointerEnter={() => {
          setIsPointerOverContent(true);
        }}
        onPointerLeave={() => {
          setIsPointerOverContent(false);
        }}
        className="w-auto max-w-[240px] border-border/80 bg-popover/95 px-3 py-2 text-sm shadow-lg backdrop-blur-sm"
      >
        <p className="text-muted-foreground">{description}</p>
      </PopoverContent>
    </Popover>
  );
}
