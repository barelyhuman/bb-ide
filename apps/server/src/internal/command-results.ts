import {
  getCommand,
  reportCommandResult,
} from "@bb/db";
import type { HostDaemonCommandResultReport } from "@bb/host-daemon-contract";
import type { AppDeps } from "../types.js";
import {
  handleCommandResultSideEffects,
} from "./command-result-handlers.js";

export async function handleCommandResult(
  deps: AppDeps,
  report: HostDaemonCommandResultReport,
): Promise<ReturnType<typeof getCommand>> {
  const command = getCommand(deps.db, report.commandId);

  if (!command) {
    return null;
  }

  if (command.state === "success" || command.state === "error") {
    return command;
  }

  const resultPayload = report.ok
    ? JSON.stringify(report.result)
    : JSON.stringify({
        errorCode: report.errorCode,
        errorMessage: report.errorMessage,
      });

  const updated = reportCommandResult(deps.db, deps.hub, {
    commandId: command.id,
    state: report.ok ? "success" : "error",
    completedAt: report.completedAt,
    resultPayload,
  });
  if (!updated) {
    return null;
  }

  await handleCommandResultSideEffects(deps, report, updated);

  const response = report.ok
    ? {
        commandId: command.id,
        ok: true,
        result: report.result,
        type: report.type,
      }
    : {
        commandId: command.id,
        ok: false,
        errorCode: report.errorCode,
        errorMessage: report.errorMessage,
        type: report.type,
      };
  deps.hub.recordCommandResult(command.id, response);
  return updated;
}
