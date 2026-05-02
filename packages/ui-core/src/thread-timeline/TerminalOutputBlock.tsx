import { useMemo, type CSSProperties } from "react";
import Convert from "ansi-to-html";
import { cn } from "../primitives/cn.js";
import { getDetailScrollMaxHeightClass } from "../primitives/detail-scroll-size.js";
import { ExpandableLine } from "../primitives/expandable-line.js";
import { useStickyBottomScroll } from "./useStickyBottomScroll.js";

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

export function TerminalOutputBlock({
  commandLine,
  exitCode = null,
  maxHeightClassName = "max-h-96",
  metadataLines = [],
  output,
}: TerminalOutputBlockProps) {
  const outputText = output.trimEnd();
  const scrollContentKey = [
    commandLine ?? "",
    metadataLines.join("\n"),
    outputText,
    exitCode ?? "",
  ].join("\u0000");
  const outputScroll = useStickyBottomScroll<HTMLPreElement>({
    contentKey: scrollContentKey,
  });
  const renderedOutputHtml = useMemo(
    () => (outputText.length > 0 ? ANSI_TO_HTML.toHtml(outputText) : null),
    [outputText],
  );

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
            ref={outputScroll.ref}
            onPointerDown={outputScroll.onPointerDown}
            onScroll={outputScroll.onScroll}
            onTouchMove={outputScroll.onTouchMove}
            onTouchStart={outputScroll.onTouchStart}
            onWheel={outputScroll.onWheel}
            className={cn(
              commandLine || metadataLines.length > 0 ? "mt-1.5" : null,
              outputMaxHeightClassName,
              "overflow-auto whitespace-pre leading-tight text-foreground",
            )}
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
