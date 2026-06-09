import { useMemo, useState, type FormEvent } from "react";
import { assertNever } from "@bb/core-ui";
import type { GitBranchRefClassification } from "@bb/domain";
import { DetailCard, DetailRow } from "@/components/ui/detail-card.js";
import type { ThreadGitStatusDisplay } from "@/components/workspace/workspace-status";
import { ChangedFilesDetailRow } from "@/components/workspace/ChangedFilesDetailRow";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import { FormError } from "@/components/ui/form-error.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  getMergeBaseBranchCandidateGroups,
  BranchPicker,
} from "@/components/pickers/BranchPicker";

export type ThreadGitActionDialogTarget =
  | { kind: "commit" }
  | { kind: "commit_and_squash_merge" }
  | { kind: "squash_merge" };

interface ThreadGitActionDialogProps {
  target: ThreadGitActionDialogTarget | null;
  branchName?: string;
  gitStatusDisplay?: ThreadGitStatusDisplay;
  changedFilesSection?: WorkspaceChangedFilesSection | null;
  showMergeBaseDetails?: boolean;
  mergeBaseBranch?: string;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions?: string[];
  mergeBaseBranchOptionsTruncated?: boolean;
  mergeBaseRemoteBranchOptions?: readonly string[];
  mergeBaseBranchOptionsLoading?: boolean;
  onMergeBaseBranchChange?: (branch: string) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onCommit: () => Promise<void>;
  onSquashMerge: (args: { mergeBaseBranch: string }) => Promise<void>;
}

function getDialogCopy(target: ThreadGitActionDialogTarget) {
  switch (target.kind) {
    case "commit":
      return {
        title: "Commit changes",
        description: "Create a commit from the current workspace changes.",
        submitLabel: "Commit changes",
        showCommitControls: true,
        showMergeBase: false,
      };
    case "commit_and_squash_merge":
      return {
        title: "Commit and squash merge",
        description:
          "Commit the current workspace changes, then squash merge this branch.",
        submitLabel: "Commit + squash merge",
        showCommitControls: true,
        showMergeBase: true,
      };
    case "squash_merge":
      return {
        title: "Squash merge",
        description: "Squash merge this branch into the selected merge base.",
        submitLabel: "Squash merge",
        showCommitControls: false,
        showMergeBase: true,
      };
    default:
      return assertNever(target);
  }
}

