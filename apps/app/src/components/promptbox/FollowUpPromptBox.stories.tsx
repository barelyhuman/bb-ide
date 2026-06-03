import { useState, type ReactNode } from "react";
import type {
  Environment,
  PermissionMode,
  ThreadQueuedMessage,
  WorkspaceStatus,
} from "@bb/domain";
import { formatEnvironmentDisplay } from "@bb/core-ui";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import {
  FollowUpPromptBox,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";
import { getFollowUpPromptPlaceholder } from "@/components/promptbox/follow-up-placeholder";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import type {
  AttachmentsConfig,
  MentionsConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { ThreadPromptContextBanner } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { QueuedMessagesList } from "@/components/promptbox/banner/QueuedMessagesList";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import { selectWorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeEnvironment,
  makeExecutionControlsProps,
  STORY_PROVIDER_OPTIONS,
} from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/Follow Up Prompt Box",
};

const noop = () => {};

// FollowUp commits the provider — omit `onChange` so the picker renders the
// provider segment as locked, and pass `displayName` so the static label
// shows even without a selectedId lookup.
const baseExecution = makeExecutionControlsProps({
  provider: {
    options: STORY_PROVIDER_OPTIONS,
    selectedId: "codex",
    hasMultiple: true,
    displayName: "Codex",
  },
});

const permissionModeOptions: readonly PickerOption<PermissionMode>[] = [
  { value: "full", label: "Full Access", tone: "warning" },
  { value: "workspace-write", label: "Workspace Write" },
  { value: "readonly", label: "Readonly" },
];

const basePermission = {
  value: "workspace-write" as PermissionMode,
  options: permissionModeOptions,
  onChange: noop,
  supported: true,
};

// ---------------------------------------------------------------------------
// Environment summary slot.
//
// Derived the SAME way production does it (ThreadDetailView): start from a real
// `Environment` and run it through `formatEnvironmentDisplay` +
// `getEnvironmentWorkspaceLabelIconName`. The story must never hand-write label
// strings like "Working locally" — that decouples it from the real derivation
// and lets the story render states the code cannot produce (e.g. "Working
// locally" while provisioning). Feeding the formatter keeps the story honest:
// changing the label logic changes these rows automatically.
// ---------------------------------------------------------------------------

interface EnvironmentSummaryArgs {
  environment: Environment;
  isLocalHost: boolean;
  hostName?: string;
  hostConnected?: boolean;
  branchName?: string;
  onCreateNewThreadInWorktree?: () => void;
}

function makeEnvironmentSummary({
  environment,
  isLocalHost,
  hostName,
  hostConnected,
  branchName,
  onCreateNewThreadInWorktree,
}: EnvironmentSummaryArgs): ReactNode {
  const display = formatEnvironmentDisplay({
    environment,
    isLocalHost,
    hostName,
  });
  return (
    <ThreadEnvironmentSummary
      environmentLabel={display.modeLabel}
      environmentHostLabel={
        display.location === "remote"
          ? (display.hostLabel ?? undefined)
          : undefined
      }
      environmentHostConnected={hostConnected}
      environmentIcon={getEnvironmentWorkspaceLabelIconName(
        display.workspaceDisplayKind,
      )}
      environmentBranchName={branchName}
      onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
    />
  );
}

const localEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    managed: false,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  }),
  isLocalHost: true,
  branchName: "bb/promptbox-stories",
});

const remoteEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    managed: false,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  }),
  isLocalHost: false,
  hostName: "ec2-builder",
  hostConnected: true,
  branchName: "bb/promptbox-stories",
});

const worktreeEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    status: "ready",
  }),
  isLocalHost: true,
  branchName: "bb/promptbox-stories",
  // Worktree threads expose a "new thread in this worktree" affordance —
  // production wires it to the new-thread route. The story just needs a
  // non-null handler so the MessageSquarePlus icon renders.
  onCreateNewThreadInWorktree: noop,
});

// A freshly-created worktree whose workspace is still being provisioned:
// discovered properties (isWorktree, branch) aren't populated yet, so the
// formatter reports the lifecycle ("Provisioning") instead of guessing a mode,
// and there is no branch chip. Because this runs the real formatter, it is
// structurally impossible for this row to show "Working locally".
const provisioningEnvironmentSummary: ReactNode = makeEnvironmentSummary({
  environment: makeEnvironment({
    isWorktree: false,
    workspaceProvisionType: "managed-worktree",
    status: "provisioning",
  }),
  isLocalHost: true,
});

