import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CodeView as PierreCodeView } from "@pierre/diffs/react";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type {
  CodeViewItem,
  CodeViewLineSelection,
  CodeViewOptions,
  CodeViewScrollTarget,
  SelectedLineRange,
  SupportedLanguages,
} from "@pierre/diffs";
import type { UrlTransform } from "react-markdown";
import { Button } from "@/components/ui/button.js";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { CopyButton } from "@/components/ui/copy-button.js";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { usePreferredTheme } from "@/hooks/useTheme";
import type {
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import { cn } from "@/lib/utils";

export interface FilePreviewFile {
  name: string;
  contents: string;
  lang?: SupportedLanguages;
}

export type IframePreviewSandbox = "allow-scripts";

export interface IframeFilePreviewTarget {
  sandbox: IframePreviewSandbox | null;
  title: string;
  url: string;
}

export type FilePreviewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "not-found" }
  | { kind: "error"; message?: string }
  | { kind: "image"; url: string }
  | ({ kind: "iframe" } & IframeFilePreviewTarget)
  | {
      kind: "html";
      file: FilePreviewFile;
      iframe: IframeFilePreviewTarget;
      lineRange: FilePreviewLineRange | null;
    }
  | {
      kind: "ready";
      file: FilePreviewFile;
      lineRange: FilePreviewLineRange | null;
      showMarkdownModeToggle: boolean;
      markdownUrlTransform?: UrlTransform;
    };

export interface FilePreviewProps {
  state: FilePreviewState;
  path: string;
  copyPath?: string | null;
  headerMode?: FilePreviewHeaderMode;
  onOpenInEditor?: (path: string) => void;
  markdownLinkRouting?: MarkdownLinkRouting;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface FilePreviewBodyProps {
  state: FilePreviewState;
  path: string;
  viewMode: FilePreviewViewMode;
  markdownLinkRouting?: MarkdownLinkRouting;
}

interface FilePreviewHeaderProps {
  path: string;
  copyPath: string | null;
  onOpenInEditor?: (path: string) => void;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  toggleKind: FilePreviewToggleKind | null;
  viewMode: FilePreviewViewMode;
  onViewModeChange: (mode: FilePreviewViewMode) => void;
}

interface MarkdownFilePreviewProps {
  file: FilePreviewFile;
  urlTransform?: UrlTransform;
  markdownLinkRouting?: MarkdownLinkRouting;
}

interface FilePreviewImageProps {
  url: string;
  alt: string;
}

interface FilePreviewMessageProps {
  message: string;
  role?: "alert";
}

interface FilePreviewCodeProps {
  file: FilePreviewFile;
  lineRange: FilePreviewLineRange | null;
}

interface BuildCodeViewFileVersionArgs {
  contents: string;
  lang: SupportedLanguages | undefined;
  name: string;
}

type FilePreviewViewMode = "preview" | "source";
type FilePreviewToggleKind = "html" | "markdown";
export type FilePreviewHeaderMode = "file" | "none";
type IframeLoadState = "loading" | "loaded" | "error";

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "mdx",
  "markdown",
]);

const FILE_PREVIEW_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
  // Pierre paints its theme bg inside this gap, so the top breathing room of
  // the code body lives on Pierre's bg — not on the panel's bg-background.
  // Without this, the gap above Pierre would show a visible bg-color seam.
  "--diffs-gap-block": "16px",
} as CSSProperties;

const FILE_PREVIEW_CODE_VIEW_STYLE = {
  ...FILE_PREVIEW_VIEW_STYLE,
  height: "100%",
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
} as CSSProperties;

// `--md-content-w` tells MarkdownPreview the surrounding text-column width so
// narrow tables sit flush with the prose on the left instead of centering in
// the panel. `100cqi` resolves against the `@container/page` scope on the
// wrapper below — i.e. the panel width.
const FILE_PREVIEW_WRAPPER_STYLE = {
  "--md-content-w": "100cqi",
} as CSSProperties;

