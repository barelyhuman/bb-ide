import type { ReactNode } from "react";
import type {
  Automation,
  AutomationsOverviewAutomation,
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { StoryCard, StoryRow } from "../../.ladle/story-card";
import {
  HOST_IDS,
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

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  const base: Automation = {
    id: "auto_daily_health",
    projectId: PROJECT_IDS.bb,
    name: "Daily project health check",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 9 * * 1-5",
      timezone: "America/Los_Angeles",
    },
    action: {
      actionType: "scheduled-thread",
      threadRequest: {
        providerId: "codex",
        model: "gpt-5",
        input: [
          {
            type: "text",
            text: "Review project health and summarize risks.",
            mentions: [],
          },
        ],
        environment: {
          type: "host",
          hostId: HOST_IDS.local,
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
      },
    },
    autoArchive: false,
    nextRunAt: 1_700_003_600_000,
    lastRunAt: null,
    runCount: 0,
    isValid: true,
    validationIssues: [],
    createdAt: 0,
    updatedAt: 100,
  };
  return { ...base, ...overrides };
}

function automationItem(
  automation: Automation,
  project: AutomationsOverviewProject = projectBb,
): AutomationsOverviewAutomation {
  return { automation, project };
}

function scheduleItem(
  schedule: ThreadSchedule,
  thread: AutomationsOverviewThread = makeOverviewThread(),
  project: AutomationsOverviewProject = projectBb,
): AutomationsOverviewThreadSchedule {
  return { project, schedule, thread };
}

const automations: AutomationsOverviewAutomation[] = [
  automationItem(makeAutomation()),
  automationItem(
    makeAutomation({
      id: "auto_weekly_cleanup",
      projectId: PROJECT_IDS.pierre,
      name: "Weekly dependency cleanup",
      enabled: false,
      trigger: {
        triggerType: "schedule",
        cron: "0 18 * * 5",
        timezone: "America/Los_Angeles",
      },
      nextRunAt: null,
    }),
    projectPierre,
  ),
];

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
        hint="project automations plus thread schedules grouped by thread; includes disabled rows"
      >
        <Stage>
          <AutomationsOverview
            automations={automations}
            hasInitialLoadError={false}
            schedules={threadSchedules}
            isLoading={false}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="empty" hint="no automations or schedules yet">
        <Stage>
          <AutomationsOverview
            automations={[]}
            hasInitialLoadError={false}
            schedules={[]}
            isLoading={false}
          />
        </Stage>
      </StoryRow>
      <StoryRow label="loading" hint="initial fetch, no cached data">
        <Stage>
          <AutomationsOverview
            automations={[]}
            hasInitialLoadError={false}
            schedules={[]}
            isLoading
          />
        </Stage>
      </StoryRow>
      <StoryRow label="error" hint="initial fetch failed, no cached data">
        <Stage>
          <AutomationsOverview
            automations={[]}
            hasInitialLoadError
            schedules={[]}
            isLoading={false}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
