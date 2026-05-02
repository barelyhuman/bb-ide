import { useEffect, useMemo, useRef } from "react";
import Convert from "ansi-to-html";
import { cn } from "../primitives/cn.js";

export interface TerminalOutputBlockProps {
  output: string;
  commandLine?: string;
  exitCode?: number | null;
  maxHeightClassName?: string;
  metadataLines?: readonly string[];
}

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
  const outputHtml = useMemo(() => ANSI_TO_HTML.toHtml(output), [output]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) {
      return;
    }
    scrollToBottom(element);
  }, [commandLine, metadataLines, outputHtml, exitCode]);

  const showExitCode =
    exitCode !== null && (exitCode !== 0 || output.trim().length === 0);

  return (
    <pre
      ref={scrollRef}
      className={cn(
        "overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/70 px-2 py-1.5 font-mono text-xs leading-tight text-muted-foreground",
        maxHeightClassName,
      )}
      onScroll={(event) => {
        shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
      }}
    >
      {commandLine ? (
        <>
          <span className="text-foreground/85">{commandLine}</span>
          {"\n"}
        </>
      ) : null}
      {metadataLines.map((line) => (
        <span key={line}>
          {line}
          {"\n"}
        </span>
      ))}
      {output.trim().length > 0 ? (
        <span dangerouslySetInnerHTML={{ __html: outputHtml }} />
      ) : null}
      {showExitCode ? (
        <>
          {output.trim().length > 0 ? "\n" : null}
          <span>exit code {exitCode}</span>
        </>
      ) : null}
    </pre>
  );
}
