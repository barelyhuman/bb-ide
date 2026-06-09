import type { Thread } from "@bb/domain";
import { threadTypeLabel } from "@/lib/thread-title";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "./ConfirmDeleteDialog";

export interface ThreadDeleteDialogTarget {
  thread: Thread;
  /** Present iff manager thread with one or more assigned children. */
  assignedChildCount?: number;
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
    <ConfirmDeleteDialog open={target !== null} onOpenChange={onOpenChange}>
      {target ? (
        <ThreadDeleteDialogContent
          target={target}
          pending={pending}
          onOpenChange={onOpenChange}
          onDelete={onDelete}
        />
      ) : null}
    </ConfirmDeleteDialog>
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
    target.assignedChildCount ? "Assigned threads will be unassigned." : null,
    "This action cannot be undone.",
  ].filter((part): part is string => part !== null);

  return (
    <ConfirmDeleteDialogContent
      title={`Delete ${label}?`}
      description={sentences.join(" ")}
      confirmLabel={`Delete ${label}`}
      pending={pending}
      onConfirm={() => onDelete(target)}
      onCancel={() => onOpenChange(false)}
    />
  );
}
