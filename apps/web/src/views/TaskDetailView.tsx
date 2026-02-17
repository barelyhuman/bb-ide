import { useMemo, useState } from "react";
import type {
  TaskEvent,
  TaskStatus,
  Thread,
  ThreadEvent,
  UIMessage,
} from "@beanbag/core";
import { ChevronDown } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PromptBox } from "@/components/promptbox/PromptBox";
import { ConversationEntry } from "@/components/messages/ConversationEntry";
import {
  CollapsibleHeader,
  COLLAPSIBLE_HEADER_TEXT_CLASS,
  getCollapsibleHeaderToneClass,
} from "@/components/messages/CollapsibleHeader";
import { ConversationWorkingIndicator } from "@/components/messages/ConversationWorkingIndicator";
import { PageShell } from "@/components/layout/PageShell";
import {
  DetailCard,
  DetailMessageRow,
  DetailRow,
} from "@/components/shared/DetailCard";
import { TaskAssigneeSelector } from "@/components/tasks/TaskAssigneeSelector";
import {
  useSetTaskAssignee,
  useTask,
  useTaskChat,
  useTaskEvents,
  useRoles,
  useThreadEventsBatch,
  useThreads,
  useUpdateTask,
} from "@/hooks/useApi";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { usePromptFileMentions } from "@/hooks/usePromptFileMentions";
import { formatRelativeTime, formatSnakeCaseLabel } from "@/lib/formatting";

