import { CronExpressionParser } from "cron-parser";
import type { ScheduleDefinition, WeeklyScheduleDefinition } from "@bb/server-contract";

const MINIMUM_SCHEDULE_INTERVAL_MINUTES = 5;
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const WEEKDAY_ORDER = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] satisfies WeeklyScheduleDefinition["weekdays"];

interface ScheduleAtTimeArgs {
  now: number;
  schedule: ScheduleDefinition;
}

interface ScheduleExpressionSetArgs {
  expressionSet: string;
  now: number;
  timezone: string;
}

interface LegacyCronScheduleArgs {
  cron: string;
  timezone: string;
}

interface TimeOfDayParts {
  hour: number;
  minute: number;
}

export class ScheduleValidationError extends Error {}

function parseExpression(args: {
  cron: string;
  now: number;
  timezone: string;
}) {
  try {
    return CronExpressionParser.parse(args.cron, {
      currentDate: new Date(args.now),
      tz: args.timezone,
    });
  } catch (error) {
    throw new ScheduleValidationError(
      error instanceof Error ? error.message : "Invalid cron expression",
    );
  }
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
    }).format(new Date(0));
  } catch {
    throw new ScheduleValidationError("Invalid timezone");
  }
}

function parseTimeOfDay(time: string): TimeOfDayParts {
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/u.exec(time);
  if (!match?.groups) {
    throw new ScheduleValidationError("Invalid time-of-day");
  }

  return {
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
  };
}

function toTimeOfDayString(parts: TimeOfDayParts): string {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function toMinuteOfDay(time: string): number {
  const { hour, minute } = parseTimeOfDay(time);
  return hour * 60 + minute;
}

function assertMinimumGapWithinSortedPoints(
  args: {
    cycleLengthMinutes: number;
    points: number[];
    wrapAround: boolean;
  },
): void {
  if (args.points.length <= 1) {
    return;
  }

  const sorted = [...args.points].sort(compareNumbers);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current - previous < MINIMUM_SCHEDULE_INTERVAL_MINUTES) {
      throw new ScheduleValidationError(
        "Schedule must not run more frequently than every 5 minutes",
      );
    }
  }

  if (!args.wrapAround) {
    return;
  }

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const wrapGap = args.cycleLengthMinutes - last + first;
  if (wrapGap < MINIMUM_SCHEDULE_INTERVAL_MINUTES) {
    throw new ScheduleValidationError(
      "Schedule must not run more frequently than every 5 minutes",
    );
  }
}

function toWeekdayIndex(weekday: WeeklyScheduleDefinition["weekdays"][number]): number {
  return WEEKDAY_ORDER.indexOf(weekday);
}

function toWeeklyOccurrencePoints(
  schedule: WeeklyScheduleDefinition,
): number[] {
  const timeOffsets = schedule.times.map(toMinuteOfDay);
  return schedule.weekdays.flatMap((weekday) => {
    const weekdayOffset = toWeekdayIndex(weekday) * MINUTES_PER_DAY;
    return timeOffsets.map((timeOffset) => weekdayOffset + timeOffset);
  });
}

function toHourlyScheduleExpression(schedule: Extract<ScheduleDefinition, { kind: "hourly" }>): string {
  const hourField = schedule.intervalHours === 1 ? "*" : `*/${schedule.intervalHours}`;
  return `${schedule.minute} ${hourField} * * *`;
}

function toDailyScheduleExpressions(schedule: Extract<ScheduleDefinition, { kind: "daily" }>): string[] {
  return schedule.times.map((time) => {
    const { hour, minute } = parseTimeOfDay(time);
    return `${minute} ${hour} * * *`;
  });
}

function toCronWeekdayField(weekdays: WeeklyScheduleDefinition["weekdays"]): string {
  const cronValues = weekdays
    .map((weekday) => {
      if (weekday === "sun") {
        return 0;
      }
      return toWeekdayIndex(weekday) + 1;
    })
    .sort(compareNumbers);
  return cronValues.join(",");
}

function toWeeklyScheduleExpressions(schedule: Extract<ScheduleDefinition, { kind: "weekly" }>): string[] {
  const weekdayField = toCronWeekdayField(schedule.weekdays);
  return schedule.times.map((time) => {
    const { hour, minute } = parseTimeOfDay(time);
    return `${minute} ${hour} * * ${weekdayField}`;
  });
}

