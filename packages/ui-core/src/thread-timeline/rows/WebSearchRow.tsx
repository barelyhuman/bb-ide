import type { ViewWebFetchMessage, ViewWebSearchMessage } from "@bb/domain";
import {
  getThreadTimelineRowTitle,
  type ThreadTimelineRowTitle,
} from "@bb/thread-view";
import { cn } from "../../cn.js";
import { COLLAPSIBLE_HEADER_STATIC_TONE_CLASS } from "../../disclosure.js";
import { EventTitle } from "./shared.js";

type WebActivityRowMessage = ViewWebSearchMessage | ViewWebFetchMessage;

interface WebActivityRowProps {
  message: WebActivityRowMessage;
}

function renderWebActivityTitle(
  title: ThreadTimelineRowTitle,
  isPending: boolean,
) {
  switch (title.rich.kind) {
    case "plain":
      return <EventTitle prefix={title.rich.text} shimmerPrefix={isPending} />;
    case "prefixed":
      return (
        <EventTitle
          prefix={title.rich.prefix}
          detail={title.rich.content}
          shimmerPrefix={isPending}
        />
      );
  }
}

function WebActivityRow({ message }: WebActivityRowProps) {
  const title = getThreadTimelineRowTitle(
    {
      kind: "message",
      id: message.id,
      message,
    },
    {
      preferOngoingLabels: false,
    },
  );
  const isPending = message.status === "pending";
  const summary = renderWebActivityTitle(title, isPending);

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
}

export function WebSearchRow(props: WebSearchRowProps) {
  return <WebActivityRow {...props} />;
}

interface WebFetchRowProps {
  message: ViewWebFetchMessage;
}

export function WebFetchRow(props: WebFetchRowProps) {
  return <WebActivityRow {...props} />;
}
