import type { ViewToolCallMessage } from "@bb/domain";
import { ExpandablePanel } from "../../disclosure.js";
import { useLatestInitialExpanded } from "../latestInitialExpanded.js";
import {
  EventTitle,
  formatSummaryDuration,
  getEventHeaderToneClass,
} from "./shared.js";
import { TerminalOutputBlock } from "./TerminalOutputBlock.js";

function getToolCallTone(message: ViewToolCallMessage): "default" | "destructive" {
  // Shell command rows are common, and failed commands should read like regular
  // command history rather than error alerts. Keep destructive tone for any future
  // non-shell tool rows that may still need stronger emphasis.
  if (message.toolName === "exec_command") return "default";
  return message.status === "error" ? "destructive" : "default";
}

function toolCallActionLabel(
  message: ViewToolCallMessage,
  preferRunningLabel: boolean,
): string {
  if (message.approvalStatus === "waiting_for_approval") {
    return "Waiting for approval to run";
  }
  if (message.approvalStatus === "denied") {
    return "Permission denied:";
  }
  if (message.status === "error") return "Failed";
  if (message.status === "interrupted") return "Interrupted";
  if (message.status === "pending" || preferRunningLabel) return "Running";
  return "Ran";
}

export function ToolCallRow({
  message,
  initialExpanded = false,
  preferOngoingLabels = false,
}: {
  message: ViewToolCallMessage;
  initialExpanded?: boolean;
  preferOngoingLabels?: boolean;
}) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(initialExpanded);
  const command = message.command ?? message.toolName;
  const outputText = message.output && message.output.length > 0 ? message.output : "(no output)";
  const preferRunningLabel = preferOngoingLabels && message.status === "completed";
  const actionLabel = toolCallActionLabel(message, preferRunningLabel);
  const duration = formatSummaryDuration(message.durationMs);
  const isRunning =
    message.approvalStatus !== "denied" &&
    (message.status === "pending" || preferRunningLabel);
  const tone = getToolCallTone(message);
  const summaryContent = (
    <EventTitle
      prefix={actionLabel}
      detail={command}
      suffix={duration}
      tone={tone}
      shimmerPrefix={isRunning}
    />
  );
  const headerToneClass = getEventHeaderToneClass(isExpanded, tone);

  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <ExpandablePanel
          isExpanded={isExpanded}
          summaryContent={summaryContent}
          headerToneClass={headerToneClass}
          onToggle={onToggle}
        >
          <TerminalOutputBlock
            command={command}
            outputText={outputText}
            isExpanded={isExpanded}
          />
        </ExpandablePanel>
      </div>
    </div>
  );
}
