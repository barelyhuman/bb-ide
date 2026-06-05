import { Link } from "react-router-dom";
import type {
  Automation,
  AutomationsOverviewAutomation,
  AutomationsOverviewProject,
  AutomationsOverviewThread,
  AutomationsOverviewThreadSchedule,
  ThreadSchedule,
} from "@bb/server-contract";
import { PageShell } from "@/components/ui/page-shell.js";
import { useAutomationsOverview } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  formatCronCadence,
  formatScheduleRunTime,
  formatScheduleStatusLabel,
} from "@/lib/format-schedule";
import { cn } from "@/lib/utils";

interface ThreadScheduleGroup {
  thread: AutomationsOverviewThread;
  project: AutomationsOverviewProject;
  schedules: ThreadSchedule[];
}

interface SectionHeaderProps {
  count: number;
  title: string;
}

interface ProjectAutomationRowProps {
  item: AutomationsOverviewAutomation;
}

interface ProjectAutomationsSectionProps {
  automations: readonly AutomationsOverviewAutomation[];
}

interface ThreadScheduleGroupSectionProps {
  group: ThreadScheduleGroup;
}

interface ThreadSchedulesSectionProps {
  schedules: readonly AutomationsOverviewThreadSchedule[];
}

function automationStatus(automation: Automation): string {
  if (!automation.isValid) {
    return "Needs edit";
  }
  if (!automation.enabled) {
    return "Paused";
  }
  if (automation.nextRunAt === null) {
    return "Not scheduled";
  }
  return `Next ${formatScheduleRunTime(automation.nextRunAt)}`;
}

function groupSchedulesByThread(
  items: readonly AutomationsOverviewThreadSchedule[],
): ThreadScheduleGroup[] {
  const groups = new Map<string, ThreadScheduleGroup>();
  const orderedGroups: ThreadScheduleGroup[] = [];
  for (const { thread, project, schedule } of items) {
    let group = groups.get(thread.id);
    if (!group) {
      group = { thread, project, schedules: [] };
      groups.set(thread.id, group);
      orderedGroups.push(group);
    }
    group.schedules.push(schedule);
  }
  return orderedGroups;
}

function SectionHeader({ count, title }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
        {title}
      </h2>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  );
}

function ProjectAutomationRow({ item }: ProjectAutomationRowProps) {
  const { automation, project } = item;

  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 text-xs",
        (!automation.enabled || !automation.isValid) && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          •
        </span>
        <p className="min-w-0 truncate">
          <span className="text-foreground">{automation.name}</span>
          <span className="ml-2 text-muted-foreground">
            {formatCronCadence(automation.trigger.cron)}
          </span>
          <span className="ml-2 text-muted-foreground">{project.name}</span>
        </p>
      </div>
      <span className="shrink-0 text-muted-foreground">
        {automationStatus(automation)}
      </span>
    </div>
  );
}

function ProjectAutomationsSection({
  automations,
}: ProjectAutomationsSectionProps) {
  return (
    <section className="space-y-2">
      <SectionHeader count={automations.length} title="Project automations" />
      {automations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No project automations yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {automations.map((item) => (
            <ProjectAutomationRow key={item.automation.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ThreadScheduleGroupSection({
  group,
}: ThreadScheduleGroupSectionProps) {
  const { thread, project, schedules } = group;

  return (
    <section>
      <div className="flex min-w-0 items-baseline gap-2">
        <Link
          to={getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          })}
          className="min-w-0 truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
        >
          {getThreadDisplayTitle(thread)}
        </Link>
        <span className="shrink-0 text-xs text-muted-foreground">
          {project.name}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {schedules.map((schedule) => (
          <div
            key={schedule.id}
            className={cn(
              "flex items-baseline justify-between gap-4 text-xs",
              !schedule.enabled && "opacity-60",
            )}
          >
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
              >
                •
              </span>
              <p className="min-w-0 truncate">
                <span className="text-foreground">{schedule.name}</span>
                <span className="ml-2 text-muted-foreground">
                  {formatCronCadence(schedule.cron)}
                </span>
              </p>
            </div>
            <span className="shrink-0 text-muted-foreground">
              {formatScheduleStatusLabel({
                enabled: schedule.enabled,
                nextRunAt: schedule.nextFireAt,
              })}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ThreadSchedulesSection({ schedules }: ThreadSchedulesSectionProps) {
  const groups = groupSchedulesByThread(schedules);

  return (
    <section className="space-y-2">
      <SectionHeader count={schedules.length} title="Thread schedules" />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No thread schedules yet.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <ThreadScheduleGroupSection key={group.thread.id} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

export interface AutomationsOverviewProps {
  automations: readonly AutomationsOverviewAutomation[];
  hasInitialLoadError: boolean;
  schedules: readonly AutomationsOverviewThreadSchedule[];
  isLoading: boolean;
}

export function AutomationsOverview({
  automations,
  hasInitialLoadError,
  schedules,
  isLoading,
}: AutomationsOverviewProps) {
  const isEmpty =
    !isLoading &&
    !hasInitialLoadError &&
    automations.length === 0 &&
    schedules.length === 0;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasInitialLoadError ? (
          <p className="text-sm text-destructive">
            Failed to load automations.
          </p>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground">
            No automations or schedules yet.
          </p>
        ) : (
          <div className="space-y-6">
            <ProjectAutomationsSection automations={automations} />
            <ThreadSchedulesSection schedules={schedules} />
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function AutomationsView() {
  const automationsOverviewQuery = useAutomationsOverview();
  const automations = automationsOverviewQuery.data?.automations ?? [];
  const schedules = automationsOverviewQuery.data?.threadSchedules ?? [];
  const hasInitialLoadError =
    automationsOverviewQuery.isError &&
    automationsOverviewQuery.data === undefined;
  const isLoading =
    automationsOverviewQuery.isFetching &&
    automationsOverviewQuery.data === undefined &&
    !hasInitialLoadError;

  return (
    <AutomationsOverview
      automations={automations}
      hasInitialLoadError={hasInitialLoadError}
      schedules={schedules}
      isLoading={isLoading}
    />
  );
}
