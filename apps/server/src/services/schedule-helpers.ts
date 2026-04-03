import { CronExpressionParser } from "cron-parser";

const MINIMUM_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_SAMPLE_COUNT = 512;
const MIN_INTERVAL_SAMPLE_START = new Date("2026-01-01T00:00:00.000Z");

export class ScheduleValidationError extends Error {}

interface ScheduleArgs {
  cron: string;
  timezone: string;
}

interface ScheduleAtTimeArgs extends ScheduleArgs {
  now: number;
}

function parseExpression(
  args: ScheduleAtTimeArgs,
) {
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

function assertMinimumInterval(
  args: ScheduleArgs,
) {
  const expression = parseExpression({
    ...args,
    now: MIN_INTERVAL_SAMPLE_START.getTime(),
  });
  let previous = expression.next().getTime();

  for (let sampleIndex = 0; sampleIndex < MIN_INTERVAL_SAMPLE_COUNT; sampleIndex += 1) {
    const current = expression.next().getTime();
    if (current - previous < MINIMUM_SCHEDULE_INTERVAL_MS) {
      throw new ScheduleValidationError(
        "Schedule must not run more frequently than every 5 minutes",
      );
    }
    previous = current;
  }
}

export function validateScheduleDefinition(
  args: ScheduleArgs,
) {
  assertMinimumInterval(args);
}

export function computeNextScheduledTime(
  args: ScheduleAtTimeArgs,
) {
  return parseExpression(args).next().getTime();
}
