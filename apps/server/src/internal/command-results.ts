import {
  getCommand,
  reportCommandResult,
  type HostDaemonCommandRow,
} from "@bb/db";
import {
  hostDaemonCommandTypeSchema,
  type HostDaemonCommandResultReport,
  type HostDaemonCommandType,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import {
  buildCommandResultSettlementDeps,
  handleCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultSideEffectsDeps,
} from "./command-result-owners.js";
import type { CommandResultWaiterResponse } from "./command-result-response.js";
import {
  dispatchCommandResultPostCommitActions,
} from "./command-result-post-commit-actions.js";
import { NotificationBuffer } from "../services/lib/notification-buffer.js";

interface MissingCommandResultSettlement {
  outcome: "missing";
}

interface StoredCommandResultSettlement {
  command: HostDaemonCommandRow;
  outcome: "stored";
  response: CommandResultWaiterResponse | null;
}

interface UpdatedCommandResultSettlement {
  command: HostDaemonCommandRow;
  outcome: "updated";
  postCommitActions: CommandResultPostCommitAction[];
  response: CommandResultWaiterResponse;
  updated: HostDaemonCommandRow;
}

type CommandResultSettlement =
  | MissingCommandResultSettlement
  | StoredCommandResultSettlement
  | UpdatedCommandResultSettlement;

function buildCommandResultResponse(
  commandId: string,
  report: HostDaemonCommandResultReport,
): CommandResultWaiterResponse {
  if (report.ok) {
    return {
      commandId,
      ok: true,
      result: report.result,
      type: report.type,
    };
  }

  return {
    commandId,
    ok: false,
    errorCode: report.errorCode,
    errorMessage: report.errorMessage,
    type: report.type,
  };
}

function buildCommandResultPayload(
  report: HostDaemonCommandResultReport,
): string {
  return report.ok
    ? JSON.stringify(report.result)
    : JSON.stringify({
        errorCode: report.errorCode,
        errorMessage: report.errorMessage,
      });
}

const storedCommandErrorPayloadSchema = z.object({
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

function parseStoredCommandType(
  commandRow: HostDaemonCommandRow,
): HostDaemonCommandType {
  return hostDaemonCommandTypeSchema.parse(commandRow.type);
}

function buildStoredCommandResultResponse(
  commandRow: HostDaemonCommandRow,
): CommandResultWaiterResponse | null {
  if (!commandRow.completedAt || !commandRow.resultPayload) {
    return null;
  }
  const commandType = parseStoredCommandType(commandRow);

  if (commandRow.state === "success") {
    return {
      commandId: commandRow.id,
      ok: true,
      result: JSON.parse(commandRow.resultPayload),
      type: commandType,
    };
  }

  if (commandRow.state === "error") {
    const payload = storedCommandErrorPayloadSchema.parse(
      JSON.parse(commandRow.resultPayload),
    );
    return {
      commandId: commandRow.id,
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
      ok: false,
      type: commandType,
    };
  }

  return null;
}

export async function handleCommandResult(
  deps: CommandResultSideEffectsDeps,
  report: HostDaemonCommandResultReport,
): Promise<HostDaemonCommandRow | null> {
  let settlement: CommandResultSettlement;
  const notificationBuffer = new NotificationBuffer();
  try {
    settlement = deps.db.transaction(
      (tx) => {
        const command = getCommand(tx, report.commandId);
        if (!command) {
          return { outcome: "missing" };
        }

        if (command.state === "success" || command.state === "error") {
          return {
            command,
            outcome: "stored",
            response: buildStoredCommandResultResponse(command),
          };
        }

        const settlementDeps = buildCommandResultSettlementDeps({
          db: tx,
          deps,
          hub: notificationBuffer,
        });
        const sideEffects = handleCommandResultSideEffects(
          settlementDeps,
          report,
          command,
        );
        const updated = reportCommandResult(tx, notificationBuffer, {
          commandId: command.id,
          state: report.ok ? "success" : "error",
          completedAt: report.completedAt,
          resultPayload: buildCommandResultPayload(report),
        });
        if (!updated) {
          throw new Error(
            `Command ${command.id} disappeared during result settlement`,
          );
        }
        return {
          command,
          outcome: "updated",
          postCommitActions: sideEffects.postCommitActions,
          response: buildCommandResultResponse(command.id, report),
          updated,
        };
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    deps.logger.error(
      {
        commandId: report.commandId,
        err: error,
        reportOk: report.ok,
        reportType: report.type,
      },
      "Command result settlement transaction failed",
    );
    throw error;
  }

  if (settlement.outcome === "missing") {
    return null;
  }

  if (settlement.outcome === "updated") {
    notificationBuffer.flushInto(deps.hub);
  }
  if (settlement.response) {
    deps.hub.recordCommandResult(settlement.command.id, settlement.response);
  }
  if (settlement.outcome === "stored") {
    return settlement.command;
  }

  await dispatchCommandResultPostCommitActions({
    actions: settlement.postCommitActions,
    command: settlement.command,
    deps,
    mode: "schedule-after-daemon-ingress",
  });
  return settlement.updated;
}