const HTML_FILE_PREVIEW_IFRAME_STYLE = {
  width: "100%",
  height: "100%",
  border: 0,
} as CSSProperties;
const IFRAME_LOADING_INDICATOR_DELAY_MS = 160;
const FILE_PREVIEW_CODE_VIEW_ITEM_ID = "file-preview";

function isMarkdownFile(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension !== undefined && MARKDOWN_EXTENSIONS.has(extension);
}

function getFilePreviewToggleKind(
  state: FilePreviewState,
): FilePreviewToggleKind | null {
  if (state.kind === "html") {
    return "html";
  }
  if (
    state.kind === "ready" &&
    state.showMarkdownModeToggle &&
    isMarkdownFile(state.file.name)
  ) {
    return "markdown";
  }
  return null;
}

function getToggleAriaLabel(kind: FilePreviewToggleKind): string {
  return kind === "html" ? "HTML view mode" : "Markdown view mode";
}

function getRawToggleTitle(kind: FilePreviewToggleKind): string {
  return kind === "html" ? "HTML source" : "Markdown source";
}

function getFilePreviewLineRange(
  state: FilePreviewState,
): FilePreviewLineRange | null {
  if (state.kind === "html" || state.kind === "ready") {
    return state.lineRange;
  }
  return null;
}

function usesCodeViewLayout(
  state: FilePreviewState,
  viewMode: FilePreviewViewMode,
): boolean {
  if (state.kind === "html") {
    return viewMode === "source";
  }

  if (state.kind !== "ready") {
    return false;
  }

  return !isMarkdownFile(state.file.name) || viewMode === "source";
}

export function FilePreview({
  state,
  path,
  copyPath = null,
  headerMode = "file",
  onOpenInEditor,
  markdownLinkRouting,
  statusLabel = null,
}: FilePreviewProps) {
  const toggleKind = getFilePreviewToggleKind(state);
  const filePreviewLineRange = getFilePreviewLineRange(state);
  const [viewMode, setViewMode] = useState<FilePreviewViewMode>(
    filePreviewLineRange === null ? "preview" : "source",
  );
  // Each new file opens in rendered preview by default; the user re-toggles per
  // file rather than carrying their last choice across unrelated files.
  useEffect(() => {
    setViewMode(filePreviewLineRange === null ? "preview" : "source");
  }, [filePreviewLineRange, path]);

  const usesIframeLayout =
    state.kind === "iframe" ||
    (state.kind === "html" && viewMode === "preview");
  const usesFullHeightLayout =
    usesIframeLayout || usesCodeViewLayout(state, viewMode);

  // Establish a `@container/page` scope so MarkdownPreview's `100cqw`-based
  // table breakout sizes against this panel, not the viewport.
  return (
    <div
      className={
        usesFullHeightLayout
          ? "@container/page flex h-full min-h-0 flex-col"
          : "@container/page"
      }
      style={FILE_PREVIEW_WRAPPER_STYLE}
    >
      {headerMode === "file" ? (
        <FilePreviewHeader
          path={path}
          copyPath={copyPath}
          onOpenInEditor={onOpenInEditor}
          statusLabel={statusLabel}
          toggleKind={toggleKind}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      ) : null}
      <FilePreviewBody
        state={state}
        path={path}
        viewMode={toggleKind === null ? "preview" : viewMode}
        markdownLinkRouting={markdownLinkRouting}
      />
    </div>
  );
}

