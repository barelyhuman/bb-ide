import type { Host, ProjectSource } from "@bb/domain";
import {
  BranchPicker,
  type BranchPickerProps,
} from "@/components/pickers/BranchPicker";
import {
  EnvironmentPickerUI,
  type EnvironmentPickerUIProps,
} from "@/components/pickers/EnvironmentPicker";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import {
  WorktreePicker,
  type ReuseThreadOption,
} from "@/components/pickers/WorktreePicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { HOST_IDS, makeHost } from "../../../.ladle/story-fixtures";

export default {
  title: "promptbox/Environment Options",
};

const noop = () => {};

const hosts: readonly Host[] = [
  makeHost({
    id: HOST_IDS.local,
    name: "Michael's MacBook Pro",
  }),
  makeHost({
    id: HOST_IDS.remote,
    name: "michael-build-box",
  }),
  makeHost({
    id: "host_disconnected",
    name: "Linux laptop",
    status: "disconnected",
  }),
];

interface MakeSourceArgs {
  hostId: string;
  id: string;
  path: string;
}

function makeSource(args: MakeSourceArgs): ProjectSource {
  return {
    id: args.id,
    projectId: "proj_demo",
    type: "local_path",
    hostId: args.hostId,
    path: args.path,
    isDefault: args.id === "src_local",
    createdAt: 0,
    updatedAt: 0,
  };
}

const sources: readonly ProjectSource[] = [
  makeSource({
    id: "src_local",
    hostId: HOST_IDS.local,
    path: "/Users/michael/Projects/bb",
  }),
  makeSource({
    id: "src_remote",
    hostId: HOST_IDS.remote,
    path: "/home/michael/bb",
  }),
];

const branchOptions: readonly string[] = [
  "main",
  "release/1.2",
  "feat/sidebar-rail",
  "fix/timeline-pagination",
  "bb/refactor-project-creation-thr_jj65bdsiwa",
];

const worktreeOptions: readonly ReuseThreadOption[] = [
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

function getStoryBranchMenuKind(
  environmentValue: string,
): BranchPickerProps["menuKind"] {
  const parsedEnvironment = parseEnvironmentValue(environmentValue);
  if (parsedEnvironment?.type !== "host") {
    return undefined;
  }

  return parsedEnvironment.mode === "worktree" ? "base" : "checkout";
}

interface EnvironmentOptionsStripProps {
  branch?: Partial<BranchPickerProps>;
  environment?: Partial<EnvironmentPickerUIProps>;
  worktreeValue?: string | null;
}

function EnvironmentOptionsStrip({
  branch,
  environment,
  worktreeValue = null,
}: EnvironmentOptionsStripProps) {
  const environmentValue = environment?.value ?? `host:${HOST_IDS.local}:local`;
  const showWorktreePicker = environmentValue === "reuse";
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border/60 bg-card px-3.5 py-2">
      <EnvironmentPickerUI
        value={environmentValue}
        onChange={noop}
        sources={sources}
        hosts={hosts}
        isLocalHost={(hostId) => hostId === HOST_IDS.local}
        muted
        modal={false}
        {...environment}
      />
      {showWorktreePicker ? (
        <WorktreePicker
          options={worktreeOptions}
          value={worktreeValue}
          onChange={noop}
          muted
          modal={false}
        />
      ) : (
        <BranchPicker
          variant="option"
          muted
          value={null}
          currentBranch="main"
          options={branchOptions}
          currentOptionLabel="Current: main"
          currentOptionTitle="Use the current checkout without switching branches"
          placeholder="Current checkout"
          triggerLabel="Current (main)"
          triggerTitle="Current: main"
          menuKind={getStoryBranchMenuKind(environmentValue)}
          onChange={noop}
          onClear={noop}
          onCreate={noop}
          modal={false}
          {...branch}
        />
      )}
    </div>
  );
}

