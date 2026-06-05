import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  TimelineConversationAttachments,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import { CopyButton } from "../../ui/copy-button.js";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "../../ui/markdown-preview.js";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { Icon } from "@/components/ui/icon.js";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length.js";
import type { TimelineTitleLinkResolver } from "./TimelineTitleView.js";
import type {
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
  UserAttachmentImageSrcResolver,
} from "./types.js";
import {
  ConversationAttachments,
  buildAttachmentItems,
  type ConversationAttachmentItems,
} from "./ConversationAttachments.js";
import {
  GeneratedConversationMessage,
  generatedConversationBodyText,
} from "./GeneratedConversationMessage.js";
import { USER_MESSAGE_CHAR_CAP } from "./conversation-message-limits.js";
import { turnRequestLabel } from "./conversation-turn-request-label.js";

interface ConversationMessageContentBaseProps {
  attachments: TimelineConversationAttachments | null;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
  text: string;
}

export interface ConversationMessageContentUserProps
  extends ConversationMessageContentBaseProps {
  role: "user";
  initiator: TimelineUserConversationRow["initiator"];
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

export interface ConversationMessageContentAssistantProps
  extends ConversationMessageContentBaseProps {
  role: "assistant";
  // Assistant content renders through MarkdownPreview, which is the only
  // surface with clickable links. User messages render as plain text
  // (CollapsibleMessageText), so this handler lives on the assistant variant
  // only — never accepted-but-ignored.
  onOpenLink?: ThreadTimelineLinkHandler;
  turnRequest: null;
}

/**
 * Discriminated on `role` so the user variant carries `initiator` +
 * non-null `turnRequest` while the assistant variant requires neither.
 * Avoids optional-with-default props (AGENTS.md: "do not use optional
 * fields to hide defaults") and lets the renderer drop optional-chain
 * defenses on contract-required fields.
 */
export type ConversationMessageContentProps =
  | ConversationMessageContentUserProps
  | ConversationMessageContentAssistantProps;

interface UserConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  initiator: TimelineUserConversationRow["initiator"];
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
  senderThreadId: TimelineUserConversationRow["senderThreadId"];
  senderThreadTitle: string | null;
  text: string;
  turnRequest: TimelineUserConversationRow["turnRequest"];
}

interface AssistantConversationMessageProps {
  attachmentItems: ConversationAttachmentItems;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
  text: string;
}

interface CollapsibleMessageTextProps {
  text: string;
  /**
   * When set, the first `mutePrefixLength` characters of `text` are rendered
   * inside a muted, max-width-truncated pill — used for `[bb …]` prefixes on
   * system-initiated messages and non-user messages without sender metadata.
   */
  mutePrefixLength?: number;
}

function splitPreWrappedLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/u);
}