export function ThreadGitActionDialog({
  target,
  branchName,
  gitStatusDisplay,
  changedFilesSection,
  showMergeBaseDetails = false,
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  mergeBaseBranchOptionsTruncated,
  mergeBaseRemoteBranchOptions,
  mergeBaseBranchOptionsLoading = false,
  onMergeBaseBranchChange,
  onMergeBaseBranchSearchQueryChange,
  onOpenChange,
  onCommit,
  onSquashMerge,
}: ThreadGitActionDialogProps) {
  const dialogCopy = useMemo(
    () => (target ? getDialogCopy(target) : null),
    [target],
  );

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-xl">
        {target && dialogCopy ? (
          <ThreadGitActionDialogContent
            key={target.kind}
            target={target}
            branchName={branchName}
            gitStatusDisplay={gitStatusDisplay}
            changedFilesSection={changedFilesSection}
            showMergeBaseDetails={showMergeBaseDetails}
            mergeBaseBranch={mergeBaseBranch}
            mergeBaseBranchRef={mergeBaseBranchRef}
            mergeBaseBranchOptions={mergeBaseBranchOptions}
            mergeBaseBranchOptionsTruncated={mergeBaseBranchOptionsTruncated}
            mergeBaseRemoteBranchOptions={mergeBaseRemoteBranchOptions}
            mergeBaseBranchOptionsLoading={mergeBaseBranchOptionsLoading}
            onMergeBaseBranchChange={onMergeBaseBranchChange}
            onMergeBaseBranchSearchQueryChange={
              onMergeBaseBranchSearchQueryChange
            }
            onOpenChange={onOpenChange}
            onCommit={onCommit}
            onSquashMerge={onSquashMerge}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type ThreadGitActionDialogContentProps = Omit<
  ThreadGitActionDialogProps,
  "target"
> & {
  target: ThreadGitActionDialogTarget;
};

export function ThreadGitActionDialogContent({
  target,
  branchName,
  gitStatusDisplay,
  changedFilesSection,
  showMergeBaseDetails,
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  mergeBaseBranchOptionsTruncated,
  mergeBaseRemoteBranchOptions,
  mergeBaseBranchOptionsLoading,
  onMergeBaseBranchChange,
  onMergeBaseBranchSearchQueryChange,
  onOpenChange,
  onCommit,
  onSquashMerge,
}: ThreadGitActionDialogContentProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogCopy = getDialogCopy(target);
  const mergeBaseCandidateGroups = getMergeBaseBranchCandidateGroups({
    mergeBaseBranch,
    mergeBaseBranchRef,
    mergeBaseBranchOptions,
    remoteMergeBaseBranchOptions: mergeBaseRemoteBranchOptions,
  });
  const mergeBaseCandidates = mergeBaseCandidateGroups.options;
  const remoteMergeBaseCandidates = mergeBaseCandidateGroups.remoteOptions;
  const selectedMergeBaseBranch = mergeBaseBranch ?? mergeBaseCandidates[0];
  const selectedMergeBaseBranchRef =
    mergeBaseBranchRef?.name === selectedMergeBaseBranch
      ? mergeBaseBranchRef
      : null;
  const selectedMergeBaseBranchClassificationPending =
    dialogCopy.showMergeBase &&
    Boolean(selectedMergeBaseBranch) &&
    mergeBaseBranchRef === undefined;
  const remoteMergeBaseBranches = useMemo(
    () => new Set(remoteMergeBaseCandidates),
    [remoteMergeBaseCandidates],
  );
  const selectedMergeBaseBranchIsRemote = selectedMergeBaseBranch
    ? selectedMergeBaseBranchRef?.kind === "remote" ||
      (selectedMergeBaseBranchRef === null &&
        remoteMergeBaseBranches.has(selectedMergeBaseBranch))
    : false;
  const selectedMergeBaseBranchMissing =
    selectedMergeBaseBranchRef?.kind === "missing";
  const blocksRemoteMergeBase =
    dialogCopy.showMergeBase && selectedMergeBaseBranchIsRemote;
  const remoteMergeBaseErrorMessage =
    "Squash merge requires a local target branch. Create or check out a local branch from the remote first.";
  const missingMergeBaseErrorMessage =
    "Squash merge requires an existing local target branch.";
  const checkingMergeBaseErrorMessage = "Checking merge base branch.";
  const canSelectMergeBase =
    dialogCopy.showMergeBase &&
    showMergeBaseDetails === true &&
    Boolean(onMergeBaseBranchChange) &&
    (mergeBaseCandidates.length > 0 || remoteMergeBaseCandidates.length > 0);
  const canShowMergeBase =
    dialogCopy.showMergeBase &&
    showMergeBaseDetails === true &&
    (canSelectMergeBase || Boolean(selectedMergeBaseBranch));
  const shouldShowChangedFilesRow = Boolean(
    changedFilesSection && changedFilesSection.files.length > 0,
  );
  const mergeBaseSubmitError = !selectedMergeBaseBranch
    ? "A merge base branch is required"
    : selectedMergeBaseBranchClassificationPending
      ? checkingMergeBaseErrorMessage
      : blocksRemoteMergeBase
        ? remoteMergeBaseErrorMessage
        : selectedMergeBaseBranchMissing
          ? missingMergeBaseErrorMessage
          : null;
  const visibleMergeBaseErrorMessage =
    errorMessage ??
    (selectedMergeBaseBranchClassificationPending
      ? checkingMergeBaseErrorMessage
      : blocksRemoteMergeBase
        ? remoteMergeBaseErrorMessage
        : selectedMergeBaseBranchMissing
          ? missingMergeBaseErrorMessage
          : null);
  const submitTitle = selectedMergeBaseBranchClassificationPending
    ? checkingMergeBaseErrorMessage
    : blocksRemoteMergeBase
      ? remoteMergeBaseErrorMessage
      : selectedMergeBaseBranchMissing
        ? missingMergeBaseErrorMessage
        : undefined;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    switch (target.kind) {
      case "commit":
        onOpenChange(false);
        void onCommit();
        break;
      case "commit_and_squash_merge":
        if (mergeBaseSubmitError || !selectedMergeBaseBranch) {
          setErrorMessage(
            mergeBaseSubmitError ?? "A merge base branch is required",
          );
          return;
        }
        onOpenChange(false);
        void onSquashMerge({
          mergeBaseBranch: selectedMergeBaseBranch,
        });
        break;
      case "squash_merge":
        if (mergeBaseSubmitError || !selectedMergeBaseBranch) {
          setErrorMessage(
            mergeBaseSubmitError ?? "A merge base branch is required",
          );
          return;
        }
        onOpenChange(false);
        void onSquashMerge({
          mergeBaseBranch: selectedMergeBaseBranch,
        });
        break;
      default:
        assertNever(target);
    }
  };

  return (
    <>
      <DialogHeader className="px-6 pt-5 pb-3">
        <DialogTitle>{dialogCopy.title}</DialogTitle>
        <DialogDescription>{dialogCopy.description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4 px-6 pt-1 pb-5" onSubmit={handleSubmit}>
        {branchName ||
        gitStatusDisplay ||
        canShowMergeBase ||
        shouldShowChangedFilesRow ? (
          <DetailCard appearance="flat">
            {branchName ? (
              <DetailRow label="Branch" valueClassName="min-w-0 truncate">
                <span className="block truncate" title={branchName}>
                  {branchName}
                </span>
              </DetailRow>
            ) : null}
            {gitStatusDisplay ? (
              <DetailRow label="Git status" valueClassName="min-w-0">
                <div
                  className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
                  title={`${gitStatusDisplay.label} ${gitStatusDisplay.summary}`.trim()}
                >
                  <span className="shrink-0 font-medium">
                    {gitStatusDisplay.label}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {gitStatusDisplay.summaryContent}
                  </span>
                </div>
              </DetailRow>
            ) : null}
            {canShowMergeBase && selectedMergeBaseBranch ? (
              <DetailRow label="Merge base" valueClassName="min-w-0">
                {canSelectMergeBase ? (
                  <BranchPicker
                    value={selectedMergeBaseBranch}
                    options={mergeBaseCandidates}
                    remoteOptions={remoteMergeBaseCandidates}
                    selectedOptionKind={
                      mergeBaseCandidateGroups.selectedOptionKind
                    }
                    optionsTruncated={mergeBaseBranchOptionsTruncated}
                    loading={mergeBaseBranchOptionsLoading}
                    onChange={(branch) => onMergeBaseBranchChange?.(branch)}
                    onSearchQueryChange={onMergeBaseBranchSearchQueryChange}
                    className="max-w-full"
                  />
                ) : (
                  <span
                    className="block truncate"
                    title={selectedMergeBaseBranch}
                  >
                    {selectedMergeBaseBranch}
                  </span>
                )}
              </DetailRow>
            ) : null}
            {shouldShowChangedFilesRow && changedFilesSection ? (
              <ChangedFilesDetailRow
                sections={[changedFilesSection]}
                rowValueClassName="pt-0.5"
                listClassName="max-h-40"
              />
            ) : null}
          </DetailCard>
        ) : null}
        <FormError message={visibleMergeBaseErrorMessage} />
        <DialogFooter>
          <Button
            type="submit"
            disabled={dialogCopy.showMergeBase && mergeBaseSubmitError !== null}
            title={submitTitle}
          >
            {dialogCopy.submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