const usage: ThreadContextWindowUsage = {
  usedTokens: 32_400,
  modelContextWindow: 128_000,
  estimated: false,
};

// ---------------------------------------------------------------------------
// Mentions + attachments + history (mostly empty fixtures)
// ---------------------------------------------------------------------------

const mentionsBase: MentionsConfig = {
  suggestions: [],
  threadSectionMode: "threads",
  isLoading: false,
  isError: false,
  onQueryChange: noop,
};

const attachmentsBase: AttachmentsConfig = {
  items: [],
  projectId: "proj_demo",
  isAttaching: false,
  error: null,
  onAttachFiles: noop,
  onRemove: noop,
};

const historyEntries = [
  { text: "review thread workspace", attachments: [] },
  { text: "investigate timeline pagination", attachments: [] },
];

// ---------------------------------------------------------------------------
// Stack slot fixtures — ThreadPromptContextBanner + QueuedMessagesList stack
// above the prompt input. The caller composes them as a single ReactNode.
// ---------------------------------------------------------------------------

const dirtyWorkspaceStatus: WorkspaceStatus = {
  workingTree: {
    state: "dirty_uncommitted",
    hasUncommittedChanges: true,
    files: [
      {
        path: "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
        status: "M",
        insertions: 42,
        deletions: 18,
      },
      {
        path: "apps/app/src/views/ThreadDetailPromptArea.tsx",
        status: "M",
        insertions: 12,
        deletions: 6,
      },
      {
        path: "apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx",
        status: "A",
        insertions: 74,
        deletions: 0,
      },
    ],
    insertions: 128,
    deletions: 24,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  mergeBase: null,
};

const dirtyContextBannerSection =
  selectWorkspaceChangedFilesSection(dirtyWorkspaceStatus);

const contextBannerElement: ReactNode = dirtyContextBannerSection ? (
  <ThreadPromptContextBanner
    todoSection={null}
    archivedSection={null}
    gitSection={{
      changedFiles: dirtyContextBannerSection,
      mergeBase: {
        branch: "main",
        options: ["main", "develop", "release/2026-05"],
        onChange: noop,
      },
      onPromptBannerFileClick: noop,
    }}
    gitSectionPending={false}
    managedBySection={null}
    managerChildrenSection={null}
    expandedSection={null}
    onToggleSection={noop}
  />
) : null;

const queuedMessages: readonly ThreadQueuedMessage[] = [
  {
    id: "q_1",
    content: [{ type: "text", text: "Also check the timeline error overlay." }],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    serviceTier: "default",
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "q_2",
    content: [
      {
        type: "text",
        text: "And confirm the new env summary renders without the branch button on unmanaged environments.",
      },
    ],
    model: "gpt-5.5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    serviceTier: "default",
    createdAt: 0,
    updatedAt: 0,
  },
];

const queuedMessagesElement: ReactNode = (
  <QueuedMessagesList
    queuedMessages={queuedMessages}
    sendDisabled={false}
    actionDisabled={false}
    processingMessageId={null}
    onSendImmediately={noop}
    onReorder={noop}
    onEdit={noop}
    onDelete={noop}
  />
);

// ---------------------------------------------------------------------------
// Per-row component
// ---------------------------------------------------------------------------

interface RowConfig {
  initialMessage?: string;
  submitMode: FollowUpSubmitMode;
  isFollowUpSubmitting?: boolean;
  threadRuntimeDisplayStatus?: ComposerCoreRuntimeStatus;
  promptPlaceholder?: string;
  environmentSummary?: ReactNode | null;
  contextWindowUsage?: ThreadContextWindowUsage | null;
  stack?: ReactNode | null;
  zenModeResetKey?: string;
}

type ComposerCoreRuntimeStatus = Parameters<
  typeof FollowUpPromptBox
>[0]["composer"]["threadRuntimeDisplayStatus"];

// Match production: ThreadTimelinePane's PageShell footer caps content at
// 760px. The story's StoryRow value cell uses flex-wrap, which would
// otherwise let the prompt box collapse to its intrinsic content width.
function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

function Row({
  initialMessage = "",
  submitMode,
  isFollowUpSubmitting = false,
  threadRuntimeDisplayStatus = "idle",
  // Default placeholder derives from threadRuntimeDisplayStatus the same way
  // production's `getFollowUpPromptPlaceholder` does, so the story tracks
  // copy changes without per-row updates. Rows that need explicit copy
  // (e.g. "blocked: pending interaction") still pass it through.
  promptPlaceholder,
  environmentSummary = localEnvironmentSummary,
  contextWindowUsage = null,
  stack = null,
  zenModeResetKey = "thr_demo",
}: RowConfig) {
  const [message, setMessage] = useState(initialMessage);
  const resolvedPlaceholder =
    promptPlaceholder ??
    getFollowUpPromptPlaceholder(threadRuntimeDisplayStatus, false);
  return (
    <PromptStage>
      <FollowUpPromptBox
        attachments={attachmentsBase}
        stack={stack}
        composer={{
          history: {
            currentDraft: { text: message, attachments: [] },
            entries: historyEntries,
            onSelectEntry: noop,
          },
          isFollowUpSubmitting,
          message,
          onChangeMessage: setMessage,
          onModifierSubmit: noop,
          onSubmit: noop,
          promptPlaceholder: resolvedPlaceholder,
          canModifierSubmit: submitMode.kind === "queue",
          submitMode,
          threadRuntimeDisplayStatus,
        }}
        environmentSummary={environmentSummary}
        contextWindowUsage={contextWindowUsage}
        execution={baseExecution}
        permission={basePermission}
        mentions={mentionsBase}
        zenModeResetKey={zenModeResetKey}
      />
    </PromptStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="ready" hint="idle thread — submit normally; no stop">
        <Row submitMode={{ kind: "ready" }} />
      </StoryRow>
      <StoryRow
        label="queue"
        hint="active runtime — submit queues; stop button visible"
      >
        <Row
          submitMode={{ kind: "queue", onStop: noop }}
          threadRuntimeDisplayStatus="active"
          contextWindowUsage={usage}
        />
      </StoryRow>
      <StoryRow
        label="stop-only"
        hint="host-reconnecting — composer locked; only Stop available"
      >
        <Row
          submitMode={{ kind: "stop-only", onStop: noop }}
          threadRuntimeDisplayStatus="host-reconnecting"
        />
      </StoryRow>
      <StoryRow
        label="blocked: pending interaction"
        hint="agent is waiting on a tool decision — composer locked"
      >
        <Row submitMode={{ kind: "blocked", reason: "pending-interaction" }} />
      </StoryRow>
      <StoryRow
        label="blocked: provisioning"
        hint="environment still spinning up — 'Provisioning' label, no branch yet"
      >
        <Row
          submitMode={{ kind: "blocked", reason: "provisioning" }}
          threadRuntimeDisplayStatus="provisioning"
          environmentSummary={provisioningEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow
        label="submitting"
        hint="send mutation in flight; submitMode separately tells stop visibility"
      >
        <Row
          submitMode={{ kind: "queue", onStop: noop }}
          isFollowUpSubmitting
          threadRuntimeDisplayStatus="active"
          initialMessage="And confirm the new env summary renders correctly."
        />
      </StoryRow>
      <StoryRow
        label="with queued messages"
        hint="queued cards stack above the prompt input"
      >
        <Row
          submitMode={{ kind: "queue", onStop: noop }}
          threadRuntimeDisplayStatus="active"
          stack={queuedMessagesElement}
          contextWindowUsage={usage}
        />
      </StoryRow>
      <StoryRow label="with promptbox context banner">
        <Row submitMode={{ kind: "ready" }} stack={contextBannerElement} />
      </StoryRow>
      <StoryRow
        label="stacked cards"
        hint="banner + queued messages composed in the same stack slot"
      >
        <Row
          submitMode={{ kind: "queue", onStop: noop }}
          threadRuntimeDisplayStatus="active"
          stack={
            <>
              {contextBannerElement}
              {queuedMessagesElement}
            </>
          }
          contextWindowUsage={usage}
        />
      </StoryRow>
      <StoryRow
        label="env: remote host"
        hint="Working remotely · host-name with connection dot"
      >
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={remoteEnvironmentSummary}
        />
      </StoryRow>
      <StoryRow label="env: worktree" hint="managed worktree label + icon">
        <Row
          submitMode={{ kind: "ready" }}
          environmentSummary={worktreeEnvironmentSummary}
        />
      </StoryRow>
    </StoryCard>
  );
}
