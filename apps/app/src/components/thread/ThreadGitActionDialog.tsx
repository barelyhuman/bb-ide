import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { assertNever } from "@beanbag/agent-core";
import { PromptOptionPicker } from "@/components/promptbox/PromptOptionPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export type ThreadGitActionDialogTarget =
  | { kind: "commit" }
  | { kind: "commit_and_squash_merge" }
  | { kind: "squash_merge" };

interface ThreadGitActionDialogProps {
  target: ThreadGitActionDialogTarget | null;
  pending?: boolean;
  showMergeBaseDetails?: boolean;
  mergeBaseBranch?: string;
  mergeBaseBranchOptions?: string[];
  onMergeBaseBranchChange?: (branch: string) => void;
  onOpenChange: (open: boolean) => void;
  onCommit: (args: { includeUnstaged: boolean; message?: string }) => Promise<void>;
  onSquashMerge: (args: {
    commitIfNeeded: boolean;
    includeUnstaged: boolean;
    commitMessage?: string;
    mergeBaseBranch?: string;
  }) => Promise<void>;
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
        description: "Commit the current workspace changes, then squash merge this thread branch.",
        submitLabel: "Commit + squash merge",
        showCommitControls: true,
        showMergeBase: true,
      };
    case "squash_merge":
      return {
        title: "Squash merge",
        description: "Squash merge this thread branch into the selected merge base.",
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
  pending = false,
  showMergeBaseDetails = false,
  mergeBaseBranch,
  mergeBaseBranchOptions,
  onMergeBaseBranchChange,
  onOpenChange,
  onCommit,
  onSquashMerge,
}: ThreadGitActionDialogProps) {
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [commitMessage, setCommitMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setIncludeUnstaged(true);
      setCommitMessage("");
      setErrorMessage(null);
      return;
    }

    setIncludeUnstaged(true);
    setCommitMessage("");
    setErrorMessage(null);
  }, [target]);

  const dialogCopy = useMemo(
    () => (target ? getDialogCopy(target) : null),
    [target],
  );
  const mergeBaseCandidates = useMemo(() => {
    const fromProps = mergeBaseBranchOptions ?? [];
    if (!mergeBaseBranch || fromProps.includes(mergeBaseBranch)) {
      return fromProps;
    }
    return [mergeBaseBranch, ...fromProps];
  }, [mergeBaseBranch, mergeBaseBranchOptions]);
  const selectedMergeBaseBranch = mergeBaseBranch ?? mergeBaseCandidates[0];
  const mergeBaseOptions = useMemo(
    () => mergeBaseCandidates.map((branch) => ({
      value: branch,
      label: branch,
    })),
    [mergeBaseCandidates],
  );
  const canSelectMergeBase =
    Boolean(dialogCopy?.showMergeBase) &&
    showMergeBaseDetails &&
    Boolean(onMergeBaseBranchChange) &&
    mergeBaseOptions.length > 0;
  const canShowMergeBase =
    Boolean(dialogCopy?.showMergeBase) &&
    showMergeBaseDetails &&
    (canSelectMergeBase || Boolean(selectedMergeBaseBranch));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || pending) {
      return;
    }

    const nextCommitMessage = commitMessage.trim() || undefined;
    setErrorMessage(null);

    try {
      switch (target.kind) {
        case "commit":
          await onCommit({
            includeUnstaged,
            message: nextCommitMessage,
          });
          break;
        case "commit_and_squash_merge":
          await onSquashMerge({
            commitIfNeeded: true,
            includeUnstaged,
            commitMessage: nextCommitMessage,
            mergeBaseBranch: selectedMergeBaseBranch,
          });
          break;
        case "squash_merge":
          await onSquashMerge({
            commitIfNeeded: false,
            includeUnstaged: false,
            mergeBaseBranch: selectedMergeBaseBranch,
          });
          break;
        default:
          assertNever(target);
      }
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to start git action",
      );
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target && dialogCopy ? (
          <>
            <DialogHeader>
              <DialogTitle>{dialogCopy.title}</DialogTitle>
              <DialogDescription>{dialogCopy.description}</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {dialogCopy.showCommitControls ? (
                <>
                  <div className="space-y-1.5">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={includeUnstaged}
                        disabled={pending}
                        onChange={(event) => setIncludeUnstaged(event.target.checked)}
                      />
                      <span>Include unstaged changes</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Turn this off to commit only the changes that are already staged.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Commit message</label>
                    <Textarea
                      rows={3}
                      value={commitMessage}
                      disabled={pending}
                      onChange={(event) => setCommitMessage(event.target.value)}
                      placeholder="Leave blank to autogenerate a commit message"
                    />
                  </div>
                </>
              ) : null}
              {canShowMergeBase ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Merge base</label>
                  {canSelectMergeBase && selectedMergeBaseBranch ? (
                    <PromptOptionPicker
                      label="Merge base branch"
                      value={selectedMergeBaseBranch}
                      options={mergeBaseOptions}
                      onChange={(branch) => onMergeBaseBranchChange?.(branch)}
                      className="h-8 max-w-[240px] text-xs"
                    />
                  ) : (
                    <p className="text-sm text-foreground">{selectedMergeBaseBranch}</p>
                  )}
                </div>
              ) : null}
              {errorMessage ? (
                <p className="text-sm text-destructive">{errorMessage}</p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Starting..." : dialogCopy.submitLabel}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
