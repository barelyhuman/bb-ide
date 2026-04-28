import type { ViewWebFetchMessage, ViewWebSearchMessage } from "@bb/domain";
import { cn } from "../../cn.js";
import { COLLAPSIBLE_HEADER_STATIC_TONE_CLASS } from "../../disclosure.js";
import { EventTitle } from "./shared.js";

type WebActivityRowMessage = ViewWebSearchMessage | ViewWebFetchMessage;

interface WebActivityLabelArgs {
  completed: string;
  interrupted: string;
  pending: string;
}

interface WebActivityRowProps {
  message: WebActivityRowMessage;
  preferOngoingLabels?: boolean;
}

function getWebActivitySummaryDetail(message: WebActivityRowMessage): string {
  return message.kind === "web-search"
    ? (message.queries[0] ?? "the web")
    : message.url;
}

function getWebActivitySummaryLabel(
  message: WebActivityRowMessage,
  preferOngoingLabels: boolean,
): WebActivityLabelArgs {
  if (message.kind === "web-search") {
    return {
      completed: "Searched",
      interrupted: "Search interrupted",
      pending: "Searching",
    };
  }

  return {
    completed: "Fetched",
    interrupted: "Fetch interrupted",
    pending: "Fetching",
  };
}

function WebActivityRow({
  message,
  preferOngoingLabels = false,
}: WebActivityRowProps) {
  const labels = getWebActivitySummaryLabel(message, preferOngoingLabels);
  const isPending =
    message.status === "pending" ||
    (message.status !== "interrupted" && preferOngoingLabels);
  const prefix =
    message.status === "interrupted"
      ? labels.interrupted
      : isPending
        ? labels.pending
        : labels.completed;
  const summary = (
    <EventTitle
      prefix={prefix}
      detail={getWebActivitySummaryDetail(message)}
      shimmerPrefix={isPending}
    />
  );

  return (
    <div className="group w-full">
      <div className="mr-auto w-full">
        <div className="rounded-md px-2 py-1 text-sm text-muted-foreground">
          <div className={cn("py-0.5", COLLAPSIBLE_HEADER_STATIC_TONE_CLASS)}>
            {summary}
          </div>
        </div>
      </div>
    </div>
  );
}

interface WebSearchRowProps {
  message: ViewWebSearchMessage;
  preferOngoingLabels?: boolean;
}

export function WebSearchRow(props: WebSearchRowProps) {
  return <WebActivityRow {...props} />;
}

interface WebFetchRowProps {
  message: ViewWebFetchMessage;
  preferOngoingLabels?: boolean;
}

export function WebFetchRow(props: WebFetchRowProps) {
  return <WebActivityRow {...props} />;
}
