import { getCommand, type HostDaemonCommandRow } from "@bb/db";
import type { HostDaemonCommandResultReport } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { handleCommandResult } from "../../internal/command-results.js";

const EXPIRED_COMMAND_ERROR_CODE = "command_expired";
const EXPIRED_COMMAND_ERROR_MESSAGE = "Command expired after retry";
const EXPIRED_COMMAND_SESSION_ID = "expired";

type ExpiredCommandDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hostLifecycle"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "pendingInteractions"
  | "terminalSessions"
>;

interface BuildExpiredCommandFailureReportArgs {
  command: Pick<HostDaemonCommandRow, "id" | "type">;
  completedAt: number;
}

function buildExpiredCommandFailureReport(
  args: BuildExpiredCommandFailureReportArgs,
): HostDaemonCommandResultReport {
  return {
    commandId: args.command.id,
    completedAt: args.completedAt,
    errorCode: EXPIRED_COMMAND_ERROR_CODE,
    errorMessage: EXPIRED_COMMAND_ERROR_MESSAGE,
    ok: false,
    sessionId: EXPIRED_COMMAND_SESSION_ID,
    type: args.command.type,
  };
}

export async function handleExpiredCommands(
  deps: ExpiredCommandDeps,
  args: {
    commandIds: string[];
  },
): Promise<void> {
  for (const commandId of args.commandIds) {
    const commandRow = getCommand(deps.db, commandId);
    if (!commandRow) {
      continue;
    }

    const completedAt = commandRow.completedAt ?? Date.now();
    await handleCommandResult(
      deps,
      buildExpiredCommandFailureReport({
        command: commandRow,
        completedAt,
      }),
    );
  }
}
