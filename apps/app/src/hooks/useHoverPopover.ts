import { useCallback, useEffect, useRef, useState } from "react";

interface HoverPopoverHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface UseHoverPopoverOptions {
  closeDelayMs?: number;
}

interface UseHoverPopoverResult {
  open: boolean;
  triggerHoverProps: HoverPopoverHandlers;
  contentHoverProps: HoverPopoverHandlers;
  handleOpenChange: (nextOpen: boolean) => void;
}

const DEFAULT_CLOSE_DELAY_MS = 160;

export function useHoverPopover({
  closeDelayMs = DEFAULT_CLOSE_DELAY_MS,
}: UseHoverPopoverOptions = {}): UseHoverPopoverResult {
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

  useEffect(() => {
    clearCloseTimeout();

    if (isPointerOverTrigger || isPointerOverContent) {
      setOpen(true);
      return;
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, closeDelayMs);

    return clearCloseTimeout;
  }, [clearCloseTimeout, closeDelayMs, isPointerOverContent, isPointerOverTrigger]);

  useEffect(() => clearCloseTimeout, [clearCloseTimeout]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      clearCloseTimeout();
      setOpen(true);
      return;
    }

    setIsPointerOverTrigger(false);
    setIsPointerOverContent(false);
    clearCloseTimeout();
    setOpen(false);
  }, [clearCloseTimeout]);

  const triggerHoverProps = {
    onPointerEnter: () => {
      setIsPointerOverTrigger(true);
    },
    onPointerLeave: () => {
      setIsPointerOverTrigger(false);
    },
  };

  const contentHoverProps = {
    onPointerEnter: () => {
      setIsPointerOverContent(true);
    },
    onPointerLeave: () => {
      setIsPointerOverContent(false);
    },
  };

  return {
    open,
    triggerHoverProps,
    contentHoverProps,
    handleOpenChange,
  };
}
