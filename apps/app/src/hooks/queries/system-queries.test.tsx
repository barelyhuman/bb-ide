// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import {
  cloudAuthSettingsQueryKey,
  sandboxEnvVarsQueryKey,
} from "./query-keys";
import {
  useCloudAuthSettings,
  useSandboxEnvVars,
} from "./system-queries";
import { getEffectiveHost } from "./effective-hosts";

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Sandbox Host",
    status: "connected",
    type: "ephemeral",
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getEffectiveHost", () => {
  it("keeps raw host status before the initial server websocket connects", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "connected" }),
        serverConnectionState: "connecting",
      }).status,
    ).toBe("connected");
  });

  it("treats cached connected hosts as disconnected while reconnecting", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "connected" }),
        serverConnectionState: "reconnecting",
      }).status,
    ).toBe("disconnected");
  });

  it("preserves non-connected host statuses while reconnecting", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "suspended" }),
        serverConnectionState: "reconnecting",
      }).status,
    ).toBe("suspended");
  });
});

describe("cloud auth system queries", () => {
  it("keeps sandbox env var queries distinct from cloud auth queries", async () => {
    const fetchMock = installFetchRoutes([
      {
        pathname: "/api/v1/system/cloud-auth",
        handler: async () =>
          jsonResponse({
            connections: [],
          }),
      },
      {
        pathname: "/api/v1/system/sandbox-env-vars",
        handler: async () =>
          jsonResponse({
            envVars: [
              {
                createdAt: 1,
                name: "OPENAI_API_KEY",
                updatedAt: 2,
              },
            ],
          }),
      },
    ]);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const cloudAuth = renderHook(() => useCloudAuthSettings(true), { wrapper });
    const sandboxEnv = renderHook(() => useSandboxEnvVars(true), { wrapper });

    await waitFor(() => {
      expect(cloudAuth.result.current.data).toEqual({ connections: [] });
      expect(sandboxEnv.result.current.data?.envVars).toEqual([
        {
          createdAt: 1,
          name: "OPENAI_API_KEY",
          updatedAt: 2,
        },
      ]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(cloudAuthSettingsQueryKey())).toEqual({
      connections: [],
    });
    expect(queryClient.getQueryData(sandboxEnvVarsQueryKey())).toEqual({
      envVars: [
        {
          createdAt: 1,
          name: "OPENAI_API_KEY",
          updatedAt: 2,
        },
      ],
    });
  });
});
