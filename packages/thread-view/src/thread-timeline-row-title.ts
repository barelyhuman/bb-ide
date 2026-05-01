import type {
  TimelineAssistantStepSummaryRow,
  TimelineGroupedRowStatus,
  TimelineRow,
  TimelineToolBundleRow,
  TimelineTurnSummaryRow,
  ViewMessage,
} from "@bb/domain";
import { assertNever } from "./assert-never.js";
import { durationToCompactString } from "./format-helpers.js";
import { buildTimelineAssistantStepSummaryLabel } from "./timeline-assistant-step-summary.js";
import { buildToolBundleSummaryLabel } from "./timeline-tool-bundle-summary.js";
import { buildTurnSummaryParts } from "./timeline-turn-summary.js";
import { formatDelegationSummary } from "./timeline-render-helpers.js";

export interface ThreadTimelineRowTitle {
  plain: string;
}

export interface ThreadTimelineTitleContext {
  preferOngoingLabels: boolean;
}

function formatSummaryDuration(
  durationMs: number | null | undefined,
): string | undefined {
  if (durationMs === null || durationMs === undefined || durationMs < 1_000) {
    return undefined;
  }
  return durationToCompactString(durationMs);
}

function applyOngoingLabelPreference(
  status: TimelineGroupedRowStatus,
  context: ThreadTimelineTitleContext,
): TimelineGroupedRowStatus {
  if (context.preferOngoingLabels && status === "completed") {
    return "pending";
  }
  return status;
}

function getTimelineMessageRowTitle(
  message: ViewMessage,
): ThreadTimelineRowTitle {
  switch (message.kind) {
    case "user":
      return { plain: "User" };
    case "assistant-text":
      return { plain: "Assistant" };
    case "command":
      return { plain: "Tool Call: exec_command" };
    case "tool-call":
      return { plain: `Tool Call: ${message.toolName}` };
    case "file-edit":
      return { plain: "File Edit" };
    case "web-search":
      return { plain: `Searched ${message.queries[0] ?? "web search"}` };
    case "web-fetch":
      return { plain: `Fetched ${message.url}` };
    case "operation":
      return { plain: `Operation: ${message.title}` };
    case "permission-grant-lifecycle":
      return { plain: message.title };
    case "tasks":
      return { plain: "Updated tasks" };
    case "delegation": {
      const verb = message.status === "pending" ? "Running" : "Ran";
      return {
        plain: `${verb} subagent: ${formatDelegationSummary(message)}`,
      };
    }
    case "error":
      return { plain: "Error" };
    case "debug/raw-event":
      return { plain: "" };
    default:
      return assertNever(message);
  }
}

function getToolBundleRowTitle(
  row: TimelineToolBundleRow,
  context: ThreadTimelineTitleContext,
): ThreadTimelineRowTitle {
  return {
    plain: buildToolBundleSummaryLabel({
      ...row,
      status: applyOngoingLabelPreference(row.status, context),
    }),
  };
}

function getAssistantStepSummaryRowTitle(
  row: TimelineAssistantStepSummaryRow,
): ThreadTimelineRowTitle {
  return { plain: buildTimelineAssistantStepSummaryLabel(row.rows) };
}

function getTurnSummaryRowTitle(
  row: TimelineTurnSummaryRow,
  context: ThreadTimelineTitleContext,
): ThreadTimelineRowTitle {
  const duration = formatSummaryDuration(row.durationMs);
  const parts = buildTurnSummaryParts({
    duration,
    status: applyOngoingLabelPreference(row.status, context),
    summaryCount: row.summaryCount,
  });
  return { plain: `${parts.prefix} ${parts.emphasis}` };
}

export function getThreadTimelineRowTitle(
  row: TimelineRow,
  context: ThreadTimelineTitleContext,
): ThreadTimelineRowTitle {
  switch (row.kind) {
    case "message":
      return getTimelineMessageRowTitle(row.message);
    case "assistant-step-summary":
      return getAssistantStepSummaryRowTitle(row);
    case "tool-bundle":
      return getToolBundleRowTitle(row, context);
    case "turn-summary":
      return getTurnSummaryRowTitle(row, context);
    default:
      return assertNever(row);
  }
}
