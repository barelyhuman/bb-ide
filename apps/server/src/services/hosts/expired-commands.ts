import {
  getCommand,
  listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement,
  type HostDaemonCommandRow,
} from "@bb/db";
import type { HostDaemonCommandResultReport } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import {
  buildCommandResultSettlementDeps,
  handleCommandResultSideEffects,
} from "../../internal/command-result-owners.js";
import { dispatchCommandResultPostCommitActions } from "../../internal/command-result-post-commit-actions.js";
import { handleCommandResult } from "../../internal/command-results.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";

const EXPIRED_COMMAND_ERROR_CODE = "command_expired";
const EXPIRED_COMMAND_ERROR_MESSAGE = "Command expired after retry";
const EXPIRED_COMMAND_SESSION_ID = "expired";
const LEGACY_TERMINALIZED_EXPIRED_LIFECYCLE_SETTLEMENT_BATCH_SIZE = 100;

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

export interface LegacyTerminalizedExpiredLifecycleSettlementResult {
  hasMore: boolean;
  settled: number;
}

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

async function settleLegacyTerminalizedExpiredLifecycleCommand(
  deps: ExpiredCommandDeps,
  commandRow: HostDaemonCommandRow,
): Promise<void> {
  const notificationBuffer = new NotificationBuffer();
  const failureReport = buildExpiredCommandFailureReport({
    command: commandRow,
    completedAt: commandRow.completedAt ?? Date.now(),
  });
  const sideEffects = deps.db.transaction(
    (tx) =>
      handleCommandResultSideEffects(
        buildCommandResultSettlementDeps({
          db: tx,
          deps,
          hub: notificationBuffer,
        }),
        failureReport,
        commandRow,
      ),
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  deps.hub.recordCommandResult(commandRow.id, {
    commandId: commandRow.id,
    errorCode: EXPIRED_COMMAND_ERROR_CODE,
    errorMessage: EXPIRED_COMMAND_ERROR_MESSAGE,
    ok: false,
    type: commandRow.type,
  });
  await dispatchCommandResultPostCommitActions({
    actions: sideEffects.postCommitActions,
    command: commandRow,
    deps,
    mode: "inline",
  });
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

/**
 * Repairs rows written by old expired-command sweeps that marked lifecycle
 * commands terminal before owner side effects ran. New expirations go through
 * handleExpiredCommands and do not enter this path.
 */
export async function settleLegacyTerminalizedExpiredLifecycleCommands(
  deps: ExpiredCommandDeps,
): Promise<LegacyTerminalizedExpiredLifecycleSettlementResult> {
  const commandIds =
    listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement(deps.db, {
      limit: LEGACY_TERMINALIZED_EXPIRED_LIFECYCLE_SETTLEMENT_BATCH_SIZE + 1,
    });
  const commandIdsToSettle = commandIds.slice(
    0,
    LEGACY_TERMINALIZED_EXPIRED_LIFECYCLE_SETTLEMENT_BATCH_SIZE,
  );
  let settled = 0;

  for (const commandId of commandIdsToSettle) {
    const commandRow = getCommand(deps.db, commandId);
    if (!commandRow) {
      continue;
    }

    await settleLegacyTerminalizedExpiredLifecycleCommand(deps, commandRow);
    settled += 1;
  }

  return {
    hasMore: commandIds.length > commandIdsToSettle.length,
    settled,
  };
}
