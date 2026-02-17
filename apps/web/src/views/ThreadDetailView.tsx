import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useThread,
  useThreadEvents,
  useTellThread,
  useStopThread,
  useThreadDefaultExecutionOptions,
} from "../hooks/useApi";
import {
  ConversationEntry,
} from "@/components/messages/ConversationEntry";
import {
  CollapsibleHeader,
  getCollapsibleHeaderToneClass,
} from "@/components/messages/CollapsibleHeader";
import { ConversationWorkingIndicator } from "@/components/messages/ConversationWorkingIndicator";
import { PromptBox } from "@/components/promptbox/PromptBox";
import { PromptOptionPicker } from "@/components/promptbox/PromptOptionPicker";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { usePromptModelReasoning } from "@/hooks/usePromptModelReasoning";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { useDebugMode } from "@/hooks/useDebugMode";
import { usePromptFileMentions } from "@/hooks/usePromptFileMentions";
import { PageShell } from "@/components/layout/PageShell";
import { toUIMessages } from "@beanbag/core";
import {
  buildThreadDetailRows,
  type ThreadDetailToolGroupRow,
} from "./threadDetailRows";
import {
  findLatestActivityMessageId,
  findLatestActivityRowId,
  shouldHighlightLatestActivity,
} from "./threadDetailActivity";
import {
  createLatestInitialExpandedState,
  reduceLatestInitialExpandedState,
} from "@/lib/latestInitialExpanded";

const SCROLL_THRESHOLD = 40;

function useLatestInitialExpanded(initialExpanded: boolean): {
  isExpanded: boolean;
  onToggle: () => void;
} {
  const [state, dispatch] = useReducer(
    reduceLatestInitialExpandedState,
    initialExpanded,
    createLatestInitialExpandedState,
  );

  useEffect(() => {
    dispatch({ type: "sync", initialExpanded });
  }, [initialExpanded]);

  const onToggle = () => {
    dispatch({ type: "toggle" });
  };

  return { isExpanded: state.isExpanded, onToggle };
}

