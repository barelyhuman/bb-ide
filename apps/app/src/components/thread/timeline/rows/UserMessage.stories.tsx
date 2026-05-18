import type { TimelineConversationAttachments } from "@bb/server-contract";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/User Message",
};

const noop = () => {};

// Match production: ThreadTimelinePane's PageShell content area caps at
// 760px. Without it the message bubble stretches the full row width and
// doesn't reflect what users see.
function TimelineStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// Resolves placecats URLs (which are already absolute) and falls through for
// project-relative paths the same way the production resolver would.
const resolveImageSrc = (path: string) => path;

const acceptedMessage = {
  kind: "message" as const,
  status: "accepted" as const,
};
const pendingSteer = { kind: "steer" as const, status: "pending" as const };
const acceptedSteer = { kind: "steer" as const, status: "accepted" as const };

// CollapsibleMessageText kicks in at > 15 pre-wrapped lines, so this fixture
// crosses that threshold to exercise the Show more / Show less affordance.
const longMarkdownText = `Audit \`apps/app/src/components/promptbox/FollowUpPromptBox.tsx\` for the same prop trims we did on the banner.

Specifically I want you to look at:

- Optional fields that hide defaults (per AGENTS.md: "Optional contract fields are allowed only when leaving the field out has its own real semantic meaning")
- Wrapper-shape mismatches where the outer prop renames fields just to rename them back at the call site
- Boolean soup that could collapse into one discriminated union (we already did this for ComposerSubmitMode)
- Slot candidates where the wrapper passes structured data but does no logic on it
- Layout-coupling smells where a top-level prop only exists because it sits next to another visual element
- Accepted-but-overridden fields (the picker's readOnly was a recent example)
- Fields that look like they should live on a different prop block

Examples of trims we landed recently for reference:

1. \`banner\` collapsed from 13 fields to a \`ReactNode | null\` slot
2. \`ComposerMentionsProps\` shim removed in favor of canonical \`MentionsConfig\`
3. \`ComposerAttachmentsProps\` same — drop the rename, use \`AttachmentsConfig\`
4. \`provider.readOnly\` removed; locked-ness derived from \`!provider.onChange\`

Reply with a punch list, not code. Each item should call out the current shape, the recommended shape, and a one-line reason for why the current shape is wrong.

Cap at ~600 words. Lead with the highest-value trims so I can prioritize.`;

const singleImageAttachments: TimelineConversationAttachments = {
  webImages: 0,
  localImages: 1,
  localFiles: 0,
  imageUrls: [],
  localImagePaths: ["https://placecats.com/300/200"],
  localFilePaths: [],
};

const mixedAttachments: TimelineConversationAttachments = {
  webImages: 1,
  localImages: 2,
  localFiles: 1,
  imageUrls: ["https://placecats.com/360/220"],
  localImagePaths: [
    "https://placecats.com/300/180",
    "https://placecats.com/320/200",
  ],
  localFilePaths: ["docs/refactor-notes.md"],
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="short">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            text="Walk me through how ThreadDetailView wires the prompt context banner."
            attachments={null}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="long" hint="multi-line markdown with code fence + bullets">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            text={longMarkdownText}
            attachments={null}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="turnRequest.kind = steer, status = pending — interruption mid-turn"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            text="Hold on — also include the queue API in that audit, please."
            attachments={null}
            turnRequest={pendingSteer}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="accepted steer"
        hint="steer that the runtime has acknowledged and folded into the turn"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            text="Hold on — also include the queue API in that audit, please."
            attachments={null}
            turnRequest={acceptedSteer}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow label="with image" hint="single localImage attachment">
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            text="Repro of the layout regression in the prompt context banner."
            attachments={singleImageAttachments}
            turnRequest={acceptedMessage}
            resolveUserAttachmentImageSrc={resolveImageSrc}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="with images and mixed attachments"
        hint="2 local images + 1 web image + 1 local file"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="user"
            text="Three screenshots from the design review and the spec doc."
            attachments={mixedAttachments}
            turnRequest={acceptedMessage}
            resolveUserAttachmentImageSrc={resolveImageSrc}
            onOpenLocalFileLink={noop}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="agent-initiated"
        hint="[bb message from thread:…] prefix renders as a muted, line-clamped header"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="agent"
            text={
              '[bb message from thread:thr_sender123; reply with `bb thread tell thr_sender123 "<your response>"`]\n\nHey — I finished the audit you asked for. Punch list is in `notes/audit-2026-05.md`; the highest-value trim is collapsing the picker-shape options into a discriminated union.'
            }
            attachments={null}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="system-initiated (scheduled nudge)"
        hint="[bb system] prefix on its own line, body below"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            text={
              "[bb system]\n\nScheduled nudge: daily-recap. Check ASYNC.md."
            }
            attachments={null}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
      <StoryRow
        label="system-initiated (welcome)"
        hint="multi-line block-form body after the [bb system] header"
      >
        <TimelineStage>
          <ConversationMessageContent
            role="user"
            initiator="system"
            text={
              "[bb system]\n\nWelcome!\nStart with a short meet-and-greet via `message_user`."
            }
            attachments={null}
            turnRequest={acceptedMessage}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}
