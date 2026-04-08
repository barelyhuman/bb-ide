import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import type { CommandDispatchOptions, CommandOf } from "../command-dispatch-support.js";

export async function syncRuntimeMaterial(
  command: CommandOf<"host.sync_runtime_material">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"host.sync_runtime_material">> {
  const snapshot = await options.fetchRuntimeMaterial(command.version);
  options.runtimeManager.replaceManagedShellEnv(snapshot.env);
  await options.runtimeManager.evictIdleEnvironments();
  await options.persistRuntimeMaterial(snapshot);
  return {
    appliedVersion: snapshot.version,
  };
}
