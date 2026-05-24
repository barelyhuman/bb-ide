import { useState } from "react";
import type { Host, PermissionMode, ProjectSource } from "@bb/domain";
import {
  NewThreadPromptBoxUI,
  type NewThreadBranchConfig,
  type NewThreadEnvironmentConfig,
  type NewThreadWorktreeConfig,
} from "@/components/promptbox/NewThreadPromptBox";
import type { HistoryConfig } from "@/components/promptbox/PromptBoxInternal";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  makeAttachmentsConfig as makeAttachments,
  makeExecutionControlsProps,
  makeMentionsConfig as makeMentions,
} from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/New Thread Prompt Box",
};

const noop = () => {};

const baseExecution = makeExecutionControlsProps();

const localHostId = "host_local";

const localHost: Host = {
  id: localHostId,
  name: "Michael’s MacBook Pro",
  type: "persistent",
  status: "connected",
  lastSeenAt: 0,
  createdAt: 0,
  updatedAt: 0,
};

const localSources: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: "proj_demo",
    type: "local_path",
    hostId: localHostId,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

const baseEnvironment: NewThreadEnvironmentConfig = {
  value: `host:${localHostId}:local`,
  onChange: noop,
  sources: localSources,
  hosts: [localHost],
  isLocalHost: (hostId) => hostId === localHostId,
};

const baseBranch: NewThreadBranchConfig = {
  value: null,
  currentBranch: "main",
  isNew: false,
  options: [
    "main",
    "develop",
    "feat/timeline-pagination",
    "fix/review-thread",
    "chore/upgrade-react",
  ],
  loading: false,
  currentOptionLabel: "Current: main",
  placeholder: "Current checkout",
  triggerLabel: "Current (main)",
  triggerTitle: "Current: main",
  onChange: noop,
  onClear: noop,
  onCreate: noop,
};

const baseWorktree: NewThreadWorktreeConfig = {
  options: [],
  value: null,
  onChange: noop,
};

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

const baseHistory: HistoryConfig = {
  currentDraft: { text: "", attachments: [] },
  entries: [
    { text: "review thread workspace", attachments: [] },
    { text: "investigate timeline pagination", attachments: [] },
  ],
  onSelectEntry: noop,
};

function useControlledValue(initial: string) {
  const [value, setValue] = useState(initial);
  return { value, onChange: setValue };
}

// Match production: ProjectMainView wraps the prompt area in PageShell which
// caps content at 760px. Without this constraint the env-permission strip's
// justify-between drifts the permission picker far to the right.
interface PromptStageProps {
  children: React.ReactNode;
}

function PromptStage({ children }: PromptStageProps) {
  return <div className="mx-auto w-full max-w-[760px]">{children}</div>;
}

function DefaultRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-default"
        value={value}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.default"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        execution={baseExecution}
        environment={baseEnvironment}
        branch={baseBranch}
        worktree={baseWorktree}
        permission={basePermission}
      />
    </PromptStage>
  );
}

function SubmittingRow() {
  const { value, onChange } = useControlledValue(
    "Investigate the timeline pagination flicker.",
  );
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-submitting"
        value={value}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting
        disabled
        zenModeStorageKey="bb.story.new-thread.submitting"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        execution={baseExecution}
        environment={baseEnvironment}
        branch={baseBranch}
        worktree={baseWorktree}
        permission={basePermission}
      />
    </PromptStage>
  );
}

function ClaudeProviderRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-claude"
        value={value}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.claude"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        execution={{
          ...baseExecution,
          provider: { ...baseExecution.provider, selectedId: "claude-code" },
          model: {
            active: { model: "claude-sonnet-4-6" },
            selected: "claude-sonnet-4-6",
            options: [
              { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
              { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
              { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
            ],
            onChange: noop,
          },
          serviceTier: { ...baseExecution.serviceTier!, supported: false },
        }}
        environment={baseEnvironment}
        branch={baseBranch}
        worktree={baseWorktree}
        permission={basePermission}
      />
    </PromptStage>
  );
}

function FullAccessRow() {
  const { value, onChange } = useControlledValue("");
  return (
    <PromptStage>
      <NewThreadPromptBoxUI
        id="story-new-thread-full-access"
        value={value}
        onChange={onChange}
        onSubmit={noop}
        isSubmitting={false}
        disabled={false}
        zenModeStorageKey="bb.story.new-thread.full-access"
        history={baseHistory}
        mentions={makeMentions()}
        attachments={makeAttachments()}
        execution={baseExecution}
        environment={baseEnvironment}
        branch={baseBranch}
        worktree={baseWorktree}
        permission={{ ...basePermission, value: "full" }}
      />
    </PromptStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="default"
        hint="codex + workspace-write + local-direct env"
      >
        <DefaultRow />
      </StoryRow>
      <StoryRow label="submitting" hint="create-thread mutation in flight">
        <SubmittingRow />
      </StoryRow>
      <StoryRow label="claude-code provider" hint="no fast mode toggle">
        <ClaudeProviderRow />
      </StoryRow>
      <StoryRow label="full access" hint='permission tone="warning"'>
        <FullAccessRow />
      </StoryRow>
    </StoryCard>
  );
}
