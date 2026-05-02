import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import Convert from "ansi-to-html";
import { cn } from "../primitives/cn.js";
import { getDetailScrollMaxHeightClass } from "../primitives/detail-scroll-size.js";
import { ExpandableLine } from "../primitives/expandable-line.js";

export interface TerminalOutputBlockProps {
  output: string;
  commandLine?: string;
  exitCode?: number | null;
  maxHeightClassName?: string;
  metadataLines?: readonly string[];
}

const COMMAND_LINE_CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
};

const ANSI_TO_HTML = new Convert({
  escapeXML: true,
  newline: false,
  stream: false,
});

const STICKY_BOTTOM_THRESHOLD_PX = 4;

function isNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.clientHeight - element.scrollTop <=
    STICKY_BOTTOM_THRESHOLD_PX
  );
}

function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
}

export function TerminalOutputBlock({
  commandLine,
  exitCode = null,
  maxHeightClassName = "max-h-96",
  metadataLines = [],
  output,
}: TerminalOutputBlockProps) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const outputText = output.trimEnd();
  const renderedOutputHtml = useMemo(
    () => (outputText.length > 0 ? ANSI_TO_HTML.toHtml(outputText) : null),
    [outputText],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) {
      return;
    }
    scrollToBottom(element);
  }, [commandLine, metadataLines, renderedOutputHtml, exitCode]);

  const showExitCode = exitCode !== null;
  const outputMaxHeightClassName =
    maxHeightClassName === "max-h-96"
      ? getDetailScrollMaxHeightClass("regular")
      : maxHeightClassName;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-4 py-3 font-mono text-xs leading-tight text-foreground">
        {commandLine ? (
          <ExpandableLine
            fullText={commandLine}
            collapsedClassName="max-h-[2lh] overflow-hidden whitespace-pre-wrap break-words"
            collapsedStyle={COMMAND_LINE_CLAMP_STYLE}
            expandedClassName={cn(
              "overflow-auto whitespace-pre-wrap break-words",
              getDetailScrollMaxHeightClass("regular"),
            )}
          >
            {commandLine}
          </ExpandableLine>
        ) : null}
        {metadataLines.map((line) => (
          <div key={line} className="mt-1 text-muted-foreground">
            {line}
          </div>
        ))}
        {renderedOutputHtml ? (
          <pre
            ref={scrollRef}
            className={cn(
              commandLine || metadataLines.length > 0 ? "mt-1.5" : null,
              outputMaxHeightClassName,
              "overflow-auto whitespace-pre leading-tight text-foreground",
            )}
            onScroll={(event) => {
              shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
            }}
            dangerouslySetInnerHTML={{
              __html: renderedOutputHtml,
            }}
          />
        ) : null}
        {showExitCode ? (
          <div
            className={cn(
              renderedOutputHtml ? "mt-1.5" : commandLine ? "mt-1.5" : null,
              "font-mono text-xs leading-tight text-muted-foreground",
            )}
          >
            exit code {exitCode}
          </div>
        ) : null}
      </div>
    </div>
  );
}
