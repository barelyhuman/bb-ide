import type { QueryClient } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
import {
  ENVIRONMENT_DIFF_FILE_QUERY_KEY,
  ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
  ENVIRONMENT_GIT_DIFF_QUERY_KEY,
  ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
  ENVIRONMENT_QUERY_KEY,
  ENVIRONMENT_WORK_STATUS_QUERY_KEY,
  THREAD_HOST_FILE_PREVIEW_QUERY_KEY,
  environmentQueryKey,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";
import { invalidateEnvironmentWorkspaceStateQueries } from "./environment-cache-effects";

interface EnvironmentUpdateResultArgs {
  environment: Environment;
  queryClient: QueryClient;
}

export const environmentWorkspaceCacheOwner = {
  id: "environment-workspace",
  ownedQueryRoots: [
    ENVIRONMENT_QUERY_KEY,
    ENVIRONMENT_WORK_STATUS_QUERY_KEY,
    ENVIRONMENT_MERGE_BASE_BRANCHES_QUERY_KEY,
    ENVIRONMENT_GIT_DIFF_QUERY_KEY,
    ENVIRONMENT_DIFF_FILE_QUERY_KEY,
    ENVIRONMENT_FILE_PREVIEW_QUERY_KEY,
    THREAD_HOST_FILE_PREVIEW_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "environment", kind: "environment-created" },
    { entity: "environment", kind: "environment-deleted" },
    { entity: "environment", kind: "metadata-changed" },
    { entity: "environment", kind: "status-changed" },
    { entity: "environment", kind: "work-status-changed" },
    { entity: "environment", kind: "git-refs-changed" },
  ],
  bootstrapPolicy:
    "Owns environment record and workspace-derived query ingestion from thread detail bootstrap and workspace actions.",
  deletionBehavior:
    "Removes deleted environment workspace projections and dependent thread host-file previews.",
  reconnectBehavior:
    "Refreshes environment workspace projections after reconnect.",
} satisfies CacheOwnerDescriptor;

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
