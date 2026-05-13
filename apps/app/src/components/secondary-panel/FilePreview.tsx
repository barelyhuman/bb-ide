import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import type { SelectedLineRange, SupportedLanguages } from "@pierre/diffs";
import { Icon, MarkdownPreview, Skeleton } from "@/components/ui";
import { usePreferredTheme } from "@/hooks/useTheme";

export interface FilePreviewFile {
  name: string;
  contents: string;
  lang?: SupportedLanguages;
}

export type FilePreviewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "not-found" }
  | { kind: "manager-status-pending" }
  | { kind: "error"; message?: string }
  | { kind: "ready"; file: FilePreviewFile; lineNumber: number | null };

export interface FilePreviewProps {
  state: FilePreviewState;
}

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "mdx",
  "markdown",
]);

const FILE_PREVIEW_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

// `--md-content-w` tells MarkdownPreview the surrounding text-column width so
// narrow tables sit flush with the prose on the left instead of centering in
// the panel. `100cqi` resolves against the `@container/page` scope on the
// wrapper below — i.e. the panel width.
const FILE_PREVIEW_WRAPPER_STYLE = {
  "--md-content-w": "100cqi",
} as CSSProperties;

function isMarkdownFile(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension !== undefined && MARKDOWN_EXTENSIONS.has(extension);
}

export function FilePreview({ state }: FilePreviewProps) {
  // Establish a `@container/page` scope so MarkdownPreview's `100cqw`-based
  // table breakout sizes against this panel, not the viewport.
  return (
    <div className="@container/page" style={FILE_PREVIEW_WRAPPER_STYLE}>
      <FilePreviewBody state={state} />
    </div>
  );
}

function FilePreviewBody({ state }: FilePreviewProps) {
  if (state.kind === "loading") {
    return <FilePreviewLoading />;
  }
  if (state.kind === "empty") {
    return <FilePreviewMessage icon="empty" message="Empty file." />;
  }
  if (state.kind === "not-found") {
    return <FilePreviewMessage icon="missing" message="File not found." />;
  }
  if (state.kind === "manager-status-pending") {
    return (
      <FilePreviewMessage
        icon={null}
        message="Manager hasn't written a status yet."
      />
    );
  }
  if (state.kind === "error") {
    return (
      <FilePreviewMessage
        icon={state.message === undefined ? "missing" : null}
        message={state.message ?? "Failed to load file"}
      />
    );
  }
  const lineNumber = state.lineNumber ?? null;
  if (isMarkdownFile(state.file.name) && lineNumber === null) {
    return <MarkdownFilePreview file={state.file} />;
  }
  return <FilePreviewCode file={state.file} lineNumber={lineNumber} />;
}

function MarkdownFilePreview({ file }: { file: FilePreviewFile }) {
  return <MarkdownPreview content={file.contents} />;
}

function clearPreviewTargetLine(container: HTMLElement) {
  const targetLines = container.querySelectorAll(
    "[data-file-preview-target-line]",
  );
  for (const targetLine of targetLines) {
    targetLine.removeAttribute("data-file-preview-target-line");
    targetLine.removeAttribute("data-selected-line");
  }
}

function findPreviewTargetLine(
  container: HTMLElement,
  lineNumber: number,
): HTMLElement | null {
  const lines = container.querySelectorAll(`[data-line="${lineNumber}"]`);
  for (const line of lines) {
    if (line instanceof HTMLElement && line.dataset.lineIndex !== undefined) {
      return line;
    }
  }
  for (const line of lines) {
    if (line instanceof HTMLElement) {
      return line;
    }
  }
  return null;
}

function FilePreviewLoading() {
  return (
    <div className="space-y-2 py-2" aria-busy>
      <Skeleton className="h-3 w-3/4 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-3/5 rounded-sm" />
    </div>
  );
}

function FilePreviewMessage({
  icon,
  message,
}: {
  icon: "empty" | "missing" | null;
  message: string;
}) {
  const iconName =
    icon === "missing" ? "FileX2" : icon === "empty" ? "FileQuestion" : null;
  return (
    <div
      role={icon === "missing" ? "alert" : undefined}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-background/45 px-3 py-8 text-sm text-muted-foreground"
    >
      {iconName ? <Icon name={iconName} className="size-3.5" /> : null}
      <span>{message}</span>
    </div>
  );
}

function FilePreviewCode({
  file,
  lineNumber,
}: {
  file: FilePreviewFile;
  lineNumber: number | null;
}) {
  const preferredTheme = usePreferredTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const options = useMemo(
    () => ({
      themeType: preferredTheme,
      overflow: "scroll" as const,
      disableFileHeader: true,
      enableLineSelection: lineNumber !== null,
    }),
    [lineNumber, preferredTheme],
  );
  const selectedLines = useMemo<SelectedLineRange | null>(
    () =>
      lineNumber === null
        ? null
        : {
            start: lineNumber,
            end: lineNumber,
          },
    [lineNumber],
  );

  useEffect(() => {
    let animationFrame: number | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;

    function scheduleRetry() {
      animationFrame = window.requestAnimationFrame(scrollToLine);
      retryTimer = window.setTimeout(scrollToLine, 16);
    }

    function scrollToLine() {
      const container = containerRef.current;
      if (!container) return;
      clearPreviewTargetLine(container);
      clearPreviewTargetLine(container.ownerDocument.body);
      if (lineNumber === null) return;

      const line =
        findPreviewTargetLine(container, lineNumber) ??
        findPreviewTargetLine(container.ownerDocument.body, lineNumber);
      if (line) {
        line.setAttribute("data-file-preview-target-line", "");
        line.setAttribute("data-selected-line", "single");
        line.scrollIntoView?.({ block: "center" });
        return;
      }

      attempts += 1;
      if (attempts < 8) {
        scheduleRetry();
      }
    }

    scrollToLine();
    return () => {
      const container = containerRef.current;
      if (container) {
        clearPreviewTargetLine(container);
        clearPreviewTargetLine(container.ownerDocument.body);
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [file.contents, file.name, lineNumber]);

  return (
    <div
      ref={containerRef}
      style={FILE_PREVIEW_VIEW_STYLE}
      data-file-preview-line-number={lineNumber ?? undefined}
      className="overflow-hidden rounded-md border border-border/70"
    >
      <PierreFile file={file} options={options} selectedLines={selectedLines} />
    </div>
  );
}
