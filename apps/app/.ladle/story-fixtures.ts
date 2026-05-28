import type {
  AvailableModel,
  Environment,
  Host,
  ProjectSource,
  ReasoningLevel,
  Thread,
  ThreadListEntry,
  WorkspaceStatus,
} from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { ClaudeIcon } from "../src/components/icons/ClaudeIcon";
import { OpenAiIcon } from "../src/components/icons/OpenAiIcon";
import { PiIcon } from "../src/components/icons/PiIcon";
import type { PickerOption } from "../src/components/pickers/OptionPicker";
import type { ProjectSelectorOption } from "../src/components/pickers/ProjectSelector";
import type { ReuseThreadOption } from "../src/components/pickers/WorktreePicker";
import type { ExecutionControlsProps } from "../src/components/promptbox/ExecutionControls";
import type {
  AttachmentsConfig,
  MentionsConfig,
} from "../src/components/promptbox/PromptBoxInternal";

const noop = () => {};

// ---------------------------------------------------------------------------
// A small set of realistic, shared constants so the fixture universe feels
// coherent across stories. Keep this list short — when stories reach for a
// host or project name, they should reach for one of these.
// ---------------------------------------------------------------------------

export const HOST_IDS = {
  local: "host_local",
  remote: "host_remote",
} as const;

export const HOST_NAMES = {
  local: "Michael's MacBook Pro",
  remote: "michael-build-box",
} as const;

export const PROJECT_IDS = {
  bb: "proj_bb",
  pierre: "proj_pierre",
  ingest: "proj_ingest_pipeline",
} as const;

export const PROJECT_NAMES = {
  bb: "bb",
  pierre: "pierre",
  ingest: "ingest-pipeline",
} as const;

export const BRANCH_NAMES = {
  default: "main",
  feature: "feat/sidebar-rail",
} as const;

/** Stable set of placeholder image URLs for prompt-attachment + preview stories. */
export const PLACEHOLDER_IMAGE_URLS = [
  "https://placecats.com/300/200",
  "https://placecats.com/320/180",
  "https://placecats.com/360/220",
  "https://placecats.com/400/240",
] as const;

// ---------------------------------------------------------------------------
// Promptbox config builders. PromptBoxInternal, NewThreadPromptBox, and
// FollowUpPromptBox stories all reach for the same Mentions / Attachments
// shapes — share them here so the inert defaults stay consistent.
// ---------------------------------------------------------------------------

export function makeMentionsConfig(
  overrides: Partial<MentionsConfig> = {},
): MentionsConfig {
  const base: MentionsConfig = {
    suggestions: [],
    threadSectionMode: "threads",
    isLoading: false,
    isError: false,
    onQueryChange: noop,
  };
  return { ...base, ...overrides };
}