export function Overview() {
  return (
    <div className="flex flex-col">
      <StoryCard labelWidth="180px">
        <StoryRow label="current branch" hint="no branch intent; use as-is">
          <EnvironmentOptionsStrip />
        </StoryRow>
        <StoryRow
          label="checkout branch"
          hint="explicit existing branch intent"
        >
          <EnvironmentOptionsStrip
            branch={{
              value: "release/1.2",
              triggerLabel: "Checkout: release/1.2",
              triggerTitle: "Checkout: release/1.2",
            }}
          />
        </StoryRow>
        <StoryRow
          label="new branch"
          hint="server-minted branch in primary checkout"
        >
          <EnvironmentOptionsStrip
            branch={{
              isCreatingNew: true,
              triggerLabel: "Checkout: new branch",
              triggerTitle: "Create a new branch before starting",
            }}
          />
        </StoryRow>
        <StoryRow label="dirty checkout" hint="branch-changing choices blocked">
          <EnvironmentOptionsStrip
            branch={{
              optionDisabledReason: "Dirty",
              optionDisabledTitle: "Checkout blocked by uncommitted changes",
              createDisabledReason: "Dirty",
              createDisabledTitle: "Checkout blocked by uncommitted changes",
            }}
          />
        </StoryRow>
        <StoryRow
          label="detached HEAD"
          hint="current checkout shown explicitly"
        >
          <EnvironmentOptionsStrip
            branch={{
              currentOptionLabel: "Current (detached)",
              currentOptionTitle: "Detached HEAD at a1b2c3d",
              currentBranch: null,
              triggerLabel: "Current (detached)",
              triggerTitle: "Detached HEAD at a1b2c3d",
              optionDisabledReason: "Detached",
              optionDisabledTitle: "Checkout blocked while HEAD is detached",
              createDisabledReason: "Detached",
              createDisabledTitle: "Checkout blocked while HEAD is detached",
            }}
          />
        </StoryRow>
        <StoryRow label="empty repo" hint="unborn branch state">
          <EnvironmentOptionsStrip
            branch={{
              currentOptionLabel: "Current (empty repo)",
              currentOptionTitle: "Repository has no commits yet",
              currentBranch: null,
              triggerLabel: "Current (empty repo)",
              triggerTitle: "Repository has no commits yet",
              optionDisabledReason: "Empty",
              optionDisabledTitle: "Checkout blocked before the first commit",
              createDisabledReason: "Empty",
              createDisabledTitle: "Checkout blocked before the first commit",
            }}
          />
        </StoryRow>
        <StoryRow label="loading" hint="loading checkout state">
          <EnvironmentOptionsStrip
            branch={{
              loading: true,
              triggerLabel: "Loading...",
              triggerTitle: "Loading",
            }}
          />
        </StoryRow>
        <StoryRow
          label="worktree default"
          hint="new worktree from default base"
        >
          <EnvironmentOptionsStrip
            environment={{ value: `host:${HOST_IDS.local}:worktree` }}
            branch={{
              currentOptionLabel: "main",
              triggerLabel: "Branch from: main",
              triggerTitle: "Branch from: main",
              onCreate: undefined,
            }}
          />
        </StoryRow>
        <StoryRow label="worktree branch" hint="new worktree from named base">
          <EnvironmentOptionsStrip
            environment={{ value: `host:${HOST_IDS.local}:worktree` }}
            branch={{
              currentOptionLabel: "main",
              value: "release/1.2",
              triggerLabel: "Branch from: release/1.2",
              triggerTitle: "Branch from: release/1.2",
              onCreate: undefined,
            }}
          />
        </StoryRow>
        <StoryRow
          label="reuse selected"
          hint="reuse mode with a chosen worktree"
        >
          <EnvironmentOptionsStrip
            environment={{ value: "reuse" }}
            worktreeValue="env_review_flow"
          />
        </StoryRow>
        <StoryRow
          label="reuse empty"
          hint="reuse mode before picking a worktree"
        >
          <EnvironmentOptionsStrip environment={{ value: "reuse" }} />
        </StoryRow>
        <StoryRow
          label="reuse unavailable"
          hint="environment row disabled in menu"
        >
          <EnvironmentOptionsStrip
            environment={{
              value: `host:${HOST_IDS.local}:local`,
              reuseDisabled: true,
            }}
          />
        </StoryRow>
        <StoryRow label="remote checkout" hint="remote host, primary checkout">
          <EnvironmentOptionsStrip
            environment={{ value: `host:${HOST_IDS.remote}:local` }}
          />
        </StoryRow>
        <StoryRow label="remote worktree" hint="remote host, new worktree">
          <EnvironmentOptionsStrip
            environment={{ value: `host:${HOST_IDS.remote}:worktree` }}
            branch={{
              currentOptionLabel: "main",
              triggerLabel: "Branch from: main",
              triggerTitle: "Branch from: main",
              onCreate: undefined,
            }}
          />
        </StoryRow>
      </StoryCard>
    </div>
  );
}
