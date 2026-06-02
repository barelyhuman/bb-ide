import type { HostDaemonEnvironmentChangePayload } from "@bb/host-daemon-contract";
import { getEnvironment, type DbNotifier } from "@bb/db";
import type { AppDeps } from "../types.js";

interface EnvironmentChangeNotificationDeps {
  hub: Pick<DbNotifier, "notifyEnvironment">;
}

interface NotifyDaemonEnvironmentChangeArgs extends HostDaemonEnvironmentChangePayload {
  hostId: string;
}

export interface NotifyWorkspaceMutationResultArgs {
  environmentId: string;
  ok: boolean;
}

export function notifyWorkspaceMutationResult(
  deps: EnvironmentChangeNotificationDeps,
  args: NotifyWorkspaceMutationResultArgs,
): void {
  if (!args.ok) {
    return;
  }
  deps.hub.notifyEnvironment(args.environmentId, ["work-status-changed"]);
}

export function notifyDaemonEnvironmentChange(
  deps: Pick<AppDeps, "db" | "hub">,
  args: NotifyDaemonEnvironmentChangeArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (
    !environment ||
    environment.hostId !== args.hostId ||
    environment.status === "destroyed"
  ) {
    return;
  }

  deps.hub.notifyEnvironment(environment.id, [args.change]);
}
