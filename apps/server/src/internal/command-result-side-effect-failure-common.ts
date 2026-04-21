import type { HostDaemonCommandRow } from "@bb/db";
import type { InteractiveLifecycleCoordinationDeps } from "../lifecycle-coordination-deps.js";
import type { CommandResultFailureWaiterResponse } from "./command-result-response.js";

export const COMMAND_RESULT_SIDE_EFFECT_FAILURE_CODE =
  "command_result_side_effect_failed";
export const COMMAND_RESULT_SIDE_EFFECT_FAILURE_SUMMARY =
  "Server failed to apply command result side effects";
const SETTLED_COMMAND_SIDE_EFFECT_FAILURE_DETAIL =
  "Command result reached terminal state before lifecycle side effects completed";

export type CommandResultSideEffectFailureDeps =
  InteractiveLifecycleCoordinationDeps;

export interface CommandResultSideEffectFailureArgs {
  commandRow: HostDaemonCommandRow;
  failureReason: string;
}

export interface CommandResultSideEffectFailureResponse
  extends CommandResultFailureWaiterResponse {
  errorCode: typeof COMMAND_RESULT_SIDE_EFFECT_FAILURE_CODE;
}

export interface BuildCommandResultSideEffectFailureResponseArgs {
  commandId: string;
  commandType: string;
  failureReason: string;
}

export interface SettledCommandLifecycleFailureSweepResult {
  failed: number;
}

export function commandResultSideEffectFailureReason(detail: string): string {
  return `${COMMAND_RESULT_SIDE_EFFECT_FAILURE_SUMMARY}: ${detail}`;
}

export function settledCommandSideEffectFailureReason(): string {
  return commandResultSideEffectFailureReason(
    SETTLED_COMMAND_SIDE_EFFECT_FAILURE_DETAIL,
  );
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildCommandResultSideEffectFailureResponse(
  args: BuildCommandResultSideEffectFailureResponseArgs,
): CommandResultSideEffectFailureResponse {
  return {
    commandId: args.commandId,
    errorCode: COMMAND_RESULT_SIDE_EFFECT_FAILURE_CODE,
    errorMessage: args.failureReason,
    ok: false,
    type: args.commandType,
  };
}
