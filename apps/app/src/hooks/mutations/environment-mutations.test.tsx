// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "@bb/domain";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as api from "@/lib/api";
import {
  environmentGitDiffQueryKeyPrefix,
  environmentMergeBaseBranchesQueryKeyPrefix,
  environmentQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  statusQueryKey,
} from "../queries/query-keys";
import { useUpdateEnvironment } from "./environment-mutations";

vi.mock("@/lib/api", () => ({
  updateEnvironment: vi.fn(),
  requestEnvironmentAction: vi.fn(),
}));

function createEnvironment(): Environment {
  return {
    id: "env-1",
    projectId: "proj-1",
    hostId: "host-1",
    path: "/tmp/env-1",
    managed: true,
    isGitRepo: true,
    isWorktree: true,
    workspaceProvisionType: "managed-worktree",
    branchName: "feature/thread-1",
    defaultBranch: "main",
    mergeBaseBranch: "release",
    status: "ready",
    cleanupMode: null,
    cleanupRequestedAt: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useUpdateEnvironment", () => {
  it("updates the persisted environment cache and invalidates only workspace state queries", async () => {
    const environment = createEnvironment();
    vi.mocked(api.updateEnvironment).mockResolvedValue(environment);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateEnvironment(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: environment.id,
        mergeBaseBranch: environment.mergeBaseBranch,
      });
    });

    expect(queryClient.getQueryData(environmentQueryKey(environment.id))).toEqual(
      environment,
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: environmentWorkStatusQueryKeyPrefix(environment.id),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: environmentGitDiffQueryKeyPrefix(environment.id),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: environmentQueryKey(environment.id),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: environmentMergeBaseBranchesQueryKeyPrefix(environment.id),
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: statusQueryKey(),
    });
  });
});
