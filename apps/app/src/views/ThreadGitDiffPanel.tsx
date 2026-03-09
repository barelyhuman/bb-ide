import { type CSSProperties, type Ref } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Columns2,
  GripVertical,
  Loader2,
  Rows2,
} from "lucide-react";
import { FileDiff } from "@pierre/diffs/react";
import { Panel, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openThreadPathInEditor } from "@/lib/api";
import { getPathCommandForTarget } from "@/lib/open-path-preferences";
import { cn } from "@/lib/utils";
import {
  formatGitDiffFileLabel,
  getOpenableGitDiffPath,
  summarizeGitDiffFile,
  type ParsedGitDiffFile,
} from "./threadDetailGitDiff";

const GIT_DIFF_PANEL_MIN_SIZE_PERCENT = 24;
const GIT_DIFF_PANEL_MAX_SIZE_PERCENT = 70;
const GIT_DIFF_PANEL_DEFAULT_SIZE_PERCENT = 50;
const GIT_DIFF_PANEL_SKELETON_FILE_COUNT = 3;
const GIT_DIFF_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

export interface GitDiffSelectionOption {
  value: string;
  label: string;
}

interface ParsedGitDiffFileEntry {
  key: string;
  fileDiff: ParsedGitDiffFile;
}

interface ThreadGitDiffSelection {
  type: string;
  sha?: string;
}

interface ThreadGitDiffCommit {
  sha: string;
  shortSha: string;
  subject: string;
}

interface ThreadGitDiffData {
  mode: string;
  selection: ThreadGitDiffSelection;
  commits?: ThreadGitDiffCommit[];
  diff: string;
  truncated?: boolean;
}

