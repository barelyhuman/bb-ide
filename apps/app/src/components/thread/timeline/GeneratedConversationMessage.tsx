import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import { Icon, type IconName } from "@/components/ui/icon.js";
import {
  ConversationAttachments,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import {
  clipMentionTextToVisibleRange,
  renderMentionTextSegments,
  shiftMentionsToTextRange,
} from "./ConversationMessageMentions.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { NESTED_TIMELINE_GROUP_LINE_CLASS_NAME } from "./timeline-nested-group-line.js";
import type { TimelineTitleLinkResolver } from "./TimelineTitleView.js";
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";
import { cn } from "@/lib/utils";
import {
  ConversationMessageInlineOverflowToggle,
  ConversationMessageOverflowToggle,
  useIsOverflowing,
} from "./conversation-message-overflow.js";

interface GeneratedConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  mentions: readonly PromptTextMention[];
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

type GeneratedConversationSourceKind = "agent" | "system";

interface GeneratedConversationBodyTextArgs {
  initiator: TimelineUserConversationRow["initiator"];
  text: string;
}

interface GeneratedConversationBodySlice {
  startOffset: number;
  text: string;
}

interface TimelineTitleSegmentArgs {
  em: boolean;
  link: TimelineTitleSegment["link"] | null;
  shimmer: boolean;
  text: string;
  truncate: boolean;
}

interface GeneratedConversationTitleArgs {
  sourceKind: GeneratedConversationSourceKind;
  sourceName: string;
  sourceThreadId: string | null;
}

export function generatedConversationBodySlice({
  initiator,
  text,
}: GeneratedConversationBodyTextArgs): GeneratedConversationBodySlice {
  const prefixLength = computeMutedPrefixLength(initiator, text);
  if (prefixLength <= 0) {
    return { startOffset: 0, text };
  }

  const textAfterPrefix = text.slice(prefixLength);
  const trimStartLength =
    textAfterPrefix.length - textAfterPrefix.trimStart().length;
  return {
    startOffset: prefixLength + trimStartLength,
    text: textAfterPrefix.slice(trimStartLength),
  };
}

export function generatedConversationBodyText({
  initiator,
  text,
}: GeneratedConversationBodyTextArgs): string {
  return generatedConversationBodySlice({ initiator, text }).text;
}

function timelineTitleSegment({
  em,
  link,
  shimmer,
  text,
  truncate,
}: TimelineTitleSegmentArgs): TimelineTitleSegment {
  const segment: TimelineTitleSegment = {
    em,
    shimmer,
    text,
    truncate,
  };
  if (link !== null) {
    segment.link = link;
  }
  return segment;
}

function generatedConversationTitle({
  sourceKind,
  sourceName,
  sourceThreadId,
}: GeneratedConversationTitleArgs): TimelineTitle {
  const segments: TimelineTitleSegment[] =
    sourceKind === "agent"
      ? [
          timelineTitleSegment({
            em: false,
            link: null,
            shimmer: false,
            text: "Message from",
            truncate: false,
          }),
          timelineTitleSegment({
            em: true,
            link:
              sourceThreadId === null
                ? null
                : { kind: "thread", threadId: sourceThreadId },
            shimmer: false,
            text: sourceName,
            truncate: true,
          }),
        ]
      : [
          timelineTitleSegment({
            em: false,
            link: null,
            shimmer: false,
            text: "System Message",
            truncate: true,
          }),
        ];

  return {
    action: null,
    decorations: [],
    plain: segments
      .map((segment) => segment.plainText ?? segment.text)
      .join(" "),
    segments,
    tone: "default",
  };
}

function generatedConversationEmptyText(
  sourceKind: GeneratedConversationSourceKind,
): string {
  switch (sourceKind) {
    case "agent":
      return "Sent an agent message";
    case "system":
      return "Sent a BB system message";
  }
}

function generatedConversationIconName(
  sourceKind: GeneratedConversationSourceKind,
): IconName {
  switch (sourceKind) {
    case "agent":
      return "MessageSquare";
    case "system":
      return "Info";
  }
}

export const GeneratedConversationMessage = memo(
  function GeneratedConversationMessage({
    attachmentItems,
    mentions,
    onOpenLocalFileLink,
    projectId,
    resolveSegmentLinkHref,
    sourceKind,
    sourceName,
    sourceThreadId,
    text,
    turnRequest,
  }: GeneratedConversationMessageProps) {
    const trimStartLength = text.length - text.trimStart().length;
    const messageText = text.trim();
    const messageMentions = useMemo(
      () =>
        shiftMentionsToTextRange({
          mentions,
          rangeStart: trimStartLength,
          rangeEnd: trimStartLength + messageText.length,
        }),
      [mentions, messageText.length, trimStartLength],
    );
    const visibleText =
      messageText.length > USER_MESSAGE_CHAR_CAP
        ? messageText.slice(0, USER_MESSAGE_CHAR_CAP)
        : messageText;
    const visibleMessage = useMemo(
      () =>
        clipMentionTextToVisibleRange({
          mentions: messageMentions,
          rangeStart: 0,
          text: visibleText,
        }),
      [messageMentions, visibleText],
    );
    const isTruncated = messageText.length > USER_MESSAGE_CHAR_CAP;
    const [isFullTextVisible, setIsFullTextVisible] = useState(false);
    const textRef = useRef<HTMLParagraphElement>(null);
    const isOverflowing = useIsOverflowing({
      elementRef: textRef,
      enabled: !isFullTextVisible && messageText.length > 0,
      measurementKey: visibleText,
    });
    const showToggle = isFullTextVisible || isOverflowing;
    const showInlineToggle = !isFullTextVisible && isOverflowing;
    const requestLabel = turnRequestLabel(turnRequest);
    const isPendingSteer =
      turnRequest.kind === "steer" && turnRequest.status === "pending";
    const title = useMemo(
      () =>
        generatedConversationTitle({
          sourceKind,
          sourceName,
          sourceThreadId,
        }),
      [sourceKind, sourceName, sourceThreadId],
    );
    const leadingIcon = generatedConversationIconName(sourceKind);
    const renderBody = useCallback(
      () => (
        <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
          <div className="pl-2 text-sm leading-relaxed text-foreground">
            {messageText ? (
              <p
                ref={textRef}
                className={cn(
                  "whitespace-pre-wrap break-words",
                  !isFullTextVisible && "line-clamp-2",
                  showInlineToggle && "relative",
                )}
              >
                {renderMentionTextSegments({
                  mentions: visibleMessage.mentions,
                  text: visibleMessage.text,
                })}
                {isTruncated ? (
                  <span className="text-muted-foreground"> [truncated]</span>
                ) : null}
                {showInlineToggle ? (
                  <ConversationMessageInlineOverflowToggle
                    buttonBackgroundClassName="bg-background"
                    fadeFromClassName="from-background"
                    label="Show more"
                    onToggle={() => setIsFullTextVisible(true)}
                  />
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {generatedConversationEmptyText(sourceKind)}
              </p>
            )}
            {isFullTextVisible && showToggle ? (
              <ConversationMessageOverflowToggle
                expanded={isFullTextVisible}
                labels={{ collapsed: "Show more", expanded: "Show less" }}
                onToggle={() => setIsFullTextVisible((prev) => !prev)}
              />
            ) : null}
            <ConversationAttachments
              align="start"
              filePaths={attachmentItems.filePaths}
              imageItems={attachmentItems.imageItems}
              onOpenLocalFileLink={onOpenLocalFileLink}
              projectId={projectId}
            />
            {requestLabel ? (
              <div className="mt-1 flex items-center justify-start gap-2">
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap text-xs leading-none text-muted-foreground",
                    isPendingSteer && "animate-shine",
                  )}
                >
                  <Icon
                    name="CornerDownRight"
                    className="mr-1 inline-block size-3 align-middle"
                  />
                  {requestLabel}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ),
      [
        attachmentItems.filePaths,
        attachmentItems.imageItems,
        isTruncated,
        messageText,
        onOpenLocalFileLink,
        projectId,
        sourceKind,
        requestLabel,
        isPendingSteer,
        isFullTextVisible,
        visibleMessage,
        showToggle,
        showInlineToggle,
      ],
    );

    return (
      <ExpandableTimelineRow
        title={title}
        leadingIcon={leadingIcon}
        autoExpanded={sourceKind === "system"}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        renderBody={renderBody}
      />
    );
  },
);