function useIsOverflowing(
  elementRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  measurementKey: string,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  // useLayoutEffect (not useEffect) so the first measurement runs before
  // paint. Otherwise the first paint renders without the "Show more" toggle
  // (isOverflowing starts at false), and the button appears on the next
  // frame after the effect runs — visible as a flicker on page load for any
  // user message long enough to overflow.
  useLayoutEffect(() => {
    if (!enabled) {
      setIsOverflowing(false);
      return;
    }

    const element = elementRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      setIsOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [elementRef, enabled, measurementKey]);

  return isOverflowing;
}

function CollapsibleMessageText({
  text,
  mutePrefixLength,
}: CollapsibleMessageTextProps) {
  // The prefix is computed off the full source text; if it would consume
  // everything we'd show (or extend past the text — e.g. char-cap truncates
  // before the closing `]`), fall back to plain rendering.
  const showMutedPrefix =
    typeof mutePrefixLength === "number" &&
    mutePrefixLength > 0 &&
    mutePrefixLength < text.length;
  const prefixText = showMutedPrefix ? text.slice(0, mutePrefixLength) : null;
  const bodyText = showMutedPrefix ? text.slice(mutePrefixLength) : text;

  const [isExpanded, setIsExpanded] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const isTruncated = bodyText.length > USER_MESSAGE_CHAR_CAP;
  const cappedBody = isTruncated
    ? bodyText.slice(0, USER_MESSAGE_CHAR_CAP)
    : bodyText;
  const lines = splitPreWrappedLines(cappedBody);
  const exceedsCollapsedLineCount = lines.length > 15;
  // Collapsed view hands only the visible-by-line-clamp lines to the DOM;
  // expanded view hands the (already-capped) full text. Both stay below the
  // hard char cap so a megabyte paste can't dominate window-resize reflow.
  const renderedBody =
    isExpanded || !exceedsCollapsedLineCount
      ? cappedBody
      : lines.slice(0, 15).join("\n");
  const isOverflowing = useIsOverflowing(textRef, !isExpanded, renderedBody);
  const showToggle =
    isExpanded || exceedsCollapsedLineCount || isOverflowing;

  return (
    <>
      {prefixText !== null ? (
        <span
          className="line-clamp-1 text-muted-foreground"
          title={prefixText.trimEnd()}
        >
          {prefixText}
        </span>
      ) : null}
      <p
        ref={textRef}
        className={cn(
          "whitespace-pre-wrap break-words",
          !isExpanded && "line-clamp-[15]",
        )}
      >
        {renderedBody}
        {isExpanded && isTruncated ? (
          <span className="text-muted-foreground"> [truncated]</span>
        ) : null}
      </p>
      {showToggle ? (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={isExpanded}
          >
            {isExpanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function UserConversationMessage({
  attachmentItems,
  initiator,
  onOpenLocalFileLink,
  projectId,
  resolveSegmentLinkHref,
  senderThreadId,
  senderThreadTitle,
  text,
  turnRequest,
}: UserConversationMessageProps) {
  if (initiator === "agent" && senderThreadId !== null) {
    const bodyText = generatedConversationBodyText({ initiator, text });
    return (
      <GeneratedConversationMessage
        attachmentItems={attachmentItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        sourceKind="agent"
        sourceName={senderThreadTitle ?? "Agent"}
        sourceThreadId={senderThreadId}
        text={bodyText}
        turnRequest={turnRequest}
      />
    );
  }

  if (initiator === "system") {
    const bodyText = generatedConversationBodyText({ initiator, text });
    return (
      <GeneratedConversationMessage
        attachmentItems={attachmentItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveSegmentLinkHref={resolveSegmentLinkHref}
        sourceKind="system"
        sourceName="BB"
        sourceThreadId={null}
        text={bodyText}
        turnRequest={turnRequest}
      />
    );
  }

  const mutePrefixLength = computeMutedPrefixLength(initiator, text);
  const messageText = text.trim();
  const requestLabel = turnRequestLabel(turnRequest);
  const isPendingSteer =
    turnRequest.kind === "steer" && turnRequest.status === "pending";
  const showToolbar = requestLabel !== null || messageText.length > 0;

  return (
    <div className="w-full">
      <div className="ml-auto w-fit max-w-[80%]">
        <div className="rounded-md bg-surface-selected p-2 text-sm leading-relaxed text-foreground">
          {messageText ? (
            <CollapsibleMessageText
              text={text}
              mutePrefixLength={mutePrefixLength || undefined}
            />
          ) : (
            <p className="text-muted-foreground">Sent attachments</p>
          )}
          <ConversationAttachments
            align="end"
            filePaths={attachmentItems.filePaths}
            imageItems={attachmentItems.imageItems}
            onOpenLocalFileLink={onOpenLocalFileLink}
            projectId={projectId}
          />
        </div>
        {showToolbar ? (
          <div className="mt-1 flex items-center justify-end gap-2">
            {requestLabel ? (
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap text-xs leading-none text-muted-foreground",
                  isPendingSteer && "animate-shine",
                )}
              >
                <Icon name="CornerDownRight" className="mr-1 inline-block size-3 align-middle" />
                {requestLabel}
              </span>
            ) : null}
            {messageText ? (
              <CopyButton text={text} label="Copy message" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AssistantConversationMessage({
  attachmentItems,
  onOpenLink,
  onOpenLocalFileLink,
  projectId,
  text,
}: AssistantConversationMessageProps) {
  const linkRouting = useMemo<MarkdownLinkRouting | undefined>(() => {
    if (!onOpenLink && !onOpenLocalFileLink) {
      return undefined;
    }

    const routing: MarkdownLinkRouting = {};
    if (onOpenLink) {
      routing.onOpenLink = onOpenLink;
    }
    if (onOpenLocalFileLink) {
      routing.localFile = {
        absoluteLinks: {
          kind: "trusted-host",
        },
        onOpenLink: onOpenLocalFileLink,
      };
    }
    return routing;
  }, [onOpenLink, onOpenLocalFileLink]);

  return (
    <div className="group w-full px-2 text-sm leading-relaxed">
      <MarkdownPreview
        content={text}
        linkRouting={linkRouting}
      />
      <ConversationAttachments
        filePaths={attachmentItems.filePaths}
        imageItems={attachmentItems.imageItems}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
      />
    </div>
  );
}

export function ConversationMessageContent(
  props: ConversationMessageContentProps,
) {
  const {
    attachments,
    onOpenLocalFileLink,
    projectId,
    resolveUserAttachmentImageSrc,
    text,
  } = props;
  const attachmentItems = useMemo(
    () =>
      buildAttachmentItems({
        attachments,
        projectId,
        resolveUserAttachmentImageSrc,
      }),
    [attachments, projectId, resolveUserAttachmentImageSrc],
  );

  if (props.role === "user") {
    return (
      <UserConversationMessage
        attachmentItems={attachmentItems}
        initiator={props.initiator}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId={projectId}
        resolveSegmentLinkHref={props.resolveSegmentLinkHref}
        senderThreadId={props.senderThreadId}
        senderThreadTitle={props.senderThreadTitle}
        text={text}
        turnRequest={props.turnRequest}
      />
    );
  }

  return (
    <AssistantConversationMessage
      attachmentItems={attachmentItems}
      onOpenLink={props.onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      projectId={projectId}
      text={text}
    />
  );
}
