import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useResizeObserver } from "usehooks-ts";
import {
  secondaryPanelWidthPercentAtom,
  threadSecondaryPanelResizingAtom,
} from "../threadSecondaryPanelAtoms";

const GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX = 760;

export function useResponsiveGitDiffPanelDisplay({
  isSecondaryPanelOpen,
}: {
  isSecondaryPanelOpen: boolean;
}) {
  const [gitDiffDisplayMode, setGitDiffDisplayMode] = useState<
    "unified" | "split"
  >("unified");
  const setIsResizing = useSetAtom(threadSecondaryPanelResizingAtom);
  const persistedWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  const setPersistedWidthPercent = useSetAtom(secondaryPanelWidthPercentAtom);
  const secondaryPanelRef = useRef<HTMLElement>(null!);
  const secondaryResizablePanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastSecondaryPanelSizeRef = useRef(persistedWidthPercent);
  const lastDiffViewWideEnoughRef = useRef<boolean | null>(null);
  const hasExplicitDisplayModeRef = useRef(false);

  const applyWidth = useCallback(
    (nextWidth: number | undefined) => {
      if (!isSecondaryPanelOpen || nextWidth === undefined) {
        return;
      }

      const isWideEnough = nextWidth >= GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX;
      const previousWideEnough = lastDiffViewWideEnoughRef.current;
      const crossedBreakpoint =
        previousWideEnough !== null && previousWideEnough !== isWideEnough;

      if (crossedBreakpoint && hasExplicitDisplayModeRef.current) {
        hasExplicitDisplayModeRef.current = false;
      }

      if (!hasExplicitDisplayModeRef.current || crossedBreakpoint) {
        const nextMode = isWideEnough ? "split" : "unified";
        setGitDiffDisplayMode((current) =>
          current === nextMode ? current : nextMode,
        );
      }

      lastDiffViewWideEnoughRef.current = isWideEnough;
    },
    [isSecondaryPanelOpen, setGitDiffDisplayMode],
  );

  const prevOpenRef = useRef(isSecondaryPanelOpen);
  useEffect(() => {
    // Skip initial mount — Panel's defaultSize handles it.
    if (prevOpenRef.current === isSecondaryPanelOpen) {
      return;
    }
    prevOpenRef.current = isSecondaryPanelOpen;

    const panel = secondaryResizablePanelRef.current;
    if (!panel) {
      return;
    }

    if (isSecondaryPanelOpen) {
      panel.expand(lastSecondaryPanelSizeRef.current);
      applyWidth(secondaryPanelRef.current?.getBoundingClientRect().width);
    } else {
      panel.collapse();
    }
  }, [isSecondaryPanelOpen, applyWidth]);

  useEffect(() => {
    if (!isSecondaryPanelOpen) {
      hasExplicitDisplayModeRef.current = false;
      lastDiffViewWideEnoughRef.current = null;
    }
  }, [isSecondaryPanelOpen]);

  useResizeObserver({
    ref: secondaryPanelRef,
    onResize: ({ width }) => {
      applyWidth(
        width ?? secondaryPanelRef.current?.getBoundingClientRect().width,
      );
    },
  });

  const handleGitDiffDisplayModeChange = useCallback(
    (nextMode: "unified" | "split") => {
      hasExplicitDisplayModeRef.current = true;
      setGitDiffDisplayMode(nextMode);
    },
    [setGitDiffDisplayMode],
  );

  const handleSecondaryPanelDragging = useCallback(
    (isDragging: boolean) => {
      setIsResizing(isDragging);
      if (isDragging) {
        hasExplicitDisplayModeRef.current = false;
        return;
      }
      // Drag finished — persist the user's chosen width.
      if (lastSecondaryPanelSizeRef.current > 0) {
        setPersistedWidthPercent(lastSecondaryPanelSizeRef.current);
      }
    },
    [setIsResizing, setPersistedWidthPercent],
  );

  const handleSecondaryPanelResize = useCallback((size: number) => {
    if (size <= 0) {
      return;
    }

    lastSecondaryPanelSizeRef.current = size;
  }, []);

  return {
    gitDiffDisplayMode,
    handleGitDiffDisplayModeChange,
    handleSecondaryPanelDragging,
    handleSecondaryPanelResize,
    persistedWidthPercent,
    secondaryPanelRef,
    secondaryResizablePanelRef,
  };
}
