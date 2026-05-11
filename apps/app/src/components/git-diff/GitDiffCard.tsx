import { type CSSProperties, memo, useMemo } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { FileDiff as DiffView } from "@pierre/diffs/react";
import { useIntersectionObserver } from "usehooks-ts";
import {
  CopyButton,
  DiffStatsTally,
  FilePathLink,
  Skeleton,
  TruncateStart,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  formatGitDiffFileLabel,
  getOpenableGitDiffPath,
  summarizeGitDiffFile,
  type ParsedGitDiffFile,
} from "./git-diff-parsing";

export const GIT_DIFF_VIEW_BASE_OPTIONS = {
  overflow: "scroll",
  disableFileHeader: false,
} as const;

const GIT_DIFF_CARD_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

const GIT_DIFF_CARD_BODY_STYLE: CSSProperties = {
  contain: "layout paint style",
  contentVisibility: "auto",
  containIntrinsicSize: "0 600px",
};

export interface GitDiffCardProps {
  fileDiff: ParsedGitDiffFile;
  diffViewOptions: Record<string, string | boolean>;
  onOpenFileInEditor?: (path: string) => void;
  /**
   * When both isCollapsed and onToggleCollapsed are provided, the card renders
   * a chevron in the header and hides its body when collapsed. Omit both to
   * render a card with no collapse affordance (timeline rows do this — they
   * collapse at the row level).
   */
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * When true, the header sticks to the scroll container and grows a top
   * border when stuck. Used by the secondary panel; timeline rows leave this
   * off because their scroll container is per-row, not per-panel.
   */
  stickyHeader?: boolean;
  /** When true, replaces the body with a skeleton (for queued render slots). */
  isRendering?: boolean;
  /** Forwarded to the outer card element — used for IntersectionObserver-based scheduling. */
  cardRef?: (element: HTMLDivElement | null) => void;
}

export const GitDiffCard = memo(function GitDiffCard({
  fileDiff,
  diffViewOptions,
  onOpenFileInEditor,
  isCollapsed,
  onToggleCollapsed,
  stickyHeader = false,
  isRendering = false,
  cardRef,
}: GitDiffCardProps) {
  const fileDiffStats = useMemo(
    () => summarizeGitDiffFile(fileDiff),
    [fileDiff],
  );
  const fileDiffLabel = useMemo(
    () => formatGitDiffFileLabel(fileDiff),
    [fileDiff],
  );
  const renameInfo = useMemo(() => {
    if (fileDiff.prevName && fileDiff.prevName !== fileDiff.name) {
      return { from: fileDiff.prevName, to: fileDiff.name };
    }
    return null;
  }, [fileDiff]);
  const openablePath = useMemo(
    () => getOpenableGitDiffPath(fileDiff),
    [fileDiff],
  );
  const canOpenFile = Boolean(openablePath);
  const supportsCollapse =
    isCollapsed !== undefined && onToggleCollapsed !== undefined;
  const isBodyHidden = supportsCollapse && isCollapsed;
  const fileDiffOptions = useMemo(
    () => ({ ...diffViewOptions, disableFileHeader: true }),
    [diffViewOptions],
  );
  const { ref: stickySentinelRef, isIntersecting } = useIntersectionObserver({
    initialIsIntersecting: true,
    threshold: 1,
  });
  const isHeaderStuck = stickyHeader && !isIntersecting;

  return (
    <div
      ref={cardRef}
      className="rounded-lg border border-border/70 bg-background shadow-sm"
    >
      {stickyHeader ? (
        <div ref={stickySentinelRef} className="h-0" />
      ) : null}
      <div
        className={cn(
          "rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-foreground",
          stickyHeader && "sticky top-0 z-30",
          !isBodyHidden && "rounded-b-none",
          // When stuck, the card's own rounded top border scrolls out of view;
          // add a matching top border on the sticky so it still reads as the
          // top edge of the card instead of a flat-cut slab.
          isHeaderStuck && "rounded-t-none border-t border-border/70",
        )}
      >
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {supportsCollapse ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                onClick={onToggleCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${fileDiffLabel}`}
                aria-expanded={!isCollapsed}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-150",
                    !isCollapsed && "rotate-90",
                  )}
                />
              </button>
            ) : null}
            {renameInfo ? (
              <TruncateStart
                className="min-w-0 text-xs leading-5 text-muted-foreground/80"
                title={renameInfo.from}
              >
                {renameInfo.from}
              </TruncateStart>
            ) : null}
            {renameInfo ? (
              <ArrowRight
                aria-hidden="true"
                className="size-3 shrink-0 text-muted-foreground/60"
              />
            ) : null}
            <FilePathLink
              path={openablePath ?? fileDiff.name}
              displayName={renameInfo ? renameInfo.to : fileDiffLabel}
              onClick={
                canOpenFile && openablePath && onOpenFileInEditor
                  ? () => onOpenFileInEditor(openablePath)
                  : undefined
              }
              className="font-medium text-foreground"
            />
            {openablePath ? (
              <CopyButton
                text={openablePath}
                label={`Copy path for ${fileDiffLabel}`}
                className="rounded-md hover:bg-accent/70"
              />
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <DiffStatsTally
              insertions={fileDiffStats.insertions}
              deletions={fileDiffStats.deletions}
              className="text-xs"
            />
          </span>
        </div>
      </div>
      {!isBodyHidden ? (
        <div
          className="overflow-hidden rounded-b-lg bg-background"
          style={GIT_DIFF_CARD_BODY_STYLE}
        >
          {isRendering ? (
            <div className="space-y-1.5 px-3 py-3">
              <Skeleton className="h-3 w-full rounded-sm" />
              <Skeleton className="h-3 w-[96%] rounded-sm" />
              <Skeleton className="h-3 w-[93%] rounded-sm" />
              <Skeleton className="h-3 w-[90%] rounded-sm" />
              <Skeleton className="h-3 w-[87%] rounded-sm" />
              <Skeleton className="h-3 w-[84%] rounded-sm" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="w-full max-w-full" style={GIT_DIFF_CARD_VIEW_STYLE}>
                <DiffView fileDiff={fileDiff} options={fileDiffOptions} />
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});