function toMonthlyScheduleExpressions(schedule: Extract<ScheduleDefinition, { kind: "monthly" }>): string[] {
  return schedule.times.map((time) => {
    const { hour, minute } = parseTimeOfDay(time);
    return `${minute} ${hour} ${schedule.dayOfMonth} * *`;
  });
}

export function buildScheduleExpressions(schedule: ScheduleDefinition): string[] {
  switch (schedule.kind) {
    case "hourly":
      return [toHourlyScheduleExpression(schedule)];
    case "daily":
      return toDailyScheduleExpressions(schedule);
    case "weekly":
      return toWeeklyScheduleExpressions(schedule);
    case "monthly":
      return toMonthlyScheduleExpressions(schedule);
    default: {
      const exhaustiveCheck: never = schedule;
      throw new Error(`Unsupported schedule definition: ${exhaustiveCheck}`);
    }
  }
}

export function serializeScheduleExpressionSet(schedule: ScheduleDefinition): string {
  return buildScheduleExpressions(schedule).join("\n");
}

function parseScheduleExpressionSet(expressionSet: string): string[] {
  return expressionSet
    .split("\n")
    .map((expression) => expression.trim())
    .filter((expression) => expression.length > 0);
}

function computeNextScheduledTimeFromExpressions(
  args: {
    expressions: readonly string[];
    now: number;
    timezone: string;
  },
): number {
  let nextRunAt: number | null = null;

  for (const expression of args.expressions) {
    const candidate = parseExpression({
      cron: expression,
      now: args.now,
      timezone: args.timezone,
    }).next().getTime();
    if (nextRunAt === null || candidate < nextRunAt) {
      nextRunAt = candidate;
    }
  }

  if (nextRunAt === null) {
    throw new ScheduleValidationError("Schedule must include at least one occurrence");
  }

  return nextRunAt;
}

function parseCronFieldParts(field: string): string[] {
  return field.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseSingleNumberField(
  field: string,
  args: {
    allowWildcard?: boolean;
    max: number;
    min: number;
  },
): number | null {
  if (args.allowWildcard && field === "*") {
    return null;
  }

  if (!/^\d+$/u.test(field)) {
    throw new ScheduleValidationError("Unsupported cron expression");
  }

  const value = Number(field);
  if (!Number.isInteger(value) || value < args.min || value > args.max) {
    throw new ScheduleValidationError("Unsupported cron expression");
  }

  return value;
}

function parseHourField(field: string): { intervalHours: number | null; times: string[] } {
  if (field === "*") {
    return {
      intervalHours: 1,
      times: [],
    };
  }

  const stepMatch = /^\*\/(?<step>\d+)$/u.exec(field);
  if (stepMatch?.groups?.step) {
    const intervalHours = Number(stepMatch.groups.step);
    if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) {
      throw new ScheduleValidationError("Unsupported cron expression");
    }
    return {
      intervalHours,
      times: [],
    };
  }

  const hours = parseCronFieldParts(field).map((part) => parseSingleNumberField(part, {
    max: 23,
    min: 0,
  }) ?? 0);
  if (new Set(hours).size !== hours.length) {
    throw new ScheduleValidationError("Unsupported cron expression");
  }

  return {
    intervalHours: null,
    times: hours.sort(compareNumbers).map((hour) => toTimeOfDayString({
      hour,
      minute: 0,
    })),
  };
}

function parseWeekdayField(
  field: string,
): WeeklyScheduleDefinition["weekdays"] {
  const weekdays = new Set<WeeklyScheduleDefinition["weekdays"][number]>();

  for (const part of parseCronFieldParts(field)) {
    const rangeMatch = /^(?<start>\d+)-(?<end>\d+)$/u.exec(part);
    if (rangeMatch?.groups?.start && rangeMatch.groups.end) {
      const start = parseSingleNumberField(rangeMatch.groups.start, { max: 7, min: 0 }) ?? 0;
      const end = parseSingleNumberField(rangeMatch.groups.end, { max: 7, min: 0 }) ?? 0;
      if (start > end) {
        throw new ScheduleValidationError("Unsupported cron expression");
      }
      for (let value = start; value <= end; value += 1) {
        weekdays.add(toWeekdayName(value));
      }
      continue;
    }

    weekdays.add(
      toWeekdayName(parseSingleNumberField(part, { max: 7, min: 0 }) ?? 0),
    );
  }

  return WEEKDAY_ORDER.filter((weekday) => weekdays.has(weekday));
}