export function makeAttachmentsConfig(
  overrides: Partial<AttachmentsConfig> = {},
): AttachmentsConfig {
  const base: AttachmentsConfig = {
    items: [],
    projectId: PROJECT_IDS.bb,
    onAttachFiles: noop,
    onRemove: noop,
    isAttaching: false,
    error: null,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Provider + model + reasoning fixtures shared across every story that shows
// the model & reasoning picker (directly, or via ExecutionControls). Match
// the realistic catalog the prototype stories used so the picker looks like
// production wherever it appears.
//
// Labels are the raw (un-stripped) form — `ModelReasoningPicker` applies the
// brand-prefix strip at render via `stripModelBrandPrefix`, so callers don't
// need to pre-format.
// ---------------------------------------------------------------------------

export const STORY_PROVIDER_OPTIONS: readonly PickerOption<string>[] = [
  { value: "codex", label: "Codex", icon: OpenAiIcon },
  { value: "claude-code", label: "Claude Code", icon: ClaudeIcon },
  { value: "pi", label: "Pi", icon: PiIcon },
];

export const STORY_CODEX_MODELS: readonly PickerOption<string>[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

export const STORY_CLAUDE_CODE_MODELS: readonly PickerOption<string>[] = [
  { value: "claude-opus-4-7-1m", label: "Claude Opus 4.7 (1M)" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

export const STORY_PI_MODELS: readonly PickerOption<string>[] = [
  { value: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "openai-codex/gpt-5.5", label: "GPT-5.5" },
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4" },
  { value: "openai-codex/gpt-5.4-mini", label: "GPT-5.4 Mini" },
];

export const STORY_CODEX_REASONING: readonly PickerOption<ReasoningLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

export const STORY_CLAUDE_REASONING: readonly PickerOption<ReasoningLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

/** Only codex supports the fast / standard service-tier toggle today. */
export const STORY_SERVICE_TIER_SUPPORT: Record<string, boolean> = {
  codex: true,
  "claude-code": false,
  pi: false,
};

// `AvailableModel`-shaped versions of the same catalog, for stories that go
// through the real data path (i.e. feed these into `useThreadCreationOptions`
// rather than into the picker directly).
const CODEX_EFFORTS: readonly ReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];
const OPUS_EFFORTS: readonly ReasoningLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function makeAvailableModel(
  override: Pick<AvailableModel, "model" | "displayName"> &
    Partial<AvailableModel>,
): AvailableModel {
  return {
    id: override.model,
    description: "",
    supportedReasoningEfforts: CODEX_EFFORTS.map((reasoningEffort) => ({
      reasoningEffort,
      description: "",
    })),
    defaultReasoningEffort: "medium",
    isDefault: false,
    ...override,
  };
}

export const STORY_CODEX_AVAILABLE_MODELS: readonly AvailableModel[] = [
  makeAvailableModel({
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    isDefault: true,
  }),
  makeAvailableModel({ model: "gpt-5.4", displayName: "GPT-5.4" }),
  makeAvailableModel({ model: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }),
  makeAvailableModel({ model: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" }),
  makeAvailableModel({
    model: "gpt-5.3-codex-spark",
    displayName: "GPT-5.3 Codex Spark",
    defaultReasoningEffort: "high",
  }),
  makeAvailableModel({ model: "gpt-5.2", displayName: "GPT-5.2" }),
];

export const STORY_CLAUDE_CODE_AVAILABLE_MODELS: readonly AvailableModel[] = [
  makeAvailableModel({
    model: "claude-opus-4-7-1m",
    displayName: "Claude Opus 4.7 (1M)",
    supportedReasoningEfforts: OPUS_EFFORTS.map((reasoningEffort) => ({
      reasoningEffort,
      description: "",
    })),
  }),
  makeAvailableModel({
    model: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    supportedReasoningEfforts: OPUS_EFFORTS.map((reasoningEffort) => ({
      reasoningEffort,
      description: "",
    })),
  }),
  makeAvailableModel({
    model: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    isDefault: true,
    supportedReasoningEfforts: ["low", "medium", "high", "max"].map(
      (reasoningEffort) => ({
        reasoningEffort: reasoningEffort as ReasoningLevel,
        description: "",
      }),
    ),
  }),
  makeAvailableModel({
    model: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }],
    defaultReasoningEffort: "low",
  }),
];

// ---------------------------------------------------------------------------
// Host / source / branch / worktree / project catalog. Every story that
// renders the env strip (EnvironmentOptions, NewThreadPromptBox), the project
// selector (NewThreadPromptBox), or the follow-up env summary
// (FollowUpPromptBox) pulls from the same lists so adding a new branch state
// flows everywhere without each story growing its own copy.
// ---------------------------------------------------------------------------

export const STORY_HOSTS: readonly Host[] = [
  makeHost({ id: HOST_IDS.local, name: HOST_NAMES.local }),
  makeHost({
    id: HOST_IDS.remote,
    name: HOST_NAMES.remote,
  }),
  makeHost({
    id: "host_disconnected",
    name: "Linux laptop",
    status: "disconnected",
  }),
];

export const STORY_PROJECT_SOURCES: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: PROJECT_IDS.bb,
    type: "local_path",
    hostId: HOST_IDS.local,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "src_remote",
    projectId: PROJECT_IDS.bb,
    type: "local_path",
    hostId: HOST_IDS.remote,
    path: "/home/michael/bb",
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  },
];

export const STORY_BRANCH_OPTIONS: readonly string[] = [
  "main",
  "release/1.2",
  "feat/sidebar-rail",
  "fix/timeline-pagination",
  "bb/refactor-project-creation-thr_jj65bdsiwa",
];

export const STORY_WORKTREE_OPTIONS: readonly ReuseThreadOption[] = [
  {
    environmentId: "env_review_flow",
    branchName: "bb/review-flow-thr_4hge9xn14m",
    threads: [
      { id: "thr_review", title: "Review flow cleanup" },
      { id: "thr_tests", title: "Backfill promptbox tests" },
    ],
  },
  {
    environmentId: "env_timeline",
    branchName: "bb/timeline-pagination-thr_qfk8ksbxkk",
    threads: [{ id: "thr_timeline", title: "Timeline pagination" }],
  },
];

export const STORY_PROJECTS: readonly ProjectSelectorOption[] = [
  { id: PROJECT_IDS.bb, name: PROJECT_NAMES.bb },
  { id: PROJECT_IDS.pierre, name: PROJECT_NAMES.pierre },
];

/** Matches the production helper passed into EnvironmentPickerUI. */
export const storyIsLocalHost = (hostId: string | null | undefined): boolean =>
  hostId === HOST_IDS.local;

/**
 * Codex / gpt-5.5 / medium reasoning — the default starting point most
 * stories want. Spread + override individual sections for specific
 * scenarios (locked provider, claude-code selected, fast mode on, etc.).
 */
export function makeExecutionControlsProps(
  overrides: Partial<ExecutionControlsProps> = {},
): ExecutionControlsProps {
  const base: ExecutionControlsProps = {
    provider: {
      options: STORY_PROVIDER_OPTIONS,
      selectedId: "codex",
      onChange: noop,
      hasMultiple: true,
    },
    model: {
      active: { model: "gpt-5.5" },
      selected: "gpt-5.5",
      options: STORY_CODEX_MODELS,
      onChange: noop,
    },
    serviceTier: {
      value: undefined,
      onChange: noop,
      supported: true,
      supportByProvider: STORY_SERVICE_TIER_SUPPORT,
    },
    reasoning: {
      value: "medium",
      options: STORY_CODEX_REASONING,
      onChange: noop,
    },
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Typed-base builders. Each base is annotated with its strict T so TypeScript
// contextually checks every field (literal enum values + missing fields).
// `Partial<T>` overrides can only restate existing fields, never invent
// missing ones.
// ---------------------------------------------------------------------------

export function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    id: "thr_demo",
    projectId: PROJECT_IDS.bb,
    environmentId: "env_demo",
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
  };
  return { ...base, ...overrides };
}

export function makeThreadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  const base: ThreadListEntry = {
    id: "thr_demo",
    projectId: PROJECT_IDS.bb,
    environmentId: null,
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
  };
  return { ...base, ...overrides };
}

export function makeProject(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  const base: ProjectResponse = {
    id: PROJECT_IDS.bb,
    kind: "standard",
    name: PROJECT_NAMES.bb,
    sources: [],
    createdAt: 1,
    updatedAt: 2,
  };
  return { ...base, ...overrides };
}

export function makeHost(overrides: Partial<Host> = {}): Host {
  const base: Host = {
    id: HOST_IDS.local,
    name: HOST_NAMES.local,
    type: "persistent",
    status: "connected",
    lastSeenAt: 100,
    createdAt: 0,
    updatedAt: 100,
  };
  return { ...base, ...overrides };
}

export function makeEnvironment(
  overrides: Partial<Environment> = {},
): Environment {
  const base: Environment = {
    id: "env_demo",
    projectId: PROJECT_IDS.bb,
    hostId: HOST_IDS.local,
    path: "/Users/michael/Projects/bb",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: BRANCH_NAMES.feature,
    baseBranch: BRANCH_NAMES.default,
    defaultBranch: BRANCH_NAMES.default,
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 100,
  };
  return { ...base, ...overrides };
}

export function makeWorkspaceStatus(
  overrides: Partial<WorkspaceStatus> = {},
): WorkspaceStatus {
  const base: WorkspaceStatus = {
    workingTree: {
      hasUncommittedChanges: false,
      state: "clean",
      insertions: 0,
      deletions: 0,
      files: [],
    },
    branch: {
      currentBranch: BRANCH_NAMES.feature,
      defaultBranch: BRANCH_NAMES.default,
    },
    mergeBase: {
      mergeBaseBranch: BRANCH_NAMES.default,
      baseRef: null,
      aheadCount: 0,
      behindCount: 0,
      hasCommittedUnmergedChanges: false,
      commits: [],
      insertions: 0,
      deletions: 0,
      files: [],
    },
  };
  return { ...base, ...overrides };
}
