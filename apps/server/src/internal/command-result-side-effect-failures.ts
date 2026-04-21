/**
 * Recovery helpers for the gap between durable command settlement and
 * server-owned lifecycle side effects. Periodic sweeps and retry handling use
 * this module to replay or fail side effects when result handling is
 * interrupted after the daemon command has already reached a terminal state.
 */
export {
  buildCommandResultSideEffectFailureResponse,
  COMMAND_RESULT_SIDE_EFFECT_FAILURE_CODE,
  commandResultSideEffectFailureReason,
  errorDetail,
  settledCommandSideEffectFailureReason,
  type BuildCommandResultSideEffectFailureResponseArgs,
  type CommandResultSideEffectFailureArgs,
  type CommandResultSideEffectFailureDeps,
  type CommandResultSideEffectFailureResponse,
  type SettledCommandLifecycleFailureSweepResult,
} from "./command-result-side-effect-failure-common.js";
export {
  failCommandResultSideEffects,
  failSettledCommandActiveSideEffects,
} from "./command-result-owners.js";
export {
  failActiveLifecycleOperationsWithSettledCommands,
  replaySettledCommandActiveSideEffects,
} from "./command-result-side-effect-sweep.js";
