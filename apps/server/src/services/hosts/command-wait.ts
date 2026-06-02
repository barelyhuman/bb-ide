import { queueCommand } from "@bb/db";
import { performance } from "node:perf_hooks";
import {
  hostDaemonCommandResultSchemaByType,
  type HostDaemonCommand,
  type HostDaemonCommandResult,
  type HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import type { CommandResultWaiterResponse } from "../../internal/command-result-response.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { roundDurationMs } from "../lib/duration.js";
import { ensureHostSessionReadyForWork } from "./host-lifecycle.js";

export interface QueueCommandAndWaitArgs<
  TType extends HostDaemonDurableCommandType,
> {
  command: Extract<HostDaemonCommand, { type: TType }>;
  hostId: string;
  timeoutMs: number;
}

export interface WaitForQueuedCommandResultArgs<
  TType extends HostDaemonDurableCommandType,
> {
  commandId: string;
  timeoutMs: number;
  type: TType;
}

type SlowCommandWaitOutcome =
  | "success"
  | "timeout"
  | "provider_error"
  | "result_type_mismatch"
  | "api_error"
  | "unknown_error";

interface LogSlowCommandWaitArgs {
  commandId: string;
  commandType: HostDaemonDurableCommandType;
  completed: boolean;
  durationMs: number;
  errorCode?: string;
  errorName?: string;
  hostId: string;
  outcome: SlowCommandWaitOutcome;
  sessionId: string;
  status?: number;
}

interface SlowCommandWaitFailureLogFields {
  errorCode?: string;
  errorName?: string;
  outcome: Exclude<SlowCommandWaitOutcome, "success">;
  status?: number;
}

const SLOW_HOST_COMMAND_WAIT_LOG_THRESHOLD_MS = 1_000;

function logSlowCommandWait(
  deps: LoggedWorkSessionDeps,
  args: LogSlowCommandWaitArgs,
): void {
  if (args.durationMs < SLOW_HOST_COMMAND_WAIT_LOG_THRESHOLD_MS) {
    return;
  }
  deps.logger.debug(
    {
      commandId: args.commandId,
      commandType: args.commandType,
      completed: args.completed,
      durationMs: roundDurationMs(args.durationMs),
      ...(args.errorCode ? { errorCode: args.errorCode } : {}),
      ...(args.errorName ? { errorName: args.errorName } : {}),
      hostId: args.hostId,
      outcome: args.outcome,
      sessionId: args.sessionId,
      ...(args.status !== undefined ? { status: args.status } : {}),
    },
    "Slow host command wait",
  );
}

function classifySlowCommandWaitFailure(
  error: unknown,
): SlowCommandWaitFailureLogFields {
  if (error instanceof ApiError) {
    const errorCode = error.body.code;
    if (errorCode === "command_timeout") {
      return {
        errorCode,
        outcome: "timeout",
        status: error.status,
      };
    }
    if (errorCode === "command_result_type_mismatch") {
      return {
        errorCode,
        outcome: "result_type_mismatch",
        status: error.status,
      };
    }
    if (error.status === 502) {
      return {
        errorCode,
        outcome: "provider_error",
        status: error.status,
      };
    }
    return {
      errorCode,
      outcome: "api_error",
      status: error.status,
    };
  }

  if (error instanceof Error) {
    return {
      errorName: error.name,
      outcome: "unknown_error",
    };
  }

  return {
    outcome: "unknown_error",
  };
}

export function queueCommandAndWait<TType extends HostDaemonDurableCommandType>(
  deps: LoggedWorkSessionDeps,
  args: QueueCommandAndWaitArgs<TType>,
): Promise<HostDaemonCommandResult<TType>>;
export async function queueCommandAndWait(
  deps: LoggedWorkSessionDeps,
  args: QueueCommandAndWaitArgs<HostDaemonDurableCommandType>,
): Promise<HostDaemonCommandResult> {
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.hostId,
  });
  const queuedCommand = queueCommand(deps.db, deps.hub, {
    hostId: args.hostId,
    sessionId: session.id,
    type: args.command.type,
    payload: JSON.stringify(args.command),
  });

  const startedAt = performance.now();
  let logOutcome: SlowCommandWaitOutcome = "success";
  let completed = true;
  let failureLogFields: SlowCommandWaitFailureLogFields | null = null;
  try {
    return await waitForQueuedCommandResult(deps, {
      commandId: queuedCommand.id,
      timeoutMs: args.timeoutMs,
      type: args.command.type,
    });
  } catch (error) {
    completed = false;
    failureLogFields = classifySlowCommandWaitFailure(error);
    logOutcome = failureLogFields.outcome;
    throw error;
  } finally {
    logSlowCommandWait(deps, {
      commandId: queuedCommand.id,
      commandType: args.command.type,
      completed,
      durationMs: performance.now() - startedAt,
      ...(failureLogFields?.errorCode
        ? { errorCode: failureLogFields.errorCode }
        : {}),
      ...(failureLogFields?.errorName
        ? { errorName: failureLogFields.errorName }
        : {}),
      hostId: args.hostId,
      outcome: logOutcome,
      sessionId: session.id,
      ...(failureLogFields?.status !== undefined
        ? { status: failureLogFields.status }
        : {}),
    });
  }
}

export function waitForQueuedCommandResult<
  TType extends HostDaemonDurableCommandType,
>(
  deps: Pick<AppDeps, "hub">,
  args: WaitForQueuedCommandResultArgs<TType>,
): Promise<HostDaemonCommandResult<TType>>;
export async function waitForQueuedCommandResult(
  deps: Pick<AppDeps, "hub">,
  args: WaitForQueuedCommandResultArgs<HostDaemonDurableCommandType>,
): Promise<HostDaemonCommandResult> {
  let completed: CommandResultWaiterResponse;
  try {
    completed = await deps.hub.waitForCommandResult(
      args.commandId,
      args.timeoutMs,
    );
  } catch {
    throw new ApiError(
      504,
      "command_timeout",
      "Timed out waiting for command result",
    );
  }

  if (!completed.ok) {
    throw new ApiError(
      502,
      completed.errorCode ?? "provider_rpc_error",
      completed.errorMessage ?? "Command failed",
      false,
    );
  }

  if (completed.type !== args.type) {
    throw new ApiError(
      500,
      "command_result_type_mismatch",
      `Command ${args.commandId} completed with unexpected type ${completed.type}`,
    );
  }

  return hostDaemonCommandResultSchemaByType[args.type].parse(completed.result);
}
