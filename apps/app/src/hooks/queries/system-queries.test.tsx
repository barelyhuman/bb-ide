// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { systemProvidersQueryKey } from "./query-keys";
import { useSystemExecutionOptions } from "./system-queries";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("system execution options query", () => {
  it("does not mirror execution-options responses into the providers cache", async () => {
    installFetchRoutes([
      {
        pathname: "/api/v1/system/execution-options",
        handler: async () =>
          jsonResponse({
            providers: [
              {
                id: "codex",
                displayName: "Codex",
                available: true,
                capabilities: {
                  supportsArchive: true,
                  supportsRename: true,
                  supportsServiceTier: true,
                  supportedPermissionModes: [
                    "full",
                    "workspace-write",
                    "readonly",
                  ],
                },
              },
            ],
            models: [
              {
                id: "gpt-5.5",
                model: "gpt-5.5",
                displayName: "GPT-5.5",
                description: "Frontier model",
                supportedReasoningEfforts: [
                  {
                    reasoningEffort: "medium",
                    description: "Balanced",
                  },
                ],
                defaultReasoningEffort: "medium",
                isDefault: true,
              },
            ],
          }),
      },
    ]);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const executionOptions = renderHook(
      () => useSystemExecutionOptions({ providerId: "codex" }),
      { wrapper },
    );

    await waitFor(() => {
      expect(executionOptions.result.current.data?.providers[0]?.id).toBe(
        "codex",
      );
    });

    expect(queryClient.getQueryData(systemProvidersQueryKey())).toBeUndefined();
  });
});
