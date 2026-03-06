import { useMemo, type CSSProperties } from "react";
import { ExpandablePanel } from "@beanbag/ui-core";
import type { UIToolCallMessage } from "@beanbag/agent-core";
import { getCollapsibleHeaderToneClass } from "@/components/messages/CollapsibleHeader";
import { ansiToHtml } from "@/lib/ansi";
import {
  EVENT_DETAIL_MAX_HEIGHT_CLASS,
  EVENT_LARGE_DETAIL_MAX_HEIGHT_CLASS,
  renderShimmeringSummary,
  useLatestInitialExpanded,
  useStickyBottomAutoScroll,
} from "./shared";

const COMMAND_LINE_CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
};

export function ToolCallRow({
  message,
  initialExpanded = false,
  preferOngoingLabels = false,
}: {
  message: UIToolCallMessage;
  initialExpanded?: boolean;
  preferOngoingLabels?: boolean;
}) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(initialExpanded);
  const command = message.command ?? message.toolName;
  const outputText = message.output && message.output.length > 0 ? message.output : "(no output)";
  const { elementRef: outputRef, handleScroll: handleOutputScroll } =
    useStickyBottomAutoScroll<HTMLPreElement>({
      isExpanded,
      scrollDep: outputText,
    });
  const renderedOutput = useMemo(() => ansiToHtml(outputText), [outputText]);
  const actionLabel =
    message.status === "error"
      ? "Failed"
      : message.status === "interrupted"
        ? "Declined"
        : message.status === "pending" || preferOngoingLabels
          ? "Running"
          : "Ran";
  const isRunning = actionLabel === "Running";
  const summaryText = isExpanded ? `${actionLabel} command` : `${actionLabel} ${command}`;
  const summaryContent = renderShimmeringSummary(summaryText, isRunning);
  const headerToneClass = getCollapsibleHeaderToneClass(isExpanded);

  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <ExpandablePanel
          isExpanded={isExpanded}
          summaryContent={summaryContent}
          headerToneClass={headerToneClass}
          onToggle={onToggle}
        >
          <div className={`${EVENT_LARGE_DETAIL_MAX_HEIGHT_CLASS} overflow-hidden rounded-lg border border-border bg-card`}>
            <div className="px-4 py-3 font-mono ui-text-sm leading-tight text-foreground">
              <div
                className="overflow-hidden whitespace-pre-wrap break-words leading-tight"
                style={COMMAND_LINE_CLAMP_STYLE}
                title={`$ ${command}`}
              >
                $ {command}
              </div>
              <pre
                ref={outputRef}
                onScroll={handleOutputScroll}
                className={`mt-1.5 ${EVENT_DETAIL_MAX_HEIGHT_CLASS} overflow-auto whitespace-pre-wrap break-words leading-tight text-muted-foreground`}
                dangerouslySetInnerHTML={{ __html: renderedOutput }}
              >
              </pre>
            </div>
          </div>
        </ExpandablePanel>
      </div>
    </div>
  );
}
