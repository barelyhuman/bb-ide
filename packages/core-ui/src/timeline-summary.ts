import type { TimelineToolGroupStatus } from "@bb/domain";

export interface ToolGroupSummaryParts {
  prefix: string;
  emphasis: string;
  suffix?: string;
}

export function formatToolGroupCountLabel(summaryCount: number): string {
  return `${summaryCount} item${summaryCount === 1 ? "" : "s"}`;
}

export function buildToolGroupSummaryParts({
  duration,
  status,
  summaryCount,
}: {
  duration: string | undefined;
  status: TimelineToolGroupStatus;
  summaryCount: number;
}): ToolGroupSummaryParts {
  const prefix = (() => {
    switch (status) {
      case "pending":
        return duration ? "Working for" : "Working on";
      case "error":
        return duration ? "Worked for" : "Worked on";
      case "interrupted":
        return duration ? "Stopped after" : "Stopped while working on";
      case "completed":
        return duration ? "Worked for" : "Worked on";
    }
  })();
  const countLabel = formatToolGroupCountLabel(summaryCount);

  if (duration) {
    return {
      prefix,
      emphasis: duration,
    };
  }

  return {
    prefix,
    emphasis: countLabel,
  };
}
