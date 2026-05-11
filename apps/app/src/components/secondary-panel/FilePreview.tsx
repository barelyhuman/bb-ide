import { type CSSProperties, useMemo } from "react";
import { File as PierreFile } from "@pierre/diffs/react";
import type { SupportedLanguages } from "@pierre/diffs";
import { FileX2 } from "lucide-react";
import { MarkdownPreview, Skeleton } from "@/components/ui";
import { usePreferredTheme } from "@/hooks/useTheme";

export interface FilePreviewFile {
  name: string;
  contents: string;
  lang?: SupportedLanguages;
}

export type FilePreviewState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; file: FilePreviewFile };

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
  if (state.kind === "error") {
    return <FilePreviewError />;
  }
  if (isMarkdownFile(state.file.name)) {
    return <MarkdownPreview content={state.file.contents} />;
  }
  return <FilePreviewCode file={state.file} />;
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

function FilePreviewError() {
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-background/45 px-3 py-8 text-sm text-muted-foreground"
    >
      <FileX2 className="size-3.5" />
      <span>Failed to load file</span>
    </div>
  );
}

function FilePreviewCode({ file }: { file: FilePreviewFile }) {
  const preferredTheme = usePreferredTheme();
  const options = useMemo(
    () => ({
      themeType: preferredTheme,
      overflow: "scroll" as const,
      disableFileHeader: true,
    }),
    [preferredTheme],
  );
  return (
    <div
      style={FILE_PREVIEW_VIEW_STYLE}
      className="overflow-hidden rounded-md border border-border/70"
    >
      <PierreFile file={file} options={options} />
    </div>
  );
}
