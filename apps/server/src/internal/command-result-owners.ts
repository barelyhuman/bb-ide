import type { HostDaemonCommandRow } from "@bb/db";
import {
  hostDaemonCommandSchema,
  isHostDaemonDurableCommandType,
  type HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import { settleEnvironmentDestroyCommandResult } from "../services/environments/environment-lifecycle-owner.js";
import { settleEnvironmentProvisionCommandResult } from "../services/environments/environment-lifecycle-owner.js";
import {
  settleThreadStartCommandResult,
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../services/threads/thread-lifecycle.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectReport,
  type CommandResultSideEffectsResult,
} from "./command-result-side-effects.js";
import { notifyWorkspaceMutationResult } from "./environment-changes.js";

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