function toWeekdayName(value: number): WeeklyScheduleDefinition["weekdays"][number] {
  if (value === 0 || value === 7) {
    return "sun";
  }
  const weekday = WEEKDAY_ORDER[value - 1];
  if (!weekday) {
    throw new ScheduleValidationError("Unsupported cron expression");
  }
  return weekday;
}

function mergeMinuteIntoTimes(times: string[], minute: number): string[] {
  return times.map((time) => {
    const hour = parseTimeOfDay(time).hour;
    return toTimeOfDayString({
      hour,
      minute,
    });
  });
}

export function parseLegacyCronScheduleDefinition(
  args: LegacyCronScheduleArgs,
): ScheduleDefinition {
  const fields = args.cron.trim().split(/\s+/u);
  if (fields.length !== 5) {
    throw new ScheduleValidationError("Invalid cron expression");
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;
  const minute = parseSingleNumberField(minuteField, { max: 59, min: 0 });
  if (minute === null || monthField !== "*") {
    throw new ScheduleValidationError("Unsupported cron expression");
  }

  const parsedHourField = parseHourField(hourField);
  if (dayOfMonthField === "*" && dayOfWeekField === "*") {
    if (parsedHourField.intervalHours !== null) {
      return {
        kind: "hourly",
        intervalHours: parsedHourField.intervalHours,
        minute,
        timezone: args.timezone,
      };
    }

    return {
      kind: "daily",
      times: mergeMinuteIntoTimes(parsedHourField.times, minute),
      timezone: args.timezone,
    };
  }

  if (dayOfMonthField === "*" && dayOfWeekField !== "*") {
    if (parsedHourField.intervalHours !== null) {
      throw new ScheduleValidationError("Unsupported cron expression");
    }
    return {
      kind: "weekly",
      times: mergeMinuteIntoTimes(parsedHourField.times, minute),
      timezone: args.timezone,
      weekdays: parseWeekdayField(dayOfWeekField),
    };
  }

  if (dayOfWeekField === "*") {
    if (parsedHourField.intervalHours !== null) {
      throw new ScheduleValidationError("Unsupported cron expression");
    }
    const dayOfMonth = parseSingleNumberField(dayOfMonthField, { max: 31, min: 1 });
    if (dayOfMonth === null) {
      throw new ScheduleValidationError("Unsupported cron expression");
    }
    return {
      dayOfMonth,
      kind: "monthly",
      times: mergeMinuteIntoTimes(parsedHourField.times, minute),
      timezone: args.timezone,
    };
  }

  throw new ScheduleValidationError("Unsupported cron expression");
}

export function validateScheduleDefinition(
  schedule: ScheduleDefinition,
): void {
  assertValidTimezone(schedule.timezone);

  switch (schedule.kind) {
    case "hourly":
      return;
    case "daily":
      assertMinimumGapWithinSortedPoints({
        cycleLengthMinutes: MINUTES_PER_DAY,
        points: schedule.times.map(toMinuteOfDay),
        wrapAround: true,
      });
      return;
    case "weekly":
      assertMinimumGapWithinSortedPoints({
        cycleLengthMinutes: MINUTES_PER_WEEK,
        points: toWeeklyOccurrencePoints(schedule),
        wrapAround: true,
      });
      return;
    case "monthly":
      assertMinimumGapWithinSortedPoints({
        cycleLengthMinutes: MINUTES_PER_DAY,
        points: schedule.times.map(toMinuteOfDay),
        wrapAround: false,
      });
      return;
    default: {
      const exhaustiveCheck: never = schedule;
      throw new Error(`Unsupported schedule definition: ${exhaustiveCheck}`);
    }
  }
}

export function computeNextScheduledTime(
  args: ScheduleAtTimeArgs,
): number {
  return computeNextScheduledTimeFromExpressions({
    expressions: buildScheduleExpressions(args.schedule),
    now: args.now,
    timezone: args.schedule.timezone,
  });
}

export function computeNextScheduledTimeForExpressionSet(
  args: ScheduleExpressionSetArgs,
): number {
  return computeNextScheduledTimeFromExpressions({
    expressions: parseScheduleExpressionSet(args.expressionSet),
    now: args.now,
    timezone: args.timezone,
  });
}