function FilePreviewBody({
  state,
  path,
  viewMode,
  markdownLinkRouting,
}: FilePreviewBodyProps) {
  if (state.kind === "loading") {
    return <FilePreviewLoading />;
  }
  if (state.kind === "empty") {
    return <FilePreviewMessage message="Empty file." />;
  }
  if (state.kind === "not-found") {
    return <FilePreviewMessage message="File not found." role="alert" />;
  }
  if (state.kind === "error") {
    return (
      <FilePreviewMessage
        message={state.message ?? "Failed to load file"}
        role={state.message === undefined ? "alert" : undefined}
      />
    );
  }
  if (state.kind === "image") {
    return <FilePreviewImage url={state.url} alt={path} />;
  }
  if (state.kind === "iframe") {
    return (
      <IframeFilePreview
        sandbox={state.sandbox}
        title={state.title}
        url={state.url}
      />
    );
  }
  if (state.kind === "html") {
    if (viewMode === "preview") {
      return (
        <IframeFilePreview
          sandbox={state.iframe.sandbox}
          title={state.iframe.title}
          url={state.iframe.url}
        />
      );
    }
    return <FilePreviewCode file={state.file} lineRange={state.lineRange} />;
  }
  if (isMarkdownFile(state.file.name) && viewMode === "preview") {
    return (
      <MarkdownFilePreview
        file={state.file}
        urlTransform={state.markdownUrlTransform}
        markdownLinkRouting={markdownLinkRouting}
      />
    );
  }
  return (
    <FilePreviewCode file={state.file} lineRange={state.lineRange ?? null} />
  );
}

