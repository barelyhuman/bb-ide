import { Command } from "commander";
import type {
  CreateThreadScheduleRequest,
  ThreadSchedule,
  UpdateThreadScheduleConfigRequest,
  UpdateThreadScheduleEnabledRequest,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { renderBorderlessTable } from "../../table.js";
import {
  outputJson,
  printContextLabel,
  requireThreadIdOrSelf,
  requireThreadIdWithLabelOrSelf,
} from "../helpers.js";

interface ThreadScheduleBaseOptions {
  json?: boolean;
}

interface ThreadScheduleTargetOptions extends ThreadScheduleBaseOptions {
  self?: boolean;
}

interface ThreadScheduleCreateCommandOptions
  extends ThreadScheduleTargetOptions {
  cron: string;
  disabled?: boolean;
  name: string;
  prompt: string;
  timezone: string;
}

interface ThreadScheduleUpdateCommandOptions
  extends ThreadScheduleBaseOptions {
  cron?: string;
  name?: string;
  prompt?: string;
  timezone?: string;
}

interface ThreadScheduleDeleteResult {
  ok: true;
  scheduleId: string;
  threadId: string;
}

type CliUrlResolver = () => string;
type ThreadScheduleListActionArgs = [
  id: string | undefined,
  opts: ThreadScheduleTargetOptions,
];
type ThreadScheduleCreateActionArgs = [
  id: string | undefined,
  opts: ThreadScheduleCreateCommandOptions,
];
type ThreadScheduleUpdateActionArgs = [
  threadId: string,
  scheduleId: string,
  opts: ThreadScheduleUpdateCommandOptions,
];
type ThreadScheduleEnabledActionArgs = [
  threadId: string,
  scheduleId: string,
  opts: ThreadScheduleBaseOptions,
];
type ThreadScheduleDeleteActionArgs = [
  threadId: string,
  scheduleId: string,
  opts: ThreadScheduleBaseOptions,
];

function formatTimestamp(timestamp: number | null): string {
  return timestamp === null ? "-" : new Date(timestamp).toLocaleString();
}

function printSchedule(schedule: ThreadSchedule): void {
  console.log(`Schedule ${schedule.id}`);
  console.log(`  Thread:    ${schedule.threadId}`);
  console.log(`  Name:      ${schedule.name}`);
  console.log(`  Enabled:   ${schedule.enabled ? "yes" : "no"}`);
  console.log(`  Cron:      ${schedule.cron}`);
  console.log(`  Timezone:  ${schedule.timezone}`);
  console.log(`  Next fire: ${formatTimestamp(schedule.nextFireAt)}`);
  console.log(`  Last fire: ${formatTimestamp(schedule.lastFiredAt)}`);
  console.log(`  Prompt:    ${schedule.prompt}`);
}

function printScheduleList(schedules: ThreadSchedule[]): void {
  if (schedules.length === 0) {
    console.log("No schedules");
    return;
  }

  console.log(
    renderBorderlessTable(
      {
        head: ["ID", "Name", "On", "Cron", "Timezone", "Next fire", "Last fire"],
        colWidths: [20, 24, 5, 18, 24, 24, 24],
        trimTrailingWhitespace: true,
      },
      schedules.map((schedule) => [
        schedule.id,
        schedule.name,
        schedule.enabled ? "yes" : "no",
        schedule.cron,
        schedule.timezone,
        formatTimestamp(schedule.nextFireAt),
        formatTimestamp(schedule.lastFiredAt),
      ]),
    ),
  );
}

function buildThreadScheduleUpdatePayload(
  opts: ThreadScheduleUpdateCommandOptions,
): UpdateThreadScheduleConfigRequest {
  const payload: UpdateThreadScheduleConfigRequest = {};
  if (opts.name !== undefined) {
    payload.name = opts.name;
  }
  if (opts.cron !== undefined) {
    payload.cron = opts.cron;
  }
  if (opts.timezone !== undefined) {
    payload.timezone = opts.timezone;
  }
  if (opts.prompt !== undefined) {
    payload.prompt = opts.prompt;
  }
  if (Object.keys(payload).length === 0) {
    throw new Error(
      "No schedule changes requested. Provide --name, --cron, --timezone, or --prompt.",
    );
  }
  return payload;
}

export function registerScheduleCommands(
  parent: Command,
  getUrl: CliUrlResolver,
): void {
  const schedule = parent
    .command("schedule")
    .description("Manage thread schedules");
  const listSchedules = action<ThreadScheduleListActionArgs>(
    async (id, opts) => {
      const resolved = requireThreadIdWithLabelOrSelf(id, opts);
      const sdk = createCliBbSdk(getUrl());
      printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
      const schedules = await sdk.threads.schedules.list({
        threadId: resolved.id,
      });
      if (outputJson(opts, schedules)) return;
      printScheduleList(schedules);
    },
  );
  const createSchedule = action<ThreadScheduleCreateActionArgs>(
    async (id, opts) => {
      const threadId = requireThreadIdOrSelf(id, opts);
      const sdk = createCliBbSdk(getUrl());
      const payload: CreateThreadScheduleRequest = {
        name: opts.name,
        cron: opts.cron,
        timezone: opts.timezone,
        prompt: opts.prompt,
        ...(opts.disabled ? { enabled: false } : {}),
      };
      const created = await sdk.threads.schedules.create({
        threadId,
        ...payload,
      });
      if (outputJson(opts, created)) return;
      printSchedule(created);
    },
  );
  const updateSchedule = action<ThreadScheduleUpdateActionArgs>(
    async (threadId, scheduleId, opts) => {
      const sdk = createCliBbSdk(getUrl());
      const updated = await sdk.threads.schedules.update({
        threadId,
        scheduleId,
        ...buildThreadScheduleUpdatePayload(opts),
      });
      if (outputJson(opts, updated)) return;
      printSchedule(updated);
    },
  );
  const enableSchedule = action<ThreadScheduleEnabledActionArgs>(
    async (threadId, scheduleId, opts) => {
      const payload: UpdateThreadScheduleEnabledRequest = {
        enabled: true,
      };
      const sdk = createCliBbSdk(getUrl());
      const updated = await sdk.threads.schedules.update({
        threadId,
        scheduleId,
        ...payload,
      });
      if (outputJson(opts, updated)) return;
      printSchedule(updated);
    },
  );
  const disableSchedule = action<ThreadScheduleEnabledActionArgs>(
    async (threadId, scheduleId, opts) => {
      const payload: UpdateThreadScheduleEnabledRequest = {
        enabled: false,
      };
      const sdk = createCliBbSdk(getUrl());
      const updated = await sdk.threads.schedules.update({
        threadId,
        scheduleId,
        ...payload,
      });
      if (outputJson(opts, updated)) return;
      printSchedule(updated);
    },
  );
  const deleteSchedule = action<ThreadScheduleDeleteActionArgs>(
    async (threadId, scheduleId, opts) => {
      const sdk = createCliBbSdk(getUrl());
      await sdk.threads.schedules.delete({ threadId, scheduleId });
      const result: ThreadScheduleDeleteResult = {
        ok: true,
        threadId,
        scheduleId,
      };
      if (outputJson(opts, result)) return;
      console.log(`Schedule ${scheduleId} deleted`);
    },
  );

  schedule
    .command("list [id]")
    .description("List schedules for a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(listSchedules);

  schedule
    .command("create [id]")
    .description("Create a schedule for a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .requiredOption("--name <name>", "Schedule name")
    .requiredOption("--cron <expr>", "Five-field cron expression")
    .requiredOption("--timezone <tz>", "IANA timezone, for example UTC")
    .requiredOption("--prompt <text>", "Prompt to submit when the schedule fires")
    .option("--disabled", "Create the schedule disabled")
    .option("--json", "Print machine-readable JSON output")
    .action(createSchedule);

  schedule
    .command("update <thread-id> <schedule-id>")
    .description("Update a thread schedule")
    .option("--name <name>", "Schedule name")
    .option("--cron <expr>", "Five-field cron expression")
    .option("--timezone <tz>", "IANA timezone")
    .option("--prompt <text>", "Prompt to submit when the schedule fires")
    .option("--json", "Print machine-readable JSON output")
    .action(updateSchedule);

  schedule
    .command("enable <thread-id> <schedule-id>")
    .description("Enable a thread schedule")
    .option("--json", "Print machine-readable JSON output")
    .action(enableSchedule);

  schedule
    .command("disable <thread-id> <schedule-id>")
    .description("Disable a thread schedule")
    .option("--json", "Print machine-readable JSON output")
    .action(disableSchedule);

  schedule
    .command("delete <thread-id> <schedule-id>")
    .description("Delete a thread schedule")
    .option("--json", "Print machine-readable JSON output")
    .action(deleteSchedule);
}
