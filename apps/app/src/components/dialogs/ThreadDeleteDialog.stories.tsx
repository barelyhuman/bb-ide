import {
  ThreadDeleteDialogContent,
  type ThreadDeleteDialogTarget,
} from "./ThreadDeleteDialog";
import { makeThread } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Delete",
};

const noop = () => {};

const standardThread = makeThread();
const managerThread = makeThread({
  id: "thr_manager",
  type: "manager",
  title: "Frontend Manager",
  titleFallback: "Frontend Manager",
});

const dirty = {
  hasUncommittedChanges: true,
  hasCommittedUnmergedChanges: false,
};

const dirtyAndUnmerged = {
  hasUncommittedChanges: true,
  hasCommittedUnmergedChanges: true,
};

export function Thread() {
  return (
    <StoryCard>
      <StoryRow
        label="clean workspace"
        hint="basic confirm — no warnings, just 'cannot be undone'"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="uncommitted changes"
        hint="dirty managed workspace will be removed alongside the thread"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread, workspaceWarning: dirty }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="uncommitted + unmerged"
        hint="both workspace warnings combined"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: standardThread,
              workspaceWarning: dirtyAndUnmerged,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="pending" hint="delete request in flight">
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: standardThread }}
            pending
            onOpenChange={noop}
            onDelete={noop}
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
        label="no children, clean workspace"
        hint="same minimal confirm as a thread"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{ thread: managerThread }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="assigned children"
        hint="N child threads will lose their manager"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 3,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="single assigned child"
        hint="singular phrasing for count=1"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 1,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="children + uncommitted"
        hint="both warnings combined in one dialog"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 3,
              workspaceWarning: dirty,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="children + both workspace warnings"
        hint="all warnings combined"
      >
        <DialogStage>
          <ThreadDeleteDialogContent
            target={{
              thread: managerThread,
              assignedChildCount: 2,
              workspaceWarning: dirtyAndUnmerged,
            }}
            pending={false}
            onOpenChange={noop}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
