import {
  getCommand,
  listActiveLifecycleOperationTerminalCommands,
  listPendingInteractionsByStatus,
  type HostDaemonCommandRow,
  type PendingInteractionRow,
} from "@bb/db";
import {
  commandResultOwnerReplaysSettledSideEffects,
  handleCommandResultSideEffects,
} from "./command-result-owners.js";
import {
  type CommandResultSideEffectFailureDeps,
  type SettledCommandLifecycleFailureSweepResult,
} from "./command-result-side-effect-failure-common.js";
import { failSettledCommandActiveSideEffects } from "./command-result-owners.js";
import { buildStoredCommandResultReport } from "./stored-command-result-report.js";

type TerminalCommandState = Extract<
  HostDaemonCommandRow["state"],
  "success" | "error"
>;

function isTerminalCommandState(
  state: HostDaemonCommandRow["state"],
): state is TerminalCommandState {
  return state === "success" || state === "error";
}

async function failSettledOperationCommand(
  deps: CommandResultSideEffectFailureDeps,
  commandRow: HostDaemonCommandRow,
): Promise<boolean> {
  try {
    if (!isTerminalCommandState(commandRow.state)) {
      return false;
    }

    const replayed = await replaySettledCommandActiveSideEffects(
      deps,
      commandRow,
    );
    if (replayed) {
      deps.logger.info(
        {
          commandId: commandRow.id,
          commandState: commandRow.state,
          commandType: commandRow.type,
        },
        "Replayed active lifecycle operation side effects for settled command",
      );
      return true;
    }

    const failed = await failSettledCommandActiveSideEffects(deps, commandRow);
    if (failed) {
      deps.logger.error(
        {
          commandId: commandRow.id,
          commandState: commandRow.state,
          commandType: commandRow.type,
        },
        "Failed active lifecycle operation attached to settled command",
      );
    }
    return failed;
  } catch (error) {
    deps.logger.error(
      {
        commandId: commandRow.id,
        err: error,
      },
      "Settled command lifecycle failure sweep failed",
    );
    return false;
  }
}

export async function replaySettledCommandActiveSideEffects(
  deps: CommandResultSideEffectFailureDeps,
  commandRow: HostDaemonCommandRow,
): Promise<boolean> {
  try {
    const report = buildStoredCommandResultReport(commandRow);
    if (!report || !commandResultOwnerReplaysSettledSideEffects(commandRow)) {
      return false;
    }

    await handleCommandResultSideEffects(deps, report, commandRow);
    return true;
  } catch (error) {
    deps.logger.error(
      {
        commandId: commandRow.id,
        err: error,
      },
      "Settled command side-effect replay failed",
    );
    return false;
  }
}

function findSettledInteractiveResolveCommand(
  deps: CommandResultSideEffectFailureDeps,
  interaction: PendingInteractionRow,
): HostDaemonCommandRow | null {
  const commandId = interaction.resolvingCommandId;
  if (!commandId) {
    return null;
  }
  const commandRow = getCommand(deps.db, commandId);
  if (
    !commandRow ||
    commandRow.type !== "interactive.resolve" ||
    (commandRow.state !== "success" && commandRow.state !== "error")
  ) {
    return null;
  }
  return commandRow;
}

async function failSettledInteractiveResolveCommands(
  deps: CommandResultSideEffectFailureDeps,
): Promise<number> {
  let failed = 0;
  const interactions = listPendingInteractionsByStatus(deps.db, {
    statuses: ["resolving"],
  });

  for (const interaction of interactions) {
    try {
      const commandRow = findSettledInteractiveResolveCommand(
        deps,
        interaction,
      );
      if (!commandRow) {
        continue;
      }

      if (
        (await replaySettledCommandActiveSideEffects(deps, commandRow)) ||
        (await failSettledCommandActiveSideEffects(deps, commandRow))
      ) {
        failed += 1;
      }
    } catch (error) {
      deps.logger.error(
        {
          err: error,
          interactionId: interaction.id,
        },
        "Settled interactive resolve failure sweep failed",
      );
    }
  }

  return failed;
}

export async function failActiveLifecycleOperationsWithSettledCommands(
  deps: CommandResultSideEffectFailureDeps,
): Promise<SettledCommandLifecycleFailureSweepResult> {
  let failed = 0;

  for (const operation of listActiveLifecycleOperationTerminalCommands(
    deps.db,
  )) {
    if (await failSettledOperationCommand(deps, operation.command)) {
      failed += 1;
    }
  }

  failed += await failSettledInteractiveResolveCommands(deps);

  return { failed };
}
