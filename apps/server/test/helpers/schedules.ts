import type {
  AutomationScheduleTrigger,
  DailyScheduleDefinition,
  HourlyScheduleDefinition,
  MonthlyScheduleDefinition,
  ScheduleDefinition,
  WeeklyScheduleDefinition,
} from "@bb/server-contract";

interface HourlyScheduleArgs {
  intervalHours: number;
  minute?: number;
  timezone?: string;
}

interface DailyScheduleArgs {
  times: string[];
  timezone?: string;
}

interface WeeklyScheduleArgs {
  times: string[];
  timezone?: string;
  weekdays: WeeklyScheduleDefinition["weekdays"];
}

interface MonthlyScheduleArgs {
  dayOfMonth: number;
  times: string[];
  timezone?: string;
}

const DEFAULT_TIMEZONE = "UTC";

export function createHourlySchedule(
  args: HourlyScheduleArgs,
): HourlyScheduleDefinition {
  return {
    kind: "hourly",
    intervalHours: args.intervalHours,
    minute: args.minute ?? 0,
    timezone: args.timezone ?? DEFAULT_TIMEZONE,
  };
}

export function createDailySchedule(
  args: DailyScheduleArgs,
): DailyScheduleDefinition {
  return {
    kind: "daily",
    times: args.times,
    timezone: args.timezone ?? DEFAULT_TIMEZONE,
  };
}

export function createWeeklySchedule(
  args: WeeklyScheduleArgs,
): WeeklyScheduleDefinition {
  return {
    kind: "weekly",
    times: args.times,
    timezone: args.timezone ?? DEFAULT_TIMEZONE,
    weekdays: args.weekdays,
  };
}

export function createMonthlySchedule(
  args: MonthlyScheduleArgs,
): MonthlyScheduleDefinition {
  return {
    dayOfMonth: args.dayOfMonth,
    kind: "monthly",
    times: args.times,
    timezone: args.timezone ?? DEFAULT_TIMEZONE,
  };
}

export function createScheduleTrigger(
  schedule: ScheduleDefinition,
): AutomationScheduleTrigger {
  return {
    triggerType: "schedule",
    schedule,
  };
}
