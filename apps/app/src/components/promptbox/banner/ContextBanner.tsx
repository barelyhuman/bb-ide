import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  type WorkspaceFileStatus,
  type WorkspaceStatus,
} from "@bb/domain";
import { WorkspaceChangesList } from "@/components/thread/WorkspaceChangesList";
import {
  BranchPicker,
  getMergeBaseBranchCandidates,
} from "@/components/pickers/BranchPicker";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { cn } from "@/lib/utils";

/**
 * Today's banner shape — a single git/changed-files summary with optional
 * merge-base picker and expandable file list. The plan in
 * plans/thread-prompt-context-banner.md grows this into a multi-section
 * surface (managed work + git + TODOs); for now we only host the existing
 * git lane while keeping the prop names stable for the migration.
 */
export interface ContextBannerProps {
  canExpandPromptChangeList: boolean;
  isChangeListExpanded: boolean;
  isDiffPanelActive: boolean;
  mergeBaseBranchOptions?: readonly string[];
  mergeBaseBranchOptionsLoading?: boolean;
  onPromptBannerFileClick: (file: { path: string }) => void;
  onPromptBannerMergeBaseBranchChange?: (branch: string) => void;
  onPromptBannerBranchPickerOpenChange?: (open: boolean) => void;
  onPromptGitStatsBannerClick: () => void;
  onToggleChangeListExpanded: () => void;
  promptBannerFiles?: WorkspaceFileStatus[];
  promptBannerMergeBaseBranch?: string;
  promptBannerSummary: ReactNode;
  showBranchComparisonUi: boolean;
  workspaceStatus?: WorkspaceStatus | null;
}

export function ContextBanner({
  canExpandPromptChangeList,
  isChangeListExpanded,
  isDiffPanelActive,
  mergeBaseBranchOptions,
  mergeBaseBranchOptionsLoading,
  onPromptBannerFileClick,
  onPromptBannerMergeBaseBranchChange,
  onPromptBannerBranchPickerOpenChange,
  onPromptGitStatsBannerClick,
  onToggleChangeListExpanded,
  promptBannerFiles,
  promptBannerMergeBaseBranch,
  promptBannerSummary,
  showBranchComparisonUi,
}: ContextBannerProps) {
  const promptBannerMergeBaseCandidates = getMergeBaseBranchCandidates({
    mergeBaseBranch: promptBannerMergeBaseBranch,
    mergeBaseBranchOptions,
  });
  const canSelectPromptBannerMergeBase = Boolean(
    showBranchComparisonUi &&
      promptBannerMergeBaseBranch &&
      onPromptBannerMergeBaseBranchChange &&
      promptBannerMergeBaseCandidates.length > 0,
  );

  return (
    <PromptStackCard
      className={cn(
        "px-3 py-1.5 text-xs text-muted-foreground",
        !isDiffPanelActive &&
          "cursor-pointer transition-colors hover:bg-muted/55",
      )}
    >
      <div onClick={onPromptGitStatsBannerClick}>
        <div className="flex items-center justify-between gap-3">
          {canExpandPromptChangeList ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 truncate text-left"
              onClick={(event) => {
                event.stopPropagation();
                onToggleChangeListExpanded();
              }}
            >
              <span className="truncate">{promptBannerSummary}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-200",
                  isChangeListExpanded && "rotate-180",
                )}
              />
            </button>
          ) : (
            <span className="truncate">{promptBannerSummary}</span>
          )}
          {showBranchComparisonUi ? (
            canSelectPromptBannerMergeBase && promptBannerMergeBaseBranch ? (
              <div
                className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground/90"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <span className="shrink-0">Merge base:</span>
                <BranchPicker
                  value={promptBannerMergeBaseBranch}
                  options={promptBannerMergeBaseCandidates}
                  variant="minimal"
                  loading={mergeBaseBranchOptionsLoading}
                  onChange={(branch) => {
                    onPromptBannerMergeBaseBranchChange?.(branch);
                  }}
                  onOpenChange={onPromptBannerBranchPickerOpenChange}
                  className="max-w-[10rem]"
                  muted
                />
              </div>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground/90">
                {promptBannerMergeBaseBranch
                  ? `Merge base: ${promptBannerMergeBaseBranch}`
                  : "Merge base comparison"}
              </span>
            )
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground/90">
              Includes all threads in this working directory
            </span>
          )}
        </div>
        {canExpandPromptChangeList && promptBannerFiles ? (
          <div
            className={cn(
              "grid overflow-hidden transition-[grid-template-rows,opacity,margin,padding,border-color] duration-200 ease-out",
              isChangeListExpanded
                ? "mt-2 grid-rows-[1fr] border-t border-border/50 pt-1 opacity-100"
                : "grid-rows-[0fr] border-t border-transparent pt-0 opacity-0",
            )}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="overflow-hidden">
              <WorkspaceChangesList
                files={promptBannerFiles}
                onFileClick={onPromptBannerFileClick}
              />
            </div>
          </div>
        ) : null}
      </div>
    </PromptStackCard>
  );
}