function ToolGroupEntry({
  entry,
  isLatestActivity,
}: {
  entry: ThreadDetailToolGroupRow;
  isLatestActivity: boolean;
}) {
  const { isExpanded, onToggle } = useLatestInitialExpanded(isLatestActivity);
  const latestActivityMessageId = useMemo(
    () => findLatestActivityMessageId(entry.messages),
    [entry.messages],
  );
  const count = entry.summaryCount;
  const summaryContent = `${count} tools and changes`;
  const headerToneClass = getCollapsibleHeaderToneClass(isExpanded);

  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <div className="rounded-md text-muted-foreground">
          <div className="px-2 py-1">
            <CollapsibleHeader
              isExpanded={isExpanded}
              onToggle={onToggle}
              toneClassName={headerToneClass}
              summaryContent={summaryContent}
            />
          </div>
          {isExpanded ? (
            <div className="px-2 pb-1">
              <div className="overflow-hidden rounded-md border border-border/60 bg-background/40">
                {entry.messages.map((message) => {
                  const isLatestMessage =
                    isLatestActivity &&
                    message.id === latestActivityMessageId;
                  return (
                    <ConversationEntry
                      key={message.id}
                      message={message}
                      initialExpanded={isLatestMessage}
                      preferOngoingLabels={isLatestMessage}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ThreadDetailView() {
  const { projectId, threadId } = useParams<{
    projectId: string;
    threadId: string;
  }>();
  const { data: thread, isLoading, error } = useThread(threadId ?? "");
  const { data: events } = useThreadEvents(threadId ?? "");
  const { data: defaultExecutionOptions } = useThreadDefaultExecutionOptions(
    threadId ?? "",
  );
  const { debugMode } = useDebugMode();
  const tellThread = useTellThread();
  const stopThread = useStopThread();
  const promptDraft = usePromptDraftStorage({ projectId, threadId });
  const fileMentions = usePromptFileMentions(projectId);
  const message = promptDraft.value;
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const {
    selectedModel,
    setSelectedModel,
    reasoningLevel,
    setReasoningLevel,
    sandboxMode,
    setSandboxMode,
    activeModel,
    modelOptions,
    reasoningOptions,
    sandboxOptions,
  } = usePromptModelReasoning({
    scope: "thread",
    initialModel: defaultExecutionOptions?.model,
    initialReasoningLevel: defaultExecutionOptions?.reasoningLevel,
    initialSandboxMode: defaultExecutionOptions?.sandboxMode,
  });

  const uiMessages = useMemo(
    () =>
      toUIMessages(events, {
        includeDebugRawEvents: debugMode,
        includeOptionalOperations: false,
        threadStatus: thread?.status,
      }),
    [debugMode, events, thread?.status],
  );

  const visibleMessages = useMemo(
    () => uiMessages.filter((entry) => entry.kind !== "assistant-reasoning"),
    [uiMessages],
  );
  const threadDetailRows = useMemo(
    () => buildThreadDetailRows(visibleMessages),
    [visibleMessages],
  );
  const latestActivityRowId = useMemo(
    () => findLatestActivityRowId(threadDetailRows),
    [threadDetailRows],
  );
  const shouldHighlightLatest = useMemo(
    () => shouldHighlightLatestActivity(threadDetailRows, latestActivityRowId),
    [latestActivityRowId, threadDetailRows],
  );

  const isReasoningBlockActive = useMemo(
    () =>
      uiMessages.some(
        (entry) => entry.kind === "assistant-reasoning" && entry.status === "streaming",
      ),
    [uiMessages],
  );

  const { containerRef, handleScroll: baseHandleScroll } = useAutoScroll(
    threadDetailRows,
    threadId,
  );

  useEffect(() => {
    setShowScrollToLatest(false);
  }, [threadId]);

  const handleScroll = useCallback(() => {
    baseHandleScroll();
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToLatest(distanceFromBottom > SCROLL_THRESHOLD);
  }, [baseHandleScroll, containerRef]);

  const scrollToLatest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowScrollToLatest(false);
  }, [containerRef]);

  if (!projectId || !threadId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">Not found</p>
      </PageShell>
    );
  }
  if (isLoading) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">Loading...</p>
      </PageShell>
    );
  }
  if (
    error ||
    !thread ||
    thread.projectId !== projectId
  ) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">
          {error ? error.message : "Not found"}
        </p>
      </PageShell>
    );
  }

  const isCreated = thread.status === "created";
  const isProvisioning = thread.status === "provisioning";
  const isProvisioningFailed = thread.status === "provisioning_failed";
  const canSendFollowUp = !isCreated && !isProvisioning;
  const promptPlaceholder =
    isCreated
      ? "Thread is being created..."
      : isProvisioning
      ? "Thread is provisioning..."
      : isProvisioningFailed
      ? "Retry provisioning by sending a message"
      : thread.status === "idle"
      ? "Ask for follow-up changes"
      : "Send a message to this thread...";

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    tellThread.mutate(
      {
        id: thread.id,
        input: [{ type: "text", text: trimmed }],
        model: activeModel?.model ?? selectedModel,
        reasoningLevel,
        sandboxMode,
      },
      { onSuccess: () => promptDraft.clear() },
    );
  };

  return (
    <PageShell
      scrollRef={containerRef}
      onScroll={handleScroll}
      contentClassName="gap-1"
      footerUsesPromptPadding
      footer={
        <>
          {isCreated || isProvisioning || isProvisioningFailed ? (
            <div className="pb-2 text-xs text-muted-foreground">
              {isCreated
                ? "Created..."
                : isProvisioning
                ? "Provisioning..."
                : "Provisioning failed"}
            </div>
          ) : null}
          <div className="flex h-0 items-center justify-center">
            <button
              onClick={scrollToLatest}
              className={cn(
                "z-20 -mt-20 flex size-8 items-center justify-center rounded-full border border-foreground/20 bg-background/80 shadow-md backdrop-blur-md transition-all duration-200 hover:border-foreground/30 hover:bg-background/90",
                showScrollToLatest
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-2 opacity-0",
              )}
              aria-label="Scroll to latest event"
              type="button"
            >
              <ArrowDown className="size-4" />
            </button>
          </div>
          <PromptBox
            value={message}
            onChange={promptDraft.setValue}
            onSubmit={handleSend}
            onStop={
              thread.status === "active"
                ? () => stopThread.mutate(thread.id)
                : undefined
            }
            isSubmitting={tellThread.isPending}
            submitDisabled={!canSendFollowUp}
            isRunning={thread.status === "active"}
            placeholder={promptPlaceholder}
            submitMode="enter"
            autoFocus
            mentionSuggestions={fileMentions.suggestions}
            mentionLoading={fileMentions.isLoading}
            mentionError={fileMentions.isError}
            onMentionQueryChange={fileMentions.setQuery}
            footerStart={
              <>
                <PromptOptionPicker
                  label="Model"
                  value={activeModel?.model ?? selectedModel}
                  options={modelOptions}
                  onChange={setSelectedModel}
                />
                <PromptOptionPicker
                  label="Reasoning"
                  value={reasoningLevel}
                  options={reasoningOptions}
                  onChange={setReasoningLevel}
                />
                <PromptOptionPicker
                  label="Sandbox"
                  value={sandboxMode}
                  options={sandboxOptions}
                  onChange={setSandboxMode}
                />
              </>
            }
          />
        </>
      }
    >
      {threadDetailRows.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No events yet
        </div>
      ) : (
        threadDetailRows.map((entry) => {
          const isLatestActivity =
            shouldHighlightLatest && entry.id === latestActivityRowId;
          return entry.kind === "tool-group" ? (
            <ToolGroupEntry
              key={`${threadId}:${entry.id}`}
              entry={entry}
              isLatestActivity={isLatestActivity}
            />
          ) : (
            <ConversationEntry
              key={`${threadId}:${entry.id}`}
              message={entry.message}
              initialExpanded={isLatestActivity}
              preferOngoingLabels={isLatestActivity}
            />
          );
        })
      )}
      {thread.status === "active" ? (
        <ConversationWorkingIndicator isThinking={isReasoningBlockActive} />
      ) : null}
    </PageShell>
  );
}
