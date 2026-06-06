// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  Automation,
  AutomationsOverviewAutomation,
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationsOverview } from "./AutomationsView";

type AutomationOverrides = Partial<Automation>;
type ThreadScheduleOverrides = Partial<ThreadSchedule>;
type OverviewThreadOverrides = Partial<AutomationsOverviewThread>;

interface RenderOverviewArgs {
  automations: readonly AutomationsOverviewAutomation[];
  hasInitialLoadError?: boolean;
  schedules: readonly AutomationsOverviewThreadSchedule[];
  isLoading?: boolean;
}

const project: AutomationsOverviewProject = {
  id: "proj_bb",
  name: "bb",
};

function makeAutomation(
  overrides: AutomationOverrides = {},
): AutomationsOverviewAutomation {
  const automation: Automation = {
    id: "auto_daily_health",
    projectId: project.id,
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
          hostId: "host_local",
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
      },
    },
    autoArchive: false,
    nextRunAt: Date.parse("2026-06-08T16:00:00.000Z"),
    lastRunAt: null,
    runCount: 0,
    isValid: true,
    validationIssues: [],
    createdAt: 1,
    updatedAt: 1,
  };

  return {
    automation: { ...automation, ...overrides },
    project,
  };
}

function makeOverviewThread(
  overrides: OverviewThreadOverrides = {},
): AutomationsOverviewThread {
  const thread: AutomationsOverviewThread = {
    id: "thr_audit",
    projectId: project.id,
    title: "Audit recurring permission failures",
    titleFallback: "Audit recurring permission failures",
    type: "standard",
  };

  return { ...thread, ...overrides };
}

function makeThreadSchedule(
  overrides: ThreadScheduleOverrides = {},
): AutomationsOverviewThreadSchedule {
  const schedule: ThreadSchedule = {
    id: "sched_standup",
    projectId: project.id,
    threadId: "thr_audit",
    name: "Daily standup nudge",
    enabled: true,
    kind: "cron",
    cron: "0 8 * * 1-5",
    timezone: "America/Los_Angeles",
    prompt: "Summarize what changed since yesterday.",
    nextFireAt: Date.parse("2026-06-08T15:00:00.000Z"),
    lastFiredAt: null,
    createdAt: 1,
    updatedAt: 1,
  };

  const mergedSchedule = { ...schedule, ...overrides };

  return {
    project,
    schedule: mergedSchedule,
    thread: makeOverviewThread({ id: mergedSchedule.threadId }),
  };
}

function renderOverview({
  automations,
  hasInitialLoadError = false,
  schedules,
  isLoading = false,
}: RenderOverviewArgs) {
  return render(
    <MemoryRouter>
      <div className="h-[480px]">
        <AutomationsOverview
          automations={automations}
          hasInitialLoadError={hasInitialLoadError}
          schedules={schedules}
          isLoading={isLoading}
        />
      </div>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("AutomationsOverview", () => {
  it("renders project automations and grouped thread schedules", () => {
    renderOverview({
      automations: [
        makeAutomation(),
        makeAutomation({
          id: "auto_needs_edit",
          name: "Broken project automation",
          isValid: false,
          validationIssues: ["Host is unavailable"],
        }),
      ],
      schedules: [
        makeThreadSchedule(),
        makeThreadSchedule({
          id: "sched_weekly_cleanup",
          name: "Weekly cleanup",
          enabled: false,
          cron: "0 18 * * 5",
        }),
      ],
    });

    expect(screen.getByText("Project automations")).not.toBeNull();
    expect(screen.getByText("Daily project health check")).not.toBeNull();
    expect(screen.getByText("Broken project automation")).not.toBeNull();
    expect(screen.getByText("Needs edit")).not.toBeNull();
    expect(screen.getByText("Thread schedules")).not.toBeNull();
    expect(
      screen.getByText("Audit recurring permission failures"),
    ).not.toBeNull();
    expect(screen.getByText("Daily standup nudge")).not.toBeNull();
    expect(screen.getByText("Weekly cleanup")).not.toBeNull();
    expect(screen.getByText("Paused")).not.toBeNull();
  });

  it("groups schedules under distinct threads in order", () => {
    const auditSchedule = makeThreadSchedule({
      id: "sched_audit",
      name: "Audit nudge",
      threadId: "thr_audit",
    });
    const releaseSchedule = makeThreadSchedule({
      id: "sched_release",
      name: "Release nudge",
      threadId: "thr_release",
    });

    renderOverview({
      automations: [],
      schedules: [
        auditSchedule,
        {
          ...releaseSchedule,
          thread: makeOverviewThread({
            id: "thr_release",
            title: "Prepare release notes",
            titleFallback: "Prepare release notes",
          }),
        },
      ],
    });

    const threadLinks = screen.getAllByRole("link");
    expect(threadLinks.map((link) => link.textContent)).toEqual([
      "Audit recurring permission failures",
      "Prepare release notes",
    ]);

    const auditGroup = threadLinks[0]?.closest("section");
    const releaseGroup = threadLinks[1]?.closest("section");
    if (
      !(auditGroup instanceof HTMLElement) ||
      !(releaseGroup instanceof HTMLElement)
    ) {
      throw new Error("Expected schedule groups to render as sections");
    }

    expect(within(auditGroup).getByText("Audit nudge")).not.toBeNull();
    expect(within(auditGroup).queryByText("Release nudge")).toBeNull();
    expect(within(releaseGroup).getByText("Release nudge")).not.toBeNull();
    expect(within(releaseGroup).queryByText("Audit nudge")).toBeNull();
  });

  it("renders a combined empty state", () => {
    renderOverview({ automations: [], schedules: [] });

    expect(screen.getByText("No automations or schedules yet.")).not.toBeNull();
    expect(screen.queryByText("Project automations")).toBeNull();
    expect(screen.queryByText("Thread schedules")).toBeNull();
  });

  it("renders the loading state before cached data exists", () => {
    renderOverview({ automations: [], schedules: [], isLoading: true });

    expect(screen.getByText("Loading...")).not.toBeNull();
  });

  it("renders an error state when the initial fetch fails", () => {
    renderOverview({
      automations: [],
      hasInitialLoadError: true,
      schedules: [],
    });

    expect(screen.getByText("Failed to load automations.")).not.toBeNull();
    expect(screen.queryByText("No automations or schedules yet.")).toBeNull();
  });
});
