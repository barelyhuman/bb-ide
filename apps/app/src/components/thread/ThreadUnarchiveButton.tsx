import type { ThreadType } from "@bb/domain";
import { ArchiveRestore, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { threadTypeLabel } from "@/lib/thread-title";
import { cn } from "@/lib/utils";

export function ThreadUnarchiveButton({
  isPending,
  onUnarchive,
  buttonLabel,
  threadType,
  className,
}: {
  isPending?: boolean;
  onUnarchive: () => void;
  buttonLabel?: string;
  threadType?: ThreadType;
  className?: string;
}) {
  const resolvedLabel =
    buttonLabel ?? `Unarchive ${threadTypeLabel(threadType ?? "standard")}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={resolvedLabel}
      title={resolvedLabel}
      onClick={onUnarchive}
      disabled={Boolean(isPending)}
      className={cn("size-6", className)}
    >
      {isPending ? (
        <LoaderCircle className="size-3 animate-spin" />
      ) : (
        <ArchiveRestore className="size-3" />
      )}
    </Button>
  );
}