const TASK_STATUS_OPTIONS: TaskStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "closed",
];

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function summarizeTaskEvent(event: TaskEvent): string {
  switch (event.type) {
    case "task.created":
      return "Task created";
    case "task.updated.title":
      return "Updated title";
    case "task.updated.description":
      return "Updated description";
    case "task.updated.status":
      return `Updated status to ${formatSnakeCaseLabel(event.data.status)}`;
    case "task.assigned":
      if (event.data.assignee.length > 0) {
        return `Assigned to ${event.data.assignee}`;
      }
      return "Task assigned";
    case "task.archived":
      return "Task archived";
    case "task.dependency_added":
    case "task.dependency_removed": {
      const action = event.type === "task.dependency_added" ? "Added" : "Removed";
      return `${action} ${event.data.type} dependency on ${event.data.dependsOnTaskId.slice(0, 8)}`;
    }
    case "task.chat.message":
      if (event.data.fromThreadId === null) {
        return "User sent a message";
      }
      return `Thread ${event.data.fromThreadId.slice(0, 8)} sent a message`;
    case "task.chat.thread_created":
      return "Created primary thread";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getStringField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractTurnIdFromThreadEventData(data: unknown): string | undefined {
  const root = asRecord(data);
  if (!root) return undefined;

  const direct =
    getStringField(root, "turnId") ??
    getStringField(root, "turn_id");
  if (direct) return direct;

  const turn = asRecord(root.turn);
  const turnId = getStringField(turn, "id");
  if (turnId) return turnId;

  const msg = asRecord(root.msg);
  const msgTurnId =
    getStringField(msg, "turn_id") ??
    getStringField(msg, "turnId");
  if (msgTurnId) return msgTurnId;

  const payload = asRecord(root.payload);
  if (!payload) return undefined;
  return (
    getStringField(payload, "turnId") ??
    getStringField(payload, "turn_id") ??
    getStringField(asRecord(payload.turn), "id") ??
    getStringField(asRecord(payload.msg), "turn_id") ??
    getStringField(asRecord(payload.msg), "turnId")
  );
}

function extractAgentMessageText(event: ThreadEvent): string | undefined {
  if (event.type !== "item/completed") return undefined;
  const payload = asRecord(event.data);
  const item = asRecord(payload?.item);
  if (!item || item.type !== "agentMessage") return undefined;
  return typeof item.text === "string" && item.text.trim().length > 0
    ? item.text
    : undefined;
}

function toPrimaryThreadTurnMessages(
  thread: Thread,
  events: ThreadEvent[],
): UIMessage[] {
  const sortedEvents = events.slice().sort((a, b) => a.seq - b.seq);
  const lastAgentMessageByTurn = new Map<
    string,
    { seq: number; createdAt: number; text: string }
  >();

  for (const event of sortedEvents) {
    const text = extractAgentMessageText(event);
    if (!text) continue;
    const turnId = extractTurnIdFromThreadEventData(event.data) ?? `seq:${event.seq}`;
    lastAgentMessageByTurn.set(turnId, {
      seq: event.seq,
      createdAt: event.createdAt,
      text,
    });
  }

  return Array.from(lastAgentMessageByTurn.values())
    .sort((a, b) => (a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt - b.createdAt))
    .map((entry) => ({
      kind: "assistant-text" as const,
      id: `primary-thread-turn:${thread.id}:${entry.seq}`,
      threadId: thread.id,
      sourceSeqStart: entry.seq,
      sourceSeqEnd: entry.seq,
      createdAt: entry.createdAt,
      text: entry.text,
      status: "completed" as const,
    }));
}

type TaskEventRow =
  | {
      kind: "status-updated";
      event: TaskEvent;
      fromStatus?: TaskStatus;
      toStatus: TaskStatus;
    }
  | {
      kind: "title-updated";
      event: TaskEvent;
      fromTitle?: string;
      toTitle: string;
    }
  | {
      kind: "created";
      event: TaskEvent;
      createdTitle?: string;
    }
  | {
      kind: "generic";
      event: TaskEvent;
    };

type TaskActivityRow =
  | {
      kind: "task-event";
      id: string;
      createdAt: number;
      order: number;
      row: TaskEventRow;
    }
  | {
      kind: "task-chat-message";
      id: string;
      createdAt: number;
      order: number;
      message: UIMessage;
    }
  | {
      kind: "agent-message";
      id: string;
      createdAt: number;
      order: number;
      message: UIMessage;
    };

function toTaskChatActivityMessage(event: TaskEvent): UIMessage | null {
  if (event.type !== "task.chat.message") return null;

  const text =
    event.data.message.trim().length > 0 ? event.data.message : "(no text)";

  if (event.data.fromThreadId === null) {
    return {
      kind: "user",
      id: `task-chat:user:${event.id}`,
      threadId: `task-${event.taskId}`,
      sourceSeqStart: event.seq,
      sourceSeqEnd: event.seq,
      createdAt: event.createdAt,
      text,
    };
  }

  return {
    kind: "assistant-text",
    id: `task-chat:thread:${event.id}`,
    threadId: event.data.fromThreadId,
    sourceSeqStart: event.seq,
    sourceSeqEnd: event.seq,
    createdAt: event.createdAt,
    text,
    status: "completed",
  };
}

function buildTaskEventRows(events: TaskEvent[]): TaskEventRow[] {
  let inferredStatus: TaskStatus = "open";
  let inferredTitle: string | undefined;

  return events.map((event) => {
    if (event.type === "task.created") {
      const createdTitle =
        event.data.title.trim().length > 0
          ? event.data.title
          : undefined;
      if (createdTitle) inferredTitle = createdTitle;
      inferredStatus = "open";
      return {
        kind: "created",
        event,
        createdTitle,
      };
    }

    if (event.type === "task.updated.status") {
      const row: TaskEventRow = {
        kind: "status-updated",
        event,
        fromStatus: inferredStatus,
        toStatus: event.data.status,
      };
      inferredStatus = event.data.status;
      return row;
    }

    if (event.type === "task.updated.title") {
      const nextTitle =
        event.data.title.trim().length > 0 ? event.data.title : undefined;
      if (nextTitle) {
        const row: TaskEventRow = {
          kind: "title-updated",
          event,
          fromTitle: inferredTitle,
          toTitle: nextTitle,
        };
        inferredTitle = nextTitle;
        return row;
      }
    }

    if (event.type === "task.assigned" && inferredStatus === "open") {
      inferredStatus = "in_progress";
    }

    return {
      kind: "generic",
      event,
    };
  });
}

function buildTaskEventDetailLine(row: TaskEventRow): string {
  if (row.kind === "status-updated") {
    return `From ${formatSnakeCaseLabel(row.fromStatus ?? row.toStatus)}`;
  }

  if (row.kind === "title-updated") {
    if (row.fromTitle && row.fromTitle.trim().length > 0) {
      return `From ${row.fromTitle} to ${row.toTitle}`;
    }
    return `Set title to ${row.toTitle}`;
  }

  if (row.kind === "created") {
    return row.createdTitle
      ? `Title ${row.createdTitle}`
      : `Created ${formatDate(row.event.createdAt)}`;
  }

  switch (row.event.type) {
    case "task.assigned":
      if (row.event.data.assignee.length > 0) {
        return `Assigned to ${row.event.data.assignee}`;
      }
      return "Task assigned";
    case "task.dependency_added":
    case "task.dependency_removed": {
      const action = row.event.type === "task.dependency_added" ? "Added" : "Removed";
      return `${action} ${row.event.data.type} dependency on ${row.event.data.dependsOnTaskId.slice(0, 8)}`;
    }
    case "task.chat.message":
      if (row.event.data.fromThreadId === null) {
        return `User: ${row.event.data.message.trim().length > 0 ? row.event.data.message : "(no text)"}`;
      }
      return `Thread ${row.event.data.fromThreadId}: ${row.event.data.message.trim().length > 0 ? row.event.data.message : "(no text)"}`;
    case "task.chat.thread_created":
      return row.event.data.threadId.length > 0
        ? `Created primary thread ${row.event.data.threadId}`
        : "Created primary thread";
    case "task.updated.title":
      return `Set title to ${row.event.data.title}`;
    case "task.updated.description":
      return row.event.data.description.trim().length > 0
        ? row.event.data.description
        : "Cleared description";
    case "task.updated.status":
      return row.event.data.closeReason
        ? `Set status to ${formatSnakeCaseLabel(row.event.data.status)} (${row.event.data.closeReason})`
        : `Set status to ${formatSnakeCaseLabel(row.event.data.status)}`;
    case "task.archived":
      return `Archived at ${formatDate(row.event.data.archivedAt)}`;
    case "task.created":
      return "Task created";
  }
}

function isNonExpandableTaskEventRow(row: TaskEventRow): boolean {
  if (row.kind !== "generic") return false;
  return (
    row.event.type === "task.assigned" ||
    row.event.type === "task.dependency_added" ||
    row.event.type === "task.dependency_removed" ||
    row.event.type === "task.chat.thread_created"
  );
}

function TaskEventLogEntry({
  row,
  roleNameById,
  threadDisplayNameById,
  projectId,
}: {
  row: TaskEventRow;
  roleNameById: Map<string, string>;
  threadDisplayNameById: Map<string, string>;
  projectId: string;
}) {
  const event = row.event;
  const [isExpanded, setIsExpanded] = useState(false);
  const isAssigneeEvent = row.kind === "generic" && event.type === "task.assigned";
  const isThreadCreatedEvent =
    row.kind === "generic" && event.type === "task.chat.thread_created";
  const isExpandable = !isNonExpandableTaskEventRow(row);
  const headerToneClass = getCollapsibleHeaderToneClass(isExpanded);
  const relativeTime = formatRelativeTime(event.createdAt);

  const assigneeRoleName =
    isAssigneeEvent && event.data.assignee.length > 0
      ? roleNameById.get(event.data.assignee) ?? event.data.assignee
      : null;
  const createdThreadDisplayName =
    isThreadCreatedEvent && event.data.threadId.length > 0
      ? threadDisplayNameById.get(event.data.threadId) ?? event.data.threadId
      : null;

  const summaryContent =
    isAssigneeEvent && assigneeRoleName ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground/90">Assigned to</span>
        <Link
          to={`/roles/${encodeURIComponent(event.data.assignee)}`}
          className="min-w-0 truncate text-foreground/95 underline underline-offset-2 hover:no-underline"
        >
          {assigneeRoleName}
        </Link>
        <span className="shrink-0 text-muted-foreground/80">· {relativeTime}</span>
      </span>
    ) : isThreadCreatedEvent && createdThreadDisplayName ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground/90">Created primary thread</span>
        <Link
          to={`/projects/${projectId}/threads/${event.data.threadId}`}
          className="min-w-0 truncate text-foreground/95 underline underline-offset-2 hover:no-underline"
        >
          {createdThreadDisplayName}
        </Link>
        <span className="shrink-0 text-muted-foreground/80">· {relativeTime}</span>
      </span>
    ) : isThreadCreatedEvent ? (
      `Created primary thread · ${relativeTime}`
    ) : row.kind === "status-updated" ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground/90">Updated status to</span>
        <span className="truncate font-semibold text-foreground/95">
          {formatSnakeCaseLabel(row.toStatus)}
        </span>
        <span className="shrink-0 text-muted-foreground/80">· {relativeTime}</span>
      </span>
    ) : row.kind === "title-updated" ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground/90">Updated title to</span>
        <span className="truncate font-semibold text-foreground/95">
          {row.toTitle}
        </span>
        <span className="shrink-0 text-muted-foreground/80">· {relativeTime}</span>
      </span>
    ) : row.kind === "created" ? (
      `Task created · ${relativeTime}`
    ) : (
      `${summarizeTaskEvent(event)} · ${relativeTime}`
    );
  const expandedDetail = isExpandable ? buildTaskEventDetailLine(row) : null;

  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <div className="rounded-md text-muted-foreground">
          <div className={isExpanded ? "px-2 pb-0 pt-1" : "px-2 py-1"}>
            {isExpandable ? (
              <CollapsibleHeader
                isExpanded={isExpanded}
                onToggle={() => setIsExpanded((value) => !value)}
                toneClassName={headerToneClass}
                summaryClassName={
                  row.kind === "status-updated" || row.kind === "title-updated"
                    ? "min-w-0"
                    : COLLAPSIBLE_HEADER_TEXT_CLASS
                }
                summaryContent={summaryContent}
              />
            ) : (
              <CollapsibleHeader
                toneClassName={headerToneClass}
                summaryClassName={COLLAPSIBLE_HEADER_TEXT_CLASS}
                summaryContent={summaryContent}
              />
            )}
          </div>
          {isExpanded && expandedDetail ? (
            <div className="px-2 pb-0.5">
              <p
                className="truncate text-sm text-foreground/80"
                title={expandedDetail}
              >
                {expandedDetail}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TaskDetailView() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const { data: task, isLoading, error } = useTask(taskId ?? "");
  const taskEventsQuery = useTaskEvents(taskId ?? "");
  const rolesQuery = useRoles();
  const setTaskAssignee = useSetTaskAssignee();
  const taskChat = useTaskChat();
  const updateTask = useUpdateTask();
  const taskPromptDraft = usePromptDraftStorage({
    projectId,
    threadId: taskId ? `task-${taskId}` : null,
  });
  const fileMentions = usePromptFileMentions(projectId);
  const [statusErrorMessage, setStatusErrorMessage] = useState<string | null>(null);
  const [assignmentErrorMessage, setAssignmentErrorMessage] = useState<string | null>(
    null,
  );
  const [chatErrorMessage, setChatErrorMessage] = useState<string | null>(null);

  const taskEvents = useMemo(
    () => (taskEventsQuery.data ?? []).slice().sort((a, b) => a.seq - b.seq),
    [taskEventsQuery.data],
  );
  const taskEventRows = useMemo(() => buildTaskEventRows(taskEvents), [taskEvents]);
  const primaryThreadsQuery = useThreads(
    task
      ? {
          projectId: task.projectId,
          taskId: task.id,
          taskRole: "primary",
          includeArchived: true,
        }
      : undefined,
    { enabled: Boolean(task) },
  );
  const primaryThreads = useMemo(
    () => (primaryThreadsQuery.data ?? []).slice().sort((a, b) => a.createdAt - b.createdAt),
    [primaryThreadsQuery.data],
  );
  const currentPrimaryThread = useMemo(
    () => primaryThreads.filter((thread) => thread.archivedAt === undefined).at(-1),
    [primaryThreads],
  );
  const currentPrimaryThreadId = currentPrimaryThread?.id;
  const currentPrimaryThreadDisplayName =
    currentPrimaryThread?.title?.trim() || currentPrimaryThreadId;
  const primaryThreadIds = useMemo(
    () => primaryThreads.map((thread) => thread.id),
    [primaryThreads],
  );
  const primaryThreadEventsQueries = useThreadEventsBatch(primaryThreadIds);
  const primaryThreadMessages = useMemo(() => {
    const messages: UIMessage[] = [];
    for (let i = 0; i < primaryThreads.length; i += 1) {
      const thread = primaryThreads[i];
      const threadEvents = primaryThreadEventsQueries[i]?.data ?? [];
      messages.push(...toPrimaryThreadTurnMessages(thread, threadEvents));
    }
    messages.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      const aSeq = "sourceSeqStart" in a ? a.sourceSeqStart : 0;
      const bSeq = "sourceSeqStart" in b ? b.sourceSeqStart : 0;
      return aSeq - bSeq;
    });
    return messages;
  }, [primaryThreadEventsQueries, primaryThreads]);
  const isPrimaryThreadEventsLoading = primaryThreadEventsQueries.some(
    (query) => query.isLoading,
  );
  const taskActivityRows = useMemo(() => {
    const activityRows: TaskActivityRow[] = [];
    for (let i = 0; i < taskEventRows.length; i += 1) {
      const row = taskEventRows[i];
      const taskChatMessage = toTaskChatActivityMessage(row.event);
      if (taskChatMessage) {
        activityRows.push({
          kind: "task-chat-message",
          id: `task-chat-message:${row.event.id}`,
          createdAt: row.event.createdAt,
          order: i,
          message: taskChatMessage,
        });
      } else {
        activityRows.push({
          kind: "task-event",
          id: `task-event:${row.event.id}`,
          createdAt: row.event.createdAt,
          order: i,
          row,
        });
      }
    }
    const offset = taskEventRows.length;
    for (let i = 0; i < primaryThreadMessages.length; i += 1) {
      const message = primaryThreadMessages[i];
      activityRows.push({
        kind: "agent-message",
        id: `agent-message:${message.id}`,
        createdAt: message.createdAt,
        order: offset + i,
        message,
      });
    }

    activityRows.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.order - b.order;
    });
    return activityRows;
  }, [primaryThreadMessages, taskEventRows]);
  const showAgentWorking =
    taskChat.isPending ||
    currentPrimaryThread?.status === "active" ||
    currentPrimaryThread?.status === "created" ||
    currentPrimaryThread?.status === "provisioning";
  const primaryThreadDisplayNameById = useMemo(() => {
    return new Map(
      primaryThreads.map((thread) => [thread.id, thread.title?.trim() || thread.id]),
    );
  }, [primaryThreads]);
  const roleNameById = useMemo(() => {
    return new Map((rolesQuery.data ?? []).map((role) => [role.id, role.name]));
  }, [rolesQuery.data]);

  if (!projectId || !taskId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">Not found</p>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading task...
        </p>
      </PageShell>
    );
  }

  if (error || !task || task.projectId !== projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">
          {error ? error.message : "Not found"}
        </p>
      </PageShell>
    );
  }

  const submitTaskPrompt = () => {
    if (!task) return;
    const message = taskPromptDraft.value.trim();
    if (!task.assignee || message.length === 0 || taskChat.isPending) return;

    setChatErrorMessage(null);
    taskChat.mutate(
      {
        id: task.id,
        req: {
          input: [{ type: "text", text: message }],
        },
      },
      {
        onSuccess: () => {
          taskPromptDraft.clear();
        },
        onError: (chatError) => {
          setChatErrorMessage(
            chatError instanceof Error
              ? chatError.message
              : "Unable to send task message.",
          );
        },
      },
    );
  };

  const canEditStatus = task.status !== "closed" && !updateTask.isPending;

  const handleStatusChange = (nextStatus: TaskStatus) => {
    if (nextStatus === task.status || updateTask.isPending) return;

    setStatusErrorMessage(null);

    updateTask.mutate(
      {
        id: task.id,
        req:
          nextStatus === "closed"
            ? { status: nextStatus, closeReason: task.closeReason ?? "completed" }
            : { status: nextStatus },
      },
      {
        onError: (updateError) => {
          setStatusErrorMessage(
            updateError instanceof Error
              ? updateError.message
              : "Unable to update task status.",
          );
        },
      },
    );
  };

  const handleAssignRole = (nextRoleId: string) => {
    if (setTaskAssignee.isPending || nextRoleId === task.assignee) return;
    setAssignmentErrorMessage(null);
    setTaskAssignee.mutate(
      { id: task.id, assignee: nextRoleId },
      {
        onError: (assignError) => {
          setAssignmentErrorMessage(
            assignError instanceof Error
              ? assignError.message
              : "Unable to update role.",
          );
        },
      },
    );
  };

  return (
    <PageShell
      contentClassName="gap-3"
      footerUsesPromptPadding
      footer={
        <>
          <PromptBox
            id="task-detail-chat-prompt"
            value={taskPromptDraft.value}
            onChange={(value) => {
              taskPromptDraft.setValue(value);
              if (chatErrorMessage) setChatErrorMessage(null);
            }}
            onSubmit={submitTaskPrompt}
            isSubmitting={taskChat.isPending}
            submitDisabled={
              !task.assignee ||
              taskPromptDraft.value.trim().length === 0 ||
              taskChat.isPending
            }
            submitTitle={taskChat.isPending ? "Sending..." : "Send"}
            placeholder={
              task.assignee
                ? "Message the assigned task agent"
                : "Assign a role before chatting"
            }
            mentionSuggestions={fileMentions.suggestions}
            mentionLoading={fileMentions.isLoading}
            mentionError={fileMentions.isError}
            onMentionQueryChange={fileMentions.setQuery}
          />
          {chatErrorMessage ? (
            <p className="px-1 pt-2 text-xs text-destructive">
              {chatErrorMessage}
            </p>
          ) : null}
        </>
      }
    >
      <section className="shrink-0">
        <DetailCard>
          {task.description && task.description.trim().length > 0 ? (
            <div className="py-1">
              <dt className="sr-only">Description</dt>
              <dd className="min-w-0 break-words text-sm text-foreground/90">
                {task.description}
              </dd>
            </div>
          ) : null}
          <DetailRow label="Status" align="center">
            <div className="inline-flex max-w-full">
              <div className="relative inline-flex items-center rounded-sm px-0.5 focus-within:ring-1 focus-within:ring-ring">
                <span className="pointer-events-none text-sm text-foreground">
                  {formatSnakeCaseLabel(task.status)}
                </span>
                <ChevronDown className="pointer-events-none ml-1 size-3 text-muted-foreground" />
                <select
                  value={task.status}
                  onChange={(event) =>
                    handleStatusChange(event.target.value as TaskStatus)
                  }
                  disabled={!canEditStatus}
                  aria-label="Task status"
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
                >
                  {TASK_STATUS_OPTIONS.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {formatSnakeCaseLabel(statusOption)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </DetailRow>
          {statusErrorMessage ? (
            <DetailMessageRow>
              <p className="text-xs text-destructive">{statusErrorMessage}</p>
            </DetailMessageRow>
          ) : null}
          {task.status === "closed" ? (
            <DetailMessageRow>
              <p className="text-xs text-muted-foreground">
                Closed tasks cannot be reopened.
              </p>
            </DetailMessageRow>
          ) : null}
          <DetailRow label="Assignee" align="center">
            <TaskAssigneeSelector
              value={task.assignee}
              onChange={(nextRoleId) => {
                if (assignmentErrorMessage) setAssignmentErrorMessage(null);
                handleAssignRole(nextRoleId);
              }}
              className="h-auto px-0 text-sm text-foreground/90 hover:text-foreground"
            />
          </DetailRow>
          {assignmentErrorMessage ? (
            <DetailMessageRow>
              <p className="text-xs text-destructive">
                {assignmentErrorMessage}
              </p>
            </DetailMessageRow>
          ) : null}
          {currentPrimaryThreadId ? (
            <DetailRow label="Primary Thread" valueClassName="min-w-0 truncate">
              <Link
                to={`/projects/${projectId}/threads/${currentPrimaryThreadId}`}
                className="underline underline-offset-2"
              >
                {currentPrimaryThreadDisplayName}
              </Link>
            </DetailRow>
          ) : null}
          <DetailRow label="Created">{formatDate(task.createdAt)}</DetailRow>
          <DetailRow label="Updated">{formatDate(task.updatedAt)}</DetailRow>
          {task.closeReason ? (
            <DetailRow label="Close Reason">{task.closeReason}</DetailRow>
          ) : null}
        </DetailCard>
      </section>

      <section className="min-h-0">
        {taskEventsQuery.isLoading ||
        primaryThreadsQuery.isLoading ||
        isPrimaryThreadEventsLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Loading task activity...
          </div>
        ) : taskActivityRows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No task activity yet.
          </div>
        ) : (
          <div className="space-y-0.5 py-1">
            {taskActivityRows.map((activityRow) =>
              activityRow.kind === "task-event" ? (
                <TaskEventLogEntry
                  key={activityRow.id}
                  row={activityRow.row}
                  roleNameById={roleNameById}
                  threadDisplayNameById={primaryThreadDisplayNameById}
                  projectId={projectId}
                />
              ) : (
                <ConversationEntry
                  key={activityRow.id}
                  message={activityRow.message}
                  initialExpanded={false}
                />
              ),
            )}
            {showAgentWorking ? (
              <ConversationWorkingIndicator isThinking={false} />
            ) : null}
          </div>
        )}
      </section>
    </PageShell>
  );
}
