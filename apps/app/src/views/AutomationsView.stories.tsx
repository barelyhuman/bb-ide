import type { ReactNode } from "react";
import type {
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  PROJECT_IDS,
  PROJECT_NAMES,
  makeThreadSchedule,
} from "../../.ladle/story-fixtures";
import { AutomationsOverview } from "./AutomationsView";

export default {
  title: "automations/Overview",
};

interface StageProps {
  children: ReactNode;
}

const projectBb: AutomationsOverviewProject = {
  id: PROJECT_IDS.bb,
  name: PROJECT_NAMES.bb,
};
const projectPierre: AutomationsOverviewProject = {
  id: PROJECT_IDS.pierre,
  name: PROJECT_NAMES.pierre,
};

function makeOverviewThread(
  overrides: Partial<AutomationsOverviewThread> = {},
): AutomationsOverviewThread {
  const base: AutomationsOverviewThread = {
    id: "thr_demo",
    projectId: PROJECT_IDS.bb,
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    type: "standard",
  };
  return { ...base, ...overrides };
}

function scheduleItem(
  schedule: ThreadSchedule,
  thread: AutomationsOverviewThread = makeOverviewThread(),
  project: AutomationsOverviewProject = projectBb,
): AutomationsOverviewThreadSchedule {
  return { project, schedule, thread };
}

// One thread (in bb) owns two schedules so the grouping shows; a second thread
// lives in another project (pierre) to exercise the project label. Archived
// threads are filtered out server-side, so none appear on this page.
const threadSchedules: AutomationsOverviewThreadSchedule[] = [
  scheduleItem(makeThreadSchedule()),
  scheduleItem(
    makeThreadSchedule({
      id: "sched_cleanup",
      name: "Weekly cleanup",
      enabled: false,
      cron: "0 18 * * 5",
      prompt: "Close stale follow-ups and archive merged threads.",
    }),
  ),
  scheduleItem(
    makeThreadSchedule({
      id: "sched_ingest",
      projectId: PROJECT_IDS.pierre,
      name: "Daily ingest report",
      cron: "0 7 * * *",
      prompt: "Summarize overnight ingest volume and flag failures.",
    }),
    makeOverviewThread({
      id: "thr_ingest",
      projectId: PROJECT_IDS.pierre,
      title: "Ingest pipeline backfill",
      titleFallback: "Ingest pipeline backfill",
    }),
    projectPierre,
  ),
];

// PageShell fills its parent's height, so each state needs a bounded-height
// flex column to render its scroll area.
function Stage({ children }: StageProps) {
  return (
    <div className="flex h-[460px] w-full min-w-0 flex-col">{children}</div>
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="160px" className="max-w-5xl">
      <StoryRow
        label="populated"
        hint="thread schedules grouped by thread; includes disabled rows"
      >
        <Stage>
          <AutomationsOverview
            hasInitialLoadError={false}
            schedules={threadSchedules}
            isLoading={false}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="empty" hint="no thread schedules yet">
        <Stage>
          <AutomationsOverview
            hasInitialLoadError={false}
            schedules={[]}
            isLoading={false}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="loading" hint="initial fetch, no cached data">
        <Stage>
          <AutomationsOverview
            hasInitialLoadError={false}
            schedules={[]}
            isLoading
          />
        </Stage>
      </StoryRow>
      <StoryRow label="error" hint="initial fetch failed, no cached data">
        <Stage>
          <AutomationsOverview
            hasInitialLoadError
            schedules={[]}
            isLoading={false}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
