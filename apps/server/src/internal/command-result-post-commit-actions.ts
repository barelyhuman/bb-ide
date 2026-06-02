import type { HostDaemonCommandRow } from "@bb/db";
import type {
  CommandResultPostCommitAction,
  CommandResultSideEffectsDeps,
} from "./command-result-side-effects.js";
import { scheduleAfterDaemonIngressResponse } from "../services/hosts/daemon-ingress-scheduler.js";

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
