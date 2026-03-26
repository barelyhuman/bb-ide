import type { ViewTasksMessage } from "@bb/domain";
import { ExpandablePanel } from "../../disclosure.js";
import { useLatestInitialExpanded } from "../latestInitialExpanded.js";
import {
  EventTitle,
  ExpandableDetailScrollArea,
  getEventHeaderToneClass,
} from "./shared.js";

function taskStatusGlyph(status: ViewTasksMessage["tasks"][number]["status"]): string {
  switch (status) {
    case "completed":
      return "☒";
    case "active":
      return "◼";
    case "failed":
      return "⚠";
    case "pending":
      return "□";
  }
}

function statusLabel(message: ViewTasksMessage): string {
  switch (message.status) {
    case "pending":
      return "Updating";
    case "error":
      return "Failed";
    case "interrupted":
      return "Interrupted";
    case "completed":
      return "Updated";
  }
}

export function TasksRow({
  message,
  initialExpanded = false,
}: {
  message: ViewTasksMessage;
  initialExpanded?: boolean;
}) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(initialExpanded);
  const activeTask = message.tasks.find((task) => task.status === "active");
  const summaryContent = (
    <EventTitle
      prefix={statusLabel(message)}
      emphasis={activeTask?.text ?? `${message.tasks.length} tasks`}
      suffix={message.source === "todo" ? "todo list" : "plan"}
      tone={message.status === "error" ? "destructive" : "default"}
      shimmerPrefix={message.status === "pending"}
    />
  );

  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <ExpandablePanel
          isExpanded={isExpanded}
          summaryContent={summaryContent}
          headerToneClass={getEventHeaderToneClass(
            isExpanded,
            message.status === "error" ? "destructive" : "default",
          )}
          onToggle={onToggle}
        >
          <ExpandableDetailScrollArea className="mt-0.5 space-y-1">
            {message.tasks.map((task, index) => (
              <div
                key={`${message.id}:${index}`}
                className="grid grid-cols-[auto_1fr] gap-2 font-mono ui-text-sm text-foreground/85"
              >
                <span>{taskStatusGlyph(task.status)}</span>
                <span
                  className={
                    task.status === "completed"
                      ? "line-through text-muted-foreground"
                      : task.status === "active"
                        ? "font-semibold"
                        : ""
                  }
                >
                  {task.text}
                </span>
              </div>
            ))}
          </ExpandableDetailScrollArea>
        </ExpandablePanel>
      </div>
    </div>
  );
}
