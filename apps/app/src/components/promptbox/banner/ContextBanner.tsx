import { ChevronDown } from "lucide-react";
import { WorkspaceChangesList } from "@/components/thread/WorkspaceChangesList";
import {
  BranchPicker,
  getMergeBaseBranchCandidates,
} from "@/components/pickers/BranchPicker";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  renderChangeSummary,
  toChangeTally,
  type WorkspaceChangedFilesSection,
} from "@/lib/workspace-change-summary";
import { cn } from "@/lib/utils";

const KIND_PREFIX: Record<WorkspaceChangedFilesSection["kind"], string> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

/**
 * Today's banner shape — a single git/changed-files summary with optional
 * merge-base picker and expandable file list. The plan in
 * plans/thread-prompt-context-banner.md grows this into a multi-section
 * surface (managed work + git + TODOs); for now we only host the existing
 * git lane.
 */
export interface ContextBannerMergeBaseConfig {
  branch: string;
  options?: readonly string[];
  optionsLoading?: boolean;
  onChange: (branch: string) => void;
  onPickerOpenChange?: (open: boolean) => void;
}

export interface ContextBannerProps {
  section: WorkspaceChangedFilesSection;
  isChangeListExpanded: boolean;
  isDiffPanelActive: boolean;
  /** When null, the merge-base picker is hidden — e.g. thread is on default branch. */
  mergeBase: ContextBannerMergeBaseConfig | null;
  onPromptBannerFileClick: (file: { path: string }) => void;
  onPromptGitStatsBannerClick: () => void;
  onToggleChangeListExpanded: () => void;
}

export function ContextBanner({
  section,
  isChangeListExpanded,
  isDiffPanelActive,
  mergeBase,
  onPromptBannerFileClick,
  onPromptGitStatsBannerClick,
  onToggleChangeListExpanded,
}: ContextBannerProps) {
  const summary = (
    <>
      {KIND_PREFIX[section.kind]} ·{" "}
      {renderChangeSummary(toChangeTally(section.stats))}
    </>
  );
  const canExpandChangeList = section.files.length > 0;
  const mergeBaseCandidates = mergeBase
    ? getMergeBaseBranchCandidates({
        mergeBaseBranch: mergeBase.branch,
        mergeBaseBranchOptions: mergeBase.options,
      })
    : [];
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
          {canExpandChangeList ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 truncate text-left"
              onClick={(event) => {
                event.stopPropagation();
                onToggleChangeListExpanded();
              }}
            >
              <span className="truncate">{summary}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-200",
                  isChangeListExpanded && "rotate-180",
                )}
              />
            </button>
          ) : (
            <span className="truncate">{summary}</span>
          )}
          {mergeBase ? (
            <div
              className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground/90"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <span className="shrink-0">Merge base:</span>
              <BranchPicker
                value={mergeBase.branch}
                options={mergeBaseCandidates}
                variant="minimal"
                loading={mergeBase.optionsLoading}
                onChange={mergeBase.onChange}
                onOpenChange={mergeBase.onPickerOpenChange}
                className="max-w-[10rem]"
                muted
              />
            </div>
          ) : null}
        </div>
        {canExpandChangeList ? (
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
                files={section.files}
                onFileClick={onPromptBannerFileClick}
              />
            </div>
          </div>
        ) : null}
      </div>
    </PromptStackCard>
  );
}