function FilePreviewHeader({
  path,
  copyPath,
  onOpenInEditor,
  statusLabel,
  toggleKind,
  viewMode,
  onViewModeChange,
}: FilePreviewHeaderProps) {
  // The fade is `absolute top-full` so the bar's bottom border is the actual
  // overflow edge — content scrolls under right at the border. The fade lives
  // in the sticky element so it pins with the header, but `absolute` keeps it
  // out of flow so the body's `pt-4` controls the initial gap, not this strip.
  return (
    <div className="sticky top-0 z-10">
      <div className="flex h-9 items-center gap-2 border-b border-border-seam bg-background px-4">
        <div className="flex min-w-0 items-center gap-1">
          <TruncateStart
            className={cn(
              "min-w-0 font-mono font-medium leading-5 text-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
            title={path}
          >
            {path}
          </TruncateStart>
          {statusLabel === null ? null : (
            <span
              className={cn(
                "shrink-0 leading-5 text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              ({statusLabel})
            </span>
          )}
          {copyPath === null ? null : (
            <CopyButton
              text={copyPath}
              label="Copy file path"
              className="shrink-0 rounded-md hover:bg-state-hover hover:text-foreground"
            />
          )}
          {onOpenInEditor ? (
            <OpenInEditorButton onClick={() => onOpenInEditor(path)} />
          ) : null}
        </div>
        {toggleKind !== null ? (
          <div
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5"
            role="tablist"
            aria-label={getToggleAriaLabel(toggleKind)}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-5 rounded-sm px-2 text-muted-foreground max-md:pointer-coarse:h-9",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
              onClick={() => onViewModeChange("preview")}
              aria-pressed={viewMode === "preview"}
              title="Rendered preview"
            >
              Preview
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-5 rounded-sm px-2 text-muted-foreground max-md:pointer-coarse:h-9",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
              onClick={() => onViewModeChange("source")}
              aria-pressed={viewMode === "source"}
              title={getRawToggleTitle(toggleKind)}
            >
              Raw
            </Button>
          </div>
        ) : null}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background to-transparent"
      />
    </div>
  );
}

function MarkdownFilePreview({
  file,
  urlTransform,
  markdownLinkRouting,
}: MarkdownFilePreviewProps) {
  return (
    <div className="px-4 pt-4">
      <MarkdownPreview
        allowHtml
        content={file.contents}
        urlTransform={urlTransform}
        linkRouting={markdownLinkRouting}
      />
    </div>
  );
}

function FilePreviewImage({ url, alt }: FilePreviewImageProps) {
  return (
    <div className="pt-4">
      <img
        src={url}
        alt={alt}
        className="block max-h-[34rem] w-full object-contain"
      />
    </div>
  );
}

function IframeFilePreview({ sandbox, title, url }: IframeFilePreviewTarget) {
  const [loadState, setLoadState] = useState<IframeLoadState>("loading");
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);

  useEffect(() => {
    setLoadState("loading");
  }, [url]);

  useEffect(() => {
    if (loadState !== "loading") {
      setShowLoadingIndicator(false);
      return;
    }

    setShowLoadingIndicator(false);
    const timeoutId = window.setTimeout(() => {
      setShowLoadingIndicator(true);
    }, IFRAME_LOADING_INDICATOR_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadState, url]);

  if (loadState === "error") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <FilePreviewMessage
          message="Failed to load HTML preview."
          role="alert"
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {loadState === "loading" && showLoadingIndicator ? (
        <div className="absolute inset-x-0 top-0 z-10">
          <FilePreviewLoading />
        </div>
      ) : null}
      <iframe
        title={title}
        src={url}
        sandbox={sandbox === null ? undefined : sandbox}
        style={HTML_FILE_PREVIEW_IFRAME_STYLE}
        onLoad={() => setLoadState("loaded")}
        onError={() => setLoadState("error")}
      />
    </div>
  );
}

function FilePreviewLoading() {
  return (
    <div className="space-y-2 px-4 pt-4" aria-busy>
      <Skeleton className="h-3 w-3/4 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-3/5 rounded-sm" />
    </div>
  );
}

function FilePreviewMessage({ message, role }: FilePreviewMessageProps) {
  return (
    <EmptyStatePanel role={role} className="mx-4 mt-4 rounded-lg">
      {message}
    </EmptyStatePanel>
  );
}

function buildCodeViewFileVersion({
  contents,
  lang,
  name,
}: BuildCodeViewFileVersionArgs): number {
  const input = `${name}\u0000${lang ?? ""}\u0000${contents}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(index)) | 0;
  }
  return hash;
}

function FilePreviewCode({ file, lineRange }: FilePreviewCodeProps) {
  const preferredTheme = usePreferredTheme();
  const codeViewRef = useRef<CodeViewHandle<undefined> | null>(null);
  const fileVersion = useMemo(
    () =>
      buildCodeViewFileVersion({
        contents: file.contents,
        lang: file.lang,
        name: file.name,
      }),
    [file.contents, file.lang, file.name],
  );
  const options = useMemo<CodeViewOptions<undefined>>(
    () => ({
      themeType: preferredTheme,
      overflow: "scroll",
      disableFileHeader: true,
      enableLineSelection: lineRange !== null,
      controlledSelection: true,
      layout: {
        paddingTop: 0,
        paddingBottom: 0,
        gap: 0,
      },
    }),
    [lineRange, preferredTheme],
  );
  const selectedRange = useMemo<SelectedLineRange | null>(
    () =>
      lineRange === null
        ? null
        : {
            start: lineRange.startLineNumber,
            end: lineRange.endLineNumber,
          },
    [lineRange],
  );
  const selectedLines = useMemo<CodeViewLineSelection | null>(
    () =>
      selectedRange === null
        ? null
        : {
            id: FILE_PREVIEW_CODE_VIEW_ITEM_ID,
            range: selectedRange,
          },
    [selectedRange],
  );
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => [
      {
        id: FILE_PREVIEW_CODE_VIEW_ITEM_ID,
        type: "file",
        file,
        version: fileVersion,
      },
    ],
    [file, fileVersion],
  );

  useEffect(() => {
    if (selectedRange === null) {
      return;
    }

    const scrollTarget: CodeViewScrollTarget = {
      type: "range",
      id: FILE_PREVIEW_CODE_VIEW_ITEM_ID,
      range: selectedRange,
      align: "start",
    };
    codeViewRef.current?.scrollTo(scrollTarget);
  }, [fileVersion, selectedRange]);

  return (
    <PierreCodeView
      ref={codeViewRef}
      className="min-h-0 flex-1"
      style={FILE_PREVIEW_CODE_VIEW_STYLE}
      items={items}
      options={options}
      selectedLines={selectedLines}
    />
  );
}
