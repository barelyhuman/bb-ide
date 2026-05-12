import {
  ThreadArchiveDialogContent,
  type ThreadArchiveDialogTarget,
} from "./ThreadArchiveDialog";
import { makeThread } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Archive",
};

const noop = () => {};

const standardThread = makeThread();
const managerThread = makeThread({
  id: "thr_manager",
  type: "manager",
  title: "Frontend Manager",
  titleFallback: "Frontend Manager",
});

export function Thread() {
  return (
    <StoryCard>
      <StoryRow
        label="uncommitted changes"
        hint="workspace has uncommitted changes; archive removes them"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: standardThread,
              workspaceWarning: {
                hasUncommittedChanges: true,
                hasCommittedUnmergedChanges: false,
              },
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="unmerged commits"
        hint="workspace has committed work not yet merged to base"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: standardThread,
              workspaceWarning: {
                hasUncommittedChanges: false,
                hasCommittedUnmergedChanges: true,
              },
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="both"
        hint="uncommitted changes AND unmerged commits"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: standardThread,
              workspaceWarning: {
                hasUncommittedChanges: true,
                hasCommittedUnmergedChanges: true,
              },
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="pending" hint="archive request in flight">
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: standardThread,
              workspaceWarning: {
                hasUncommittedChanges: true,
                hasCommittedUnmergedChanges: false,
              },
            }}
            pending
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Manager() {
  return (
    <StoryCard>
      <StoryRow
        label="assigned children"
        hint="manager with N child threads; clean workspace"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 3,
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="single assigned child"
        hint="singular phrasing for count=1"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 1,
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="children + uncommitted"
        hint="both warnings in one dialog — single confirmation"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 3,
              workspaceWarning: {
                hasUncommittedChanges: true,
                hasCommittedUnmergedChanges: false,
              },
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="children + both workspace warnings"
        hint="all warnings combined"
      >
        <DialogStage>
          <ThreadArchiveDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 2,
              workspaceWarning: {
                hasUncommittedChanges: true,
                hasCommittedUnmergedChanges: true,
              },
            }}
            pending={false}
            onOpenChange={noop}
            onArchive={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
