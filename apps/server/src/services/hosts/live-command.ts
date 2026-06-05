import { randomUUID } from "node:crypto";
import {
  type HostDaemonCommand,
  type HostDaemonCommandResult,
  type HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import {
  buildCommandResultSettlementDeps,
  type CommandResultPostCommitAction,
  type CommandResultSideEffectsDeps,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
  type LiveHostCommandFailureResultReportForType,
  type LiveHostCommandSuccessResultReportForType,
} from "../../internal/command-result-side-effects.js";
import { handleLiveCommandResultSideEffects } from "../../internal/command-results.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { callHostOnlineRpc } from "./online-rpc.js";

export const LIVE_DAEMON_COMMAND_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface RunLiveHostCommandArgs<
  TType extends HostDaemonDurableCommandType,
> {
  command: Extract<HostDaemonCommand, { type: TType }>;
  hostId: string;
  timeoutMs: number;
}

export interface StartLiveHostCommandArgs<
  TType extends HostDaemonDurableCommandType,
> extends RunLiveHostCommandArgs<TType> {
  onError?: (error: Error) => void;
}

type LiveHostCommandResultReportForType<
  TType extends HostDaemonDurableCommandType,
> =
  | LiveHostCommandSuccessResultReportForType<TType>
  | LiveHostCommandFailureResultReportForType<TType>;

interface ApplyLiveHostCommandReportArgs<
  TType extends HostDaemonDurableCommandType,
> {
  command: HostDaemonCommandForType<TType>;
  execution: HostDaemonCommandExecutionRecord;
  report: LiveHostCommandResultReportForType<TType>;
}

interface BuildLiveHostCommandSuccessReportArgs<
  TType extends HostDaemonDurableCommandType,
> {
  command: HostDaemonCommandForType<TType>;
  completedAt: number;
  execution: HostDaemonCommandExecutionRecord;
  result: HostDaemonCommandResult<TType>;
}

interface BuildLiveHostCommandFailureReportArgs<
  TType extends HostDaemonDurableCommandType,
> {
  command: HostDaemonCommandForType<TType>;
  completedAt: number;
  error: Error;
  execution: HostDaemonCommandExecutionRecord;
}

function commandFailureCode(error: Error): string {
  if (error instanceof ApiError) {
    return error.body.code;
  }
  return "live_command_failed";
}

function buildLiveHostCommandFailureReport<
  TType extends HostDaemonDurableCommandType,
>(
  args: BuildLiveHostCommandFailureReportArgs<TType>,
): LiveHostCommandFailureResultReportForType<TType> {
  return {
    executionId: args.execution.id,
    type: args.command.type,
    completedAt: args.completedAt,
    ok: false,
    errorCode: commandFailureCode(args.error),
    errorMessage: args.error.message,
  };
}

function buildLiveHostCommandSuccessReport<
  TType extends HostDaemonDurableCommandType,
>(
  args: BuildLiveHostCommandSuccessReportArgs<TType>,
): LiveHostCommandSuccessResultReportForType<TType> {
  return {
    executionId: args.execution.id,
    type: args.command.type,
    completedAt: args.completedAt,
    ok: true,
    result: args.result,
  };
}

async function runPostCommitActions(
  deps: CommandResultSideEffectsDeps,
  actions: readonly CommandResultPostCommitAction[],
): Promise<void> {
  for (const action of actions) {
    await action.run(deps);
  }
}

async function applyLiveHostCommandReport<
  TType extends HostDaemonDurableCommandType,
>(
  deps: CommandResultSideEffectsDeps,
  args: ApplyLiveHostCommandReportArgs<TType>,
): Promise<void> {
  const notificationBuffer = new NotificationBuffer();
  const sideEffects = deps.db.transaction(
    (tx) =>
      handleLiveCommandResultSideEffects(
        buildCommandResultSettlementDeps({
          db: tx,
          deps,
          hub: notificationBuffer,
        }),
        args,
      ),
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  await runPostCommitActions(deps, sideEffects.postCommitActions);
}

function createExecution(hostId: string): HostDaemonCommandExecutionRecord {
  return {
    createdAt: Date.now(),
    hostId,
    id: `rpc_${randomUUID()}`,
  };
}

export async function runLiveHostCommand<
  TType extends HostDaemonDurableCommandType,
>(
  deps: CommandResultSideEffectsDeps,
  args: RunLiveHostCommandArgs<TType>,
): Promise<HostDaemonCommandResult<TType>> {
  const execution = createExecution(args.hostId);
  try {
    const result = await callHostOnlineRpc(deps, {
      command: args.command,
      hostId: args.hostId,
      timeoutMs: args.timeoutMs,
    });
    await applyLiveHostCommandReport(deps, {
      command: args.command,
      execution,
      report: buildLiveHostCommandSuccessReport({
        command: args.command,
        completedAt: Date.now(),
        execution,
        result,
      }),
    });
    return result;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const failureReport = buildLiveHostCommandFailureReport({
        command: args.command,
        completedAt: Date.now(),
        error: normalized,
        execution,
    });
    try {
      await applyLiveHostCommandReport(deps, {
        command: args.command,
        execution,
        report: failureReport,
      });
    } catch (settlementError) {
      deps.logger.error(
        {
          err: settlementError,
          commandType: args.command.type,
          originalError: normalized,
        },
        "Live command failure settlement failed",
      );
    }
    throw normalized;
  }
}

export function startLiveHostCommand<TType extends HostDaemonDurableCommandType>(
  deps: CommandResultSideEffectsDeps,
  args: StartLiveHostCommandArgs<TType>,
): void {
  void runLiveHostCommand(deps, args).catch((error) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    args.onError?.(normalized);
  });
}
