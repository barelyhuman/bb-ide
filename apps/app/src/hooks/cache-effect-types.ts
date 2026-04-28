import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { EnvironmentChangeKind } from "@bb/domain";

export interface QueryClientArg {
  queryClient: QueryClient;
}

export interface ProjectArg extends QueryClientArg {
  projectId: string;
}

export interface ThreadArg extends QueryClientArg {
  threadId: string;
}

export interface EnvironmentArg extends QueryClientArg {
  environmentId: string;
}

export interface OptionalEnvironmentArg extends QueryClientArg {
  environmentId: string | null | undefined;
}

export interface EnvironmentChangedArg extends EnvironmentArg {
  changeKinds: readonly EnvironmentChangeKind[];
}

export interface QueryKeysArg extends QueryClientArg {
  queryKeys: readonly QueryKey[];
}
