import type { QueryClient } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
import { environmentQueryKey } from "../queries/query-keys";
import { invalidateEnvironmentWorkspaceStateQueries } from "./environment-cache-effects";

interface EnvironmentUpdateResultArgs {
  environment: Environment;
  queryClient: QueryClient;
}

export function applyEnvironmentUpdateResult({
  environment,
  queryClient,
}: EnvironmentUpdateResultArgs): void {
  queryClient.setQueryData<Environment>(
    environmentQueryKey(environment.id),
    environment,
  );
  invalidateEnvironmentWorkspaceStateQueries({
    environmentId: environment.id,
    queryClient,
  });
}
