import type { Environment, Host } from "@bb/domain";
import type { ThreadWithIncludesResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { threadDetailBootstrapResolvedMissingEnvironmentHost } from "./threadDetailBootstrapHostGate";

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    baseBranch: null,
    branchName: "bb/test",
    cleanupMode: null,
    cleanupRequestedAt: null,
    createdAt: 1,
    defaultBranch: "main",
    hostId: "host-1",
    id: "environment-1",
    name: null,
    isGitRepo: true,
    isWorktree: false,
    managed: false,
    mergeBaseBranch: null,
    path: "/tmp/thread-detail-bootstrap",
    projectId: "project-1",
    status: "ready",
    updatedAt: 1,
    workspaceProvisionType: "unmanaged",
    ...overrides,
  };
}

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Host One",
    status: "connected",
    type: "persistent",
    updatedAt: 1,
    ...overrides,
  };
}

function makeThreadBootstrap(
  environment: Environment,
  overrides: Partial<ThreadWithIncludesResponse> = {},
): ThreadWithIncludesResponse {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environment,
    environmentId: environment.id,
    host: null,
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    projectId: environment.projectId,
    providerId: "provider-1",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Thread",
    titleFallback: "Thread",
    type: "standard",
    updatedAt: 1,
    ...overrides,
  };
}

describe("threadDetailBootstrapResolvedMissingEnvironmentHost", () => {
  it("suppresses host fetches only for the environment host the bootstrap resolved as missing", () => {
    const environment = makeEnvironment();

    expect(
      threadDetailBootstrapResolvedMissingEnvironmentHost({
        environment,
        threadDetailBootstrap: makeThreadBootstrap(environment),
      }),
    ).toBe(true);

    expect(
      threadDetailBootstrapResolvedMissingEnvironmentHost({
        environment,
        threadDetailBootstrap: makeThreadBootstrap(
          makeEnvironment({ hostId: "host-2" }),
        ),
      }),
    ).toBe(false);
  });

  it("does not suppress host fetches when the bootstrap includes a host", () => {
    const environment = makeEnvironment();

    expect(
      threadDetailBootstrapResolvedMissingEnvironmentHost({
        environment,
        threadDetailBootstrap: makeThreadBootstrap(environment, {
          host: makeHost(),
        }),
      }),
    ).toBe(false);
  });

  it("does not suppress host fetches before the environment is resolved", () => {
    const environment = makeEnvironment();

    expect(
      threadDetailBootstrapResolvedMissingEnvironmentHost({
        environment: undefined,
        threadDetailBootstrap: makeThreadBootstrap(environment),
      }),
    ).toBe(false);
  });
});
