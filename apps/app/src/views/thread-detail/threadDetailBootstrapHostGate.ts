import type { Environment } from "@bb/domain";
import type { ThreadWithIncludesResponse } from "@bb/server-contract";

interface ThreadDetailMissingHostGateArgs {
  environment: Environment | undefined;
  threadDetailBootstrap: ThreadWithIncludesResponse | undefined;
}

export function threadDetailBootstrapResolvedMissingEnvironmentHost({
  environment,
  threadDetailBootstrap,
}: ThreadDetailMissingHostGateArgs): boolean {
  return (
    environment !== undefined &&
    threadDetailBootstrap?.environment?.id === environment.id &&
    threadDetailBootstrap.environment.hostId === environment.hostId &&
    threadDetailBootstrap.host === null
  );
}
