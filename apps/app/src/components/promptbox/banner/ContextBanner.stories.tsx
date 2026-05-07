import { useState } from "react";
import type { WorkspaceFileStatus } from "@bb/domain";
import { ContextBanner } from "@/components/promptbox/banner/ContextBanner";
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
// Realistic file fixtures — branch we're working on right now.
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

const dirtyUntrackedFiles: WorkspaceFileStatus[] = [
  { path: "apps/app/notes/triage.md", status: "??" },
  { path: "apps/app/scripts/dev-bb-sandbox.sh", status: "??" },
];

const branchOptions = ["main", "develop", "release/2026-05"] as const;

// ---------------------------------------------------------------------------
// Per-row helper — controls expansion state locally so the toggle works.
// ---------------------------------------------------------------------------

interface RowConfig {
  promptBannerSummary: React.ReactNode;
  promptBannerFiles?: WorkspaceFileStatus[];
  canExpandPromptChangeList?: boolean;
  showBranchComparisonUi?: boolean;
  promptBannerMergeBaseBranch?: string;
  mergeBaseBranchOptions?: readonly string[];
  initiallyExpanded?: boolean;
}

function Row({
  promptBannerSummary,
  promptBannerFiles,
  canExpandPromptChangeList = false,
  showBranchComparisonUi = false,
  promptBannerMergeBaseBranch,
  mergeBaseBranchOptions,
  initiallyExpanded = false,
}: RowConfig) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <PromptStage>
      <ContextBanner
        canExpandPromptChangeList={canExpandPromptChangeList}
        isChangeListExpanded={expanded}
        isDiffPanelActive={false}
        mergeBaseBranchOptions={mergeBaseBranchOptions}
        onPromptBannerFileClick={noop}
        onPromptBannerMergeBaseBranchChange={
          showBranchComparisonUi ? noop : undefined
        }
        onPromptGitStatsBannerClick={noop}
        onToggleChangeListExpanded={() => setExpanded((value) => !value)}
        promptBannerFiles={promptBannerFiles}
        promptBannerMergeBaseBranch={promptBannerMergeBaseBranch}
        promptBannerSummary={promptBannerSummary}
        showBranchComparisonUi={showBranchComparisonUi}
      />
    </PromptStage>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="summary only"
        hint="non-expandable banner; e.g. clean ahead/behind text without files"
      >
        <Row promptBannerSummary={<span>Ahead 3 · behind 1</span>} />
      </StoryRow>
      <StoryRow
        label="dirty + collapsed"
        hint="expandable; chevron toggles WorkspaceChangesList"
      >
        <Row
          promptBannerSummary={<span>5 files changed · +312 −47</span>}
          promptBannerFiles={promptboxBannerFiles}
          canExpandPromptChangeList
        />
      </StoryRow>
      <StoryRow
        label="dirty + expanded"
        hint="expanded change list visible inside the same card"
      >
        <Row
          promptBannerSummary={<span>5 files changed · +312 −47</span>}
          promptBannerFiles={promptboxBannerFiles}
          canExpandPromptChangeList
          initiallyExpanded
        />
      </StoryRow>
      <StoryRow
        label="untracked files"
        hint="working-tree state: untracked"
      >
        <Row
          promptBannerSummary={<span>2 untracked files</span>}
          promptBannerFiles={dirtyUntrackedFiles}
          canExpandPromptChangeList
        />
      </StoryRow>
      <StoryRow
        label="branch comparison + picker"
        hint="merge-base selectable from a branch list"
      >
        <Row
          promptBannerSummary={<span>2 commits ahead of merge base</span>}
          promptBannerFiles={promptboxBannerFiles.slice(0, 2)}
          canExpandPromptChangeList
          showBranchComparisonUi
          promptBannerMergeBaseBranch="main"
          mergeBaseBranchOptions={branchOptions}
        />
      </StoryRow>
      <StoryRow
        label="branch comparison, no picker"
        hint="no candidates → readonly merge-base label"
      >
        <Row
          promptBannerSummary={<span>Ahead 1, behind 0</span>}
          showBranchComparisonUi
          promptBannerMergeBaseBranch="main"
        />
      </StoryRow>
      <StoryRow
        label="no branch comparison"
        hint='shows "Includes all threads in this working directory"'
      >
        <Row
          promptBannerSummary={<span>3 files changed · +42 −12</span>}
          promptBannerFiles={promptboxBannerFiles.slice(0, 3)}
          canExpandPromptChangeList
        />
      </StoryRow>
    </StoryCard>
  );
}
