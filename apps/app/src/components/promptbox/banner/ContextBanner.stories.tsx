import { useState } from "react";
import type { WorkspaceFileStatus, WorkspaceStatus } from "@bb/domain";
import { ContextBanner } from "@/components/promptbox/banner/ContextBanner";
import {
  selectWorkspaceChangedFilesSection,
  type WorkspaceChangedFilesSection,
} from "@/lib/workspace-change-summary";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Context Banner",
};

const noop = () => {};

// Production max width matches PageShell's footer cap (760px). Without it the
// banner stretches the full row width and the merge-base picker drifts far
// right of the summary, which doesn't reflect production layout.
function PromptStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

// ---------------------------------------------------------------------------
// Realistic WorkspaceStatus fixtures. Rows pass these through the same
// selectWorkspaceChangedFilesSection production uses, so the rendered
// summary text + DiffStatsTally come from the production formatter — no
// hand-rolled "5 files changed · +X -Y" spans here.
// ---------------------------------------------------------------------------

const promptboxBannerFiles: WorkspaceFileStatus[] = [
  {
    path: "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
    status: "M",
  },
  {
    path: "apps/app/src/components/promptbox/banner/PromptStackCard.tsx",
    status: "A",
  },
  {
    path: "apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx",
    status: "A",
  },
  {
    path: "apps/app/src/components/promptbox/banner/ContextBanner.tsx",
    status: "A",
  },
  {
    path: "apps/app/src/views/ThreadDetailPromptArea.tsx",
    status: "M",
  },
];

const dirtyUncommittedStatus: WorkspaceStatus = {
  workingTree: {
    state: "dirty_uncommitted",
    hasUncommittedChanges: true,
    files: promptboxBannerFiles,
    insertions: 312,
    deletions: 47,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  mergeBase: null,
};

const untrackedOnlyStatus: WorkspaceStatus = {
  workingTree: {
    state: "untracked",
    hasUncommittedChanges: false,
    files: [
      { path: "apps/app/notes/triage.md", status: "??" },
      { path: "apps/app/scripts/dev-bb-sandbox.sh", status: "??" },
    ],
    insertions: 0,
    deletions: 0,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  mergeBase: null,
};

const committedUnmergedStatus: WorkspaceStatus = {
  workingTree: {
    state: "clean",
    hasUncommittedChanges: false,
    files: [],
    insertions: 0,
    deletions: 0,
  },
  branch: {
    currentBranch: "bb/promptbox-stories",
    defaultBranch: "main",
  },
  mergeBase: {
    mergeBaseBranch: "main",
    baseRef: "abc123",
    aheadCount: 4,
    behindCount: 0,
    hasCommittedUnmergedChanges: true,
    commits: [],
    files: promptboxBannerFiles.slice(0, 3),
    insertions: 128,
    deletions: 24,
  },
};

function sectionFor(status: WorkspaceStatus): WorkspaceChangedFilesSection {
  const section = selectWorkspaceChangedFilesSection(status);
  if (!section) throw new Error("fixture should produce a section");
  return section;
}

const uncommittedSection = sectionFor(dirtyUncommittedStatus);
const untrackedSection = sectionFor(untrackedOnlyStatus);
const committedSection = sectionFor(committedUnmergedStatus);

// Default merge-base config used in feature-branch rows (production passes a
// non-null bundle whenever the thread is NOT on the default branch).
const featureBranchMergeBase = {
  branch: "main",
  options: ["main", "develop", "release/2026-05"] as const,
  onChange: noop,
};

// ---------------------------------------------------------------------------
// Per-row helper — controls expansion state locally so the toggle works.
// ---------------------------------------------------------------------------

interface RowConfig {
  section: WorkspaceChangedFilesSection;
  mergeBase?: typeof featureBranchMergeBase | null;
  initiallyExpanded?: boolean;
}

function Row({
  section,
  mergeBase = featureBranchMergeBase,
  initiallyExpanded = false,
}: RowConfig) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <PromptStage>
      <ContextBanner
        section={section}
        isChangeListExpanded={expanded}
        isDiffPanelActive={false}
        mergeBase={mergeBase}
        onPromptBannerFileClick={noop}
        onPromptGitStatsBannerClick={noop}
        onToggleChangeListExpanded={() => setExpanded((value) => !value)}
      />
    </PromptStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="uncommitted (collapsed)"
        hint="working tree has 5 modified/added files; chevron toggles WorkspaceChangesList"
      >
        <Row section={uncommittedSection} />
      </StoryRow>
      <StoryRow
        label="uncommitted (expanded)"
        hint="expanded change list visible inside the same card"
      >
        <Row section={uncommittedSection} initiallyExpanded />
      </StoryRow>
      <StoryRow
        label="untracked only"
        hint='workingTree.state = "untracked" — no insertions/deletions tally'
      >
        <Row section={untrackedSection} initiallyExpanded />
      </StoryRow>
      <StoryRow
        label="committed unmerged"
        hint="working tree clean; mergeBase has committed files"
      >
        <Row section={committedSection} />
      </StoryRow>
      <StoryRow
        label="on default branch"
        hint="mergeBase=null hides the picker (no comparison to make)"
      >
        <Row section={uncommittedSection} mergeBase={null} />
      </StoryRow>
    </StoryCard>
  );
}
