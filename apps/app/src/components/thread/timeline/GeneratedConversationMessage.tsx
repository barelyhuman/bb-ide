import { memo, useCallback, useMemo } from "react";
import type {
  TimelineConversationTurnRequest,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import type { TimelineTitle, TimelineTitleSegment } from "@bb/thread-view";
import type { IconName } from "@/components/ui/icon.js";
import {
  ConversationAttachments,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { NESTED_TIMELINE_GROUP_LINE_CLASS_NAME } from "./timeline-nested-group-line.js";
import type { TimelineTitleLinkResolver } from "./TimelineTitleView.js";
import type { ThreadTimelineLocalFileLinkHandler } from "./types.js";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";

interface GeneratedConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
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
  turnRequest: TimelineConversationTurnRequest;
}

export function generatedConversationBodyText({
  initiator,
  text,
}: GeneratedConversationBodyTextArgs): string {
  const prefixLength = computeMutedPrefixLength(initiator, text);
  return prefixLength > 0 ? text.slice(prefixLength).trimStart() : text;
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
  turnRequest,
}: GeneratedConversationTitleArgs): TimelineTitle {
  const requestLabel = turnRequestLabel(turnRequest);
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

  if (requestLabel !== null) {
    segments.push(
      timelineTitleSegment({
        em: false,
        link: null,
        shimmer:
          turnRequest.kind === "steer" && turnRequest.status === "pending",
        text: requestLabel,
        truncate: false,
      }),
    );
  }

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
    onOpenLocalFileLink,
    projectId,
    resolveSegmentLinkHref,
    sourceKind,
    sourceName,
    sourceThreadId,
    text,
    turnRequest,
  }: GeneratedConversationMessageProps) {
    const messageText = text.trim();
    const visibleText =
      messageText.length > USER_MESSAGE_CHAR_CAP
        ? messageText.slice(0, USER_MESSAGE_CHAR_CAP)
        : messageText;
    const isTruncated = messageText.length > USER_MESSAGE_CHAR_CAP;
    const title = useMemo(
      () =>
        generatedConversationTitle({
          sourceKind,
          sourceName,
          sourceThreadId,
          turnRequest,
        }),
      [sourceKind, sourceName, sourceThreadId, turnRequest],
    );
    const leadingIcon = generatedConversationIconName(sourceKind);
    const renderBody = useCallback(
      () => (
        <div className={NESTED_TIMELINE_GROUP_LINE_CLASS_NAME}>
          <div className="pl-2 text-sm leading-relaxed text-foreground">
            {messageText ? (
              <p className="whitespace-pre-wrap break-words">
                {visibleText}
                {isTruncated ? (
                  <span className="text-muted-foreground"> [truncated]</span>
                ) : null}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {generatedConversationEmptyText(sourceKind)}
              </p>
            )}
            <ConversationAttachments
              align="start"
              filePaths={attachmentItems.filePaths}
              imageItems={attachmentItems.imageItems}
              onOpenLocalFileLink={onOpenLocalFileLink}
              projectId={projectId}
            />
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
        visibleText,
      ],
    );

    return (
      <ExpandableTimelineRow
        title={title}
        leadingIcon={leadingIcon}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        renderBody={renderBody}
      />
    );
  },
);
