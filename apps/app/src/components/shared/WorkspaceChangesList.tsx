import type { ThreadWorkStatus } from "@beanbag/agent-core";
import { cn } from "@/lib/utils";

export function WorkspaceChangesList({
  files,
  maxHeightClassName = "max-h-32",
  emptyMessage = "No changed files detected.",
}: {
  files: ThreadWorkStatus["files"];
  maxHeightClassName?: string;
  emptyMessage?: string;
}) {
  if (!files || files.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <ul className={cn("space-y-0.5 overflow-auto", maxHeightClassName)}>
      {files.map((file) => (
        <li key={`${file.status}:${file.path}`} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-xs uppercase text-muted-foreground/80">
            {file.status}
          </span>
          <span className="truncate text-xs">{file.path}</span>
        </li>
      ))}
    </ul>
  );
}
