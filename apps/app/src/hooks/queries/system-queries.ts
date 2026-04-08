import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AvailableModel, Host, SandboxBackendInfo } from "@bb/domain";
import type { GithubRepoInfo, SystemProviderInfo } from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  availableModelsQueryKey,
  type HostQueryId,
  hostQueryKey,
  hostsQueryKey,
  githubReposQueryKey,
  sandboxBackendsQueryKey,
  systemProvidersQueryKey,
} from "./query-keys";

function requireHostId(
  hostId: HostQueryId,
  hookName: string,
): string {
  if (!hostId) {
    throw new Error(`${hookName}: hostId is required when query is enabled`);
  }

  return hostId;
}

export function useHosts() {
  return useQuery<Host[]>({
    queryKey: hostsQueryKey(),
    queryFn: () => api.listHosts(),
    staleTime: 30_000,
  });
}

export function useHost(hostId: HostQueryId) {
  return useQuery<Host>({
    queryKey: hostQueryKey(hostId),
    queryFn: () => api.getHost(requireHostId(hostId, "useHost")),
    enabled: Boolean(hostId),
    staleTime: 30_000,
  });
}

export function useAvailableModels(providerId?: string) {
  return useQuery<AvailableModel[]>({
    queryKey: availableModelsQueryKey(providerId ?? null),
    queryFn: () => api.getAvailableModels(providerId),
    staleTime: 60_000,
  });
}

export function useSystemProviders() {
  return useQuery<SystemProviderInfo[]>({
    queryKey: systemProvidersQueryKey(),
    queryFn: () => api.listSystemProviders(),
    staleTime: 60_000,
  });
}

export function useSandboxBackends(enabled: boolean) {
  return useQuery<SandboxBackendInfo[]>({
    queryKey: sandboxBackendsQueryKey(),
    queryFn: () => api.listSandboxBackends(),
    enabled,
    staleTime: 60_000,
  });
}

export function useGithubRepos(enabled: boolean, q: string) {
  return useQuery<GithubRepoInfo[]>({
    queryKey: githubReposQueryKey(q),
    queryFn: () => api.listGithubRepos(q || undefined),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
