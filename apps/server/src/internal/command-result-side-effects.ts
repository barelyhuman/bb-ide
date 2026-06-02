import type { DbNotifier, DbTransaction } from "@bb/db";
import type {
  HostDaemonCommand,
  HostDaemonCommandResultReportWithoutSession,
  HostDaemonDurableCommandType,
} from "@bb/host-daemon-contract";
import type { InteractiveLifecycleCoordinationDeps } from "../lifecycle-coordination-deps.js";
import type { AppDeps } from "../types.js";

export type CommandResultSideEffectsDeps =
  InteractiveLifecycleCoordinationDeps & Pick<AppDeps, "terminalSessions">;

export type CommandResultSettlementDeps = Omit<
  CommandResultSideEffectsDeps,
  "db" | "hub"
> & {
  db: DbTransaction;
  hub: DbNotifier;
};

export type CommandResultSideEffectReport =
  HostDaemonCommandResultReportWithoutSession;

export type HostDaemonCommandForType<TType extends HostDaemonDurableCommandType> =
  Extract<HostDaemonCommand, { type: TType }>;

export type CommandResultReportForType<TType extends HostDaemonDurableCommandType> =
  Extract<HostDaemonCommandResultReportWithoutSession, { type: TType }>;

export type CommandResultFailureReportForType<
  TType extends HostDaemonDurableCommandType,
> = Extract<CommandResultReportForType<TType>, { ok: false }>;

export type CommandResultSuccessReportForType<
  TType extends HostDaemonDurableCommandType,
> = Extract<CommandResultReportForType<TType>, { ok: true }>;

export interface CommandResultPostCommitActionContext {
  environmentId?: string | null;
  hostId?: string;
  threadId?: string;
}

export interface CommandResultPostCommitAction {
  context?: CommandResultPostCommitActionContext;
  name: string;
  run(deps: CommandResultSideEffectsDeps): Promise<void> | void;
}

export interface CommandResultSideEffectsResult {
  postCommitActions: CommandResultPostCommitAction[];
}

export interface BuildCommandResultSettlementDepsArgs {
  db: DbTransaction;
  deps: CommandResultSideEffectsDeps;
  hub: DbNotifier;
}

export function buildCommandResultSettlementDeps(
  args: BuildCommandResultSettlementDepsArgs,
): CommandResultSettlementDeps {
  return {
    ...args.deps,
    db: args.db,
    hub: args.hub,
  };
}

export function emptyCommandResultSideEffects(): CommandResultSideEffectsResult {
  return { postCommitActions: [] };
}
