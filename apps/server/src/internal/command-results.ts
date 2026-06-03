import {
  getActiveCommandAttempt,
  getCommand,
  reportCommandResult,
  settleCommandAttemptInTransaction,
  type HostDaemonCommandRow,
} from "@bb/db";
import {
  hostDaemonCommandSchema,
  hostDaemonDurableCommandTypeSchema,
  isHostDaemonDurableCommandType,
  type HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import {
  buildCommandResultSettlementDeps,
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectReport,
  type CommandResultSideEffectsDeps,
  type CommandResultSideEffectsResult,
  type CommandResultWaiterResponse,
} from "./command-result-side-effects.js";
import { settleEnvironmentDestroyCommandResult } from "../services/environments/environment-cleanup-internal.js";
import { settleEnvironmentProvisionCommandResult } from "../services/environments/environment-provisioning-internal.js";
import {
  settleThreadStartCommandResult,
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../services/threads/thread-lifecycle.js";
import { scheduleAfterDaemonIngressResponse } from "../services/hosts/daemon-ingress-scheduler.js";
import { notifyWorkspaceMutationResult } from "./environment-changes.js";
import { NotificationBuffer } from "../services/lib/notification-buffer.js";
import { ApiError } from "../errors.js";

function parseCommand(commandRow: HostDaemonCommandRow) {
  return hostDaemonCommandSchema.parse(JSON.parse(commandRow.payload));
}

type ParsedHostDaemonCommand = ReturnType<typeof parseCommand>;
type ParsedCommandType = ParsedHostDaemonCommand["type"];
type ParsedCommandForType<TType extends ParsedCommandType> = Extract<
  ParsedHostDaemonCommand,
  { type: TType }
>;

// Command-result owners apply durable DB side effects before the command row is
// marked terminal. Work that can queue or wait for another daemon command must
// be returned as an explicit post-commit action.
interface ApplyCommandResultSideEffectsArgs<TType extends ParsedCommandType> {
  command: ParsedCommandForType<TType>;
  commandRow: HostDaemonCommandRow;
  deps: CommandResultSettlementDeps;
  report: CommandResultReportForType<TType>;
}

interface CommandResultOwner<TType extends ParsedCommandType> {
  applySideEffects?(
    args: ApplyCommandResultSideEffectsArgs<TType>,
  ): CommandResultSideEffectsResult | void;
}

type CommandResultOwnerRegistry = {
  [TType in ParsedCommandType]: CommandResultOwner<TType> | null;
};

function defineCommandResultOwner<TType extends ParsedCommandType>(
  owner: CommandResultOwner<TType>,
): CommandResultOwner<TType> {
  return owner;
}

function reportMatchesCommandType<TType extends ParsedCommandType>(
  command: ParsedCommandForType<TType>,
  report: CommandResultSideEffectReport,
): report is CommandResultReportForType<TType> {
  return report.type === command.type;
}

const commandResultOwners: CommandResultOwnerRegistry = {
  "environment.cleanup_preflight": null,
  "environment.destroy": defineCommandResultOwner({
    applySideEffects: settleEnvironmentDestroyCommandResult,
  }),
  "environment.provision": defineCommandResultOwner({
    applySideEffects: settleEnvironmentProvisionCommandResult,
  }),
  "host.write_file_relative": null,
  "host.delete_file_relative": null,
  "host.delete_path_relative": null,
  "codex.inference.complete": null,
  "interactive.resolve": defineCommandResultOwner({
    applySideEffects: ({ deps, command, report }) => {
      deps.pendingInteractions.settleInteractiveResolveCommandResultInTransaction(
        {
          command,
          deps,
          report,
        },
      );
    },
  }),
  "thread.archive": null,
  "thread.deleted": null,
  "thread.rename": null,
  "thread.unarchive": null,
  "thread.start": defineCommandResultOwner({
    applySideEffects: settleThreadStartCommandResult,
  }),
  "thread.stop": defineCommandResultOwner({
    applySideEffects: settleThreadStopCommandResult,
  }),
  "turn.submit": defineCommandResultOwner({
    applySideEffects: settleTurnSubmitCommandResult,
  }),
  "codex.voice.transcribe": null,
  "workspace.commit": defineCommandResultOwner({
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationResult(deps, {
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  }),
  "workspace.squash_merge": defineCommandResultOwner({
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationResult(deps, {
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  }),
};

function getCommandResultOwner<TType extends ParsedCommandType>(
  command: ParsedCommandForType<TType>,
): CommandResultOwner<TType> | null {
  return commandResultOwners[command.type];
}

function hasCommandResultOwnerSideEffects(
  type: HostDaemonDurableCommandType,
): boolean {
  return commandResultOwners[type]?.applySideEffects !== undefined;
}

export function handleCommandResultSideEffects(
  deps: CommandResultSettlementDeps,
  report: CommandResultSideEffectReport,
  commandRow: HostDaemonCommandRow,
): CommandResultSideEffectsResult {
  if (
    report.type !== commandRow.type ||
    !isHostDaemonDurableCommandType(report.type) ||
    !hasCommandResultOwnerSideEffects(report.type)
  ) {
    return emptyCommandResultSideEffects();
  }

  const command = parseCommand(commandRow);
  if (!reportMatchesCommandType(command, report)) {
    return emptyCommandResultSideEffects();
  }
  return (
    getCommandResultOwner(command)?.applySideEffects?.({
      deps,
      report,
      command,
      commandRow,
    }) ?? emptyCommandResultSideEffects()
  );
}

type CommandResultPostCommitDispatchMode =
  | "inline"
  | "schedule-after-daemon-ingress";

export interface DispatchCommandResultPostCommitActionsArgs {
  actions: readonly CommandResultPostCommitAction[];
  command: HostDaemonCommandRow;
  deps: CommandResultSideEffectsDeps;
  mode: CommandResultPostCommitDispatchMode;
}

async function runCommandResultPostCommitAction(
  deps: CommandResultSideEffectsDeps,
  action: CommandResultPostCommitAction,
): Promise<void> {
  await action.run(deps);
}

export async function dispatchCommandResultPostCommitActions(
  args: DispatchCommandResultPostCommitActionsArgs,
): Promise<void> {
  for (const action of args.actions) {
    if (args.mode === "inline") {
      await runCommandResultPostCommitAction(args.deps, action);
      continue;
    }

    scheduleAfterDaemonIngressResponse({
      config: args.deps.config,
      context: {
        ...action.context,
        commandId: args.command.id,
        commandType: args.command.type,
      },
      logger: args.deps.logger,
      name: action.name,
      work: () => runCommandResultPostCommitAction(args.deps, action),
    });
  }
}

interface MissingCommandResultSettlement {
  outcome: "missing";
}

interface StoredCommandResultSettlement {
  command: HostDaemonCommandRow;
  outcome: "stored";
  response: CommandResultWaiterResponse | null;
}

interface StaleCommandResultSettlement {
  command: HostDaemonCommandRow;
  outcome: "stale";
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
  | StaleCommandResultSettlement
  | UpdatedCommandResultSettlement;

function buildCommandResultResponse(
  commandId: string,
  report: CommandResultSideEffectReport,
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
  report: CommandResultSideEffectReport,
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
): HostDaemonDurableCommandType {
  return hostDaemonDurableCommandTypeSchema.parse(commandRow.type);
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
  report: CommandResultSideEffectReport,
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
        if (report.type !== command.type) {
          throw new ApiError(
            400,
            "command_result_type_mismatch",
            `Command ${command.id} is ${command.type}, not ${report.type}`,
          );
        }

        if (command.state === "success" || command.state === "error") {
          return {
            command,
            outcome: "stored",
            response: buildStoredCommandResultResponse(command),
          };
        }

        const activeAttempt = getActiveCommandAttempt(tx, {
          attemptId: report.attemptId,
          commandId: command.id,
        });
        if (!activeAttempt) {
          return {
            command,
            outcome: "stale",
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
        const settledAttempt = settleCommandAttemptInTransaction(tx, {
          attemptId: report.attemptId,
          commandId: command.id,
          settledAt: report.completedAt,
        });
        if (!settledAttempt) {
          throw new Error(
            `Command ${command.id} active attempt disappeared during result settlement`,
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
  if (settlement.outcome === "stale") {
    return settlement.command;
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
