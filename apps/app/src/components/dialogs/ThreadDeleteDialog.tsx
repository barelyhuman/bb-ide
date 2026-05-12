import type { Thread } from "@bb/domain";
import { Button } from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { threadTypeLabel } from "@/lib/thread-title";
import type { ThreadDirtyWorkspaceWarning } from "./ThreadArchiveDialog";

export interface ThreadDeleteDialogTarget {
  thread: Thread;
  /** Present iff manager thread with one or more assigned children. */
  assignedChildCount?: number;
  /** Present iff the workspace is managed and has uncommitted/unmerged work. */
  workspaceWarning?: ThreadDirtyWorkspaceWarning;
}

interface ThreadDeleteDialogProps {
  target: ThreadDeleteDialogTarget | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (target: ThreadDeleteDialogTarget) => void;
}

export function ThreadDeleteDialog({
  target,
  pending,
  onOpenChange,
  onDelete,
}: ThreadDeleteDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ThreadDeleteDialogContent
            target={target}
            pending={pending}
            onOpenChange={onOpenChange}
            onDelete={onDelete}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface ThreadDeleteDialogContentProps {
  target: ThreadDeleteDialogTarget;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (target: ThreadDeleteDialogTarget) => void;
}

export function ThreadDeleteDialogContent({
  target,
  pending,
  onOpenChange,
  onDelete,
}: ThreadDeleteDialogContentProps) {
  const label = threadTypeLabel(target.thread.type);
  const sentences = [
    target.assignedChildCount
      ? formatAssignedChildSentence(target.assignedChildCount)
      : null,
    target.workspaceWarning
      ? formatWorkspaceWarningSentence(target.workspaceWarning)
      : null,
    "This action cannot be undone.",
  ].filter((part): part is string => part !== null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete {label}?</DialogTitle>
        <DialogDescription>{sentences.join(" ")}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => onDelete(target)}
        >
          Delete {label}
        </Button>
      </DialogFooter>
    </>
  );
}

function formatAssignedChildSentence(count: number): string {
  return count === 1
    ? "1 child thread is assigned to this manager and will lose its manager."
    : `${count} child threads are assigned to this manager and will lose their manager.`;
}

function formatWorkspaceWarningSentence(
  warning: ThreadDirtyWorkspaceWarning,
): string {
  if (
    warning.hasUncommittedChanges &&
    warning.hasCommittedUnmergedChanges
  ) {
    return "Its workspace has uncommitted changes and unmerged commits that will be lost.";
  }
  if (warning.hasUncommittedChanges) {
    return "Its workspace has uncommitted changes that will be lost.";
  }
  return "Its workspace has unmerged commits that will be lost.";
}
