import type { ThreadWorkStatus } from "@beanbag/agent-core";
import { openThreadPathInEditor } from "@/lib/api";
import { getPathCommandForTarget } from "@/lib/open-path-preferences";
import { cn } from "@/lib/utils";
import { formatWorkspaceFileStatus } from "@/lib/workspace-change-summary";

export function WorkspaceChangesList({
  files,
  threadId,
  maxHeightClassName = "max-h-32",
  emptyMessage = "No changed files detected.",
  onFileClick,
}: {
  files: ThreadWorkStatus["files"];
  threadId?: string;
  maxHeightClassName?: string;
  emptyMessage?: string;
  onFileClick?: (file: NonNullable<ThreadWorkStatus["files"]>[number]) => void;
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
            {formatWorkspaceFileStatus(file.status)}
          </span>
          {threadId || onFileClick ? (
            <button
              type="button"
              className="truncate text-left text-xs underline-offset-2 hover:underline"
              title={file.path}
              onClick={() => {
                if (onFileClick) {
                  onFileClick(file);
                  return;
                }
                if (!threadId) return;
                void openThreadPathInEditor(threadId, {
                  relativePath: file.path,
                  target: "file",
                  command: getPathCommandForTarget("file"),
                });
              }}
            >
              {file.path}
            </button>
          ) : (
            <span className="truncate text-xs">{file.path}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