function GitDiffPanelSkeleton({
  count = GIT_DIFF_PANEL_SKELETON_FILE_COUNT,
}: {
  count?: number;
}) {
  return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`git-diff-skeleton-${index}`}
          className="rounded-md border border-border/70 bg-muted/35"
        >
          <div className="border-b border-border/60 bg-background px-2.5 py-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className="h-3 w-48 max-w-full rounded-sm" />
              </div>
              <Skeleton className="h-3 w-14 shrink-0 rounded-sm" />
            </div>
          </div>
          <div className="space-y-1.5 px-2.5 py-2">
            <Skeleton className="h-3 w-full rounded-sm" />
            <Skeleton className="h-3 w-[94%] rounded-sm" />
            <Skeleton className="h-3 w-[90%] rounded-sm" />
            <Skeleton className="h-3 w-[86%] rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GitDiffSelector({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly GitDiffSelectionOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? value;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 w-full min-w-0 justify-between gap-2 px-2 text-xs font-normal",
            disabled && "opacity-60",
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate" title={option.label}>
              {option.label}
            </span>
            <Check
              className={cn(
                "size-3.5",
                option.value === value ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadGitDiffPanel({
  threadId,
  panelRef,
  isResizing,
  onDragging,
  gitDiffSelectValue,
  gitDiffSelectOptions,
  onGitDiffSelectionChange,
  isGitDiffLoading,
  gitDiffError,
  threadGitDiff,
  currentGitDiff,
  isPreparingGitDiff,
  isParsingGitDiffFiles,
  gitDiffStatsLabel,
  hasParsedGitDiffFiles,
  areAllGitDiffFilesCollapsed,
  onToggleAllFiles,
  gitDiffDisplayMode,
  onGitDiffDisplayModeChange,
  parsedGitDiffFileEntries,
  collapsedGitDiffFileKeys,
  queuedGitDiffFileRenderKeys,
  loadingGitDiffFileKeys,
  setGitDiffFileRef,
  onToggleGitDiffFileCollapsed,
  gitDiffViewOptions,
}: {
  threadId: string;
  panelRef: Ref<HTMLElement>;
  isResizing: boolean;
  onDragging: (isDragging: boolean) => void;
  gitDiffSelectValue: string;
  gitDiffSelectOptions: readonly GitDiffSelectionOption[];
  onGitDiffSelectionChange: (value: string) => void;
  isGitDiffLoading: boolean;
  gitDiffError: unknown;
  threadGitDiff?: ThreadGitDiffData;
  currentGitDiff: string;
  isPreparingGitDiff: boolean;
  isParsingGitDiffFiles: boolean;
  gitDiffStatsLabel: string;
  hasParsedGitDiffFiles: boolean;
  areAllGitDiffFilesCollapsed: boolean;
  onToggleAllFiles: () => void;
  gitDiffDisplayMode: "unified" | "split";
  onGitDiffDisplayModeChange: (value: "unified" | "split") => void;
  parsedGitDiffFileEntries: readonly ParsedGitDiffFileEntry[];
  collapsedGitDiffFileKeys: ReadonlySet<string>;
  queuedGitDiffFileRenderKeys: ReadonlySet<string>;
  loadingGitDiffFileKeys: ReadonlySet<string>;
  setGitDiffFileRef: (fileKey: string, element: HTMLDivElement | null) => void;
  onToggleGitDiffFileCollapsed: (fileKey: string) => void;
  gitDiffViewOptions: Record<string, string | boolean>;
}) {
  const hasCurrentGitDiff = currentGitDiff.trim().length > 0;

  return (
    <>
      <PanelResizeHandle
        onDragging={onDragging}
        className={cn(
          "group relative w-3 shrink-0 cursor-col-resize bg-transparent transition-colors",
          isResizing && "bg-accent/25",
        )}
        aria-label="Resize thread and git diff panels"
      >
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors",
            isResizing
              ? "bg-accent-foreground/55"
              : "group-hover:bg-accent-foreground/40",
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 opacity-0 shadow-sm transition-opacity",
            isResizing ? "opacity-100" : "group-hover:opacity-100",
          )}
        >
          <GripVertical className="size-3 text-muted-foreground" />
        </span>
      </PanelResizeHandle>
      <Panel
        defaultSize={GIT_DIFF_PANEL_DEFAULT_SIZE_PERCENT}
        minSize={GIT_DIFF_PANEL_MIN_SIZE_PERCENT}
        maxSize={GIT_DIFF_PANEL_MAX_SIZE_PERCENT}
        className="min-w-0 bg-background"
      >
        <aside ref={panelRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 max-w-[48%] flex-1">
                <GitDiffSelector
                  value={gitDiffSelectValue}
                  options={gitDiffSelectOptions}
                  onChange={onGitDiffSelectionChange}
                  disabled={isGitDiffLoading || threadGitDiff === undefined}
                />
              </div>
              <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1">
                {isParsingGitDiffFiles ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Parsing...
                  </span>
                ) : null}
                <span
                  className="max-w-[110px] truncate whitespace-nowrap text-xs text-muted-foreground"
                  title={gitDiffStatsLabel}
                >
                  {gitDiffStatsLabel}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground"
                  onClick={onToggleAllFiles}
                  disabled={!hasParsedGitDiffFiles || isGitDiffLoading}
                  aria-label={
                    areAllGitDiffFilesCollapsed ? "Expand all files" : "Collapse all files"
                  }
                  title={
                    areAllGitDiffFilesCollapsed ? "Expand all files" : "Collapse all files"
                  }
                >
                  {areAllGitDiffFilesCollapsed ? (
                    <ChevronsDown className="size-3.5" />
                  ) : (
                    <ChevronsUp className="size-3.5" />
                  )}
                </Button>
                <div className="inline-flex items-center rounded-md border border-border/70 p-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-6 w-6 p-0",
                      gitDiffDisplayMode === "unified"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground",
                    )}
                    onClick={() => onGitDiffDisplayModeChange("unified")}
                    aria-label="Stacked diff view"
                    title="Stacked diff view"
                  >
                    <Rows2 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-6 w-6 p-0",
                      gitDiffDisplayMode === "split"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground",
                    )}
                    onClick={() => onGitDiffDisplayModeChange("split")}
                    aria-label="Split diff view"
                    title="Split diff view"
                  >
                    <Columns2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-2 pt-0">
            {isPreparingGitDiff ? (
              <GitDiffPanelSkeleton />
            ) : gitDiffError ? (
              <p className="py-2 text-xs text-destructive">
                {gitDiffError instanceof Error
                  ? gitDiffError.message
                  : "Failed to load git diff"}
              </p>
            ) : threadGitDiff && hasCurrentGitDiff ? (
              <>
                {parsedGitDiffFileEntries.length > 0 ? (
                  <div className="space-y-2 pt-2">
                    {parsedGitDiffFileEntries.map(({ key, fileDiff }) => {
                      const isCollapsed = collapsedGitDiffFileKeys.has(key);
                      const hasQueuedFileRender = queuedGitDiffFileRenderKeys.has(key);
                      const isRendering =
                        !hasQueuedFileRender || loadingGitDiffFileKeys.has(key);
                      const fileDiffStats = summarizeGitDiffFile(fileDiff);
                      const fileDiffLabel = formatGitDiffFileLabel(fileDiff);
                      const openablePath = getOpenableGitDiffPath(fileDiff);
                      const canOpenFile = Boolean(openablePath);

                      return (
                        <div
                          key={key}
                          ref={(element) => setGitDiffFileRef(key, element)}
                          className="rounded-md border border-border/70 bg-muted/35"
                        >
                          <div className="sticky top-0 z-20 border-b border-border/60 bg-background px-2.5 py-1 text-xs font-medium text-foreground">
                            <div className="flex w-full min-w-0 items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                                  onClick={() => onToggleGitDiffFileCollapsed(key)}
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
                                {canOpenFile && openablePath ? (
                                  <button
                                    type="button"
                                    className="block min-w-0 truncate text-left underline-offset-2 hover:underline"
                                    title={fileDiffLabel}
                                    onClick={() => {
                                      void openThreadPathInEditor(threadId, {
                                        relativePath: openablePath,
                                        target: "file",
                                        command: getPathCommandForTarget("file"),
                                      });
                                    }}
                                  >
                                    {fileDiffLabel}
                                  </button>
                                ) : (
                                  <span
                                    className="block min-w-0 truncate"
                                    title={fileDiffLabel}
                                  >
                                    {fileDiffLabel}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                                +{fileDiffStats.additions} -{fileDiffStats.deletions}
                              </span>
                            </div>
                          </div>
                          {!isCollapsed ? (
                            isRendering ? (
                              <div className="space-y-1.5 px-2.5 py-2">
                                <Skeleton className="h-3 w-full rounded-sm" />
                                <Skeleton className="h-3 w-[96%] rounded-sm" />
                                <Skeleton className="h-3 w-[93%] rounded-sm" />
                                <Skeleton className="h-3 w-[90%] rounded-sm" />
                                <Skeleton className="h-3 w-[87%] rounded-sm" />
                                <Skeleton className="h-3 w-[84%] rounded-sm" />
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <div
                                  className="w-full max-w-full"
                                  style={GIT_DIFF_VIEW_STYLE}
                                >
                                  <FileDiff
                                    fileDiff={fileDiff}
                                    options={{
                                      ...gitDiffViewOptions,
                                      disableFileHeader: true,
                                    }}
                                  />
                                </div>
                              </div>
                            )
                          ) : null}
                        </div>
                      );
                    })}
                    {isParsingGitDiffFiles ? (
                      <div className="rounded-md border border-border/70 bg-muted/35 px-2.5 py-2">
                        <div className="space-y-1.5">
                          <Skeleton className="h-3 w-52 max-w-full rounded-sm" />
                          <Skeleton className="h-3 w-5/6 rounded-sm" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <pre className="overflow-auto whitespace-pre rounded-md border border-border/70 bg-muted/35 p-2 font-mono text-xs text-foreground">
                    {threadGitDiff.diff}
                  </pre>
                )}
                {threadGitDiff.truncated ? (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Diff output was truncated for display.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="py-2 text-xs text-muted-foreground">No diff to display.</p>
            )}
          </div>
        </aside>
      </Panel>
    </>
  );
}
