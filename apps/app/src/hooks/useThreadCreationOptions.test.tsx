// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AvailableModel } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { createTestSystemProvider } from "@/test/system-provider-test-utils";
import { useThreadCreationOptions } from "./useThreadCreationOptions";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getAvailableModels: vi.fn(),
    getSystemExecutionOptions: vi.fn(),
    listSystemProviders: vi.fn(),
  };
});

interface ModelOverrides extends Partial<AvailableModel> {}

const PERMISSION_MODE_OPTIONS = [
  {
    value: "full",
    label: "Full Access",
    tone: "warning",
  },
  {
    value: "workspace-write",
    label: "Workspace Write",
  },
  {
    value: "readonly",
    label: "Readonly",
  },
] as const;

function makeModel(overrides: ModelOverrides = {}): AvailableModel {
  return {
    defaultReasoningEffort: "medium",
    description: "Model description",
    displayName: "gpt-5.4",
    id: "model-id",
    isDefault: true,
    model: "gpt-5.4",
    supportedReasoningEfforts: [
      {
        description: "Low effort",
        reasoningEffort: "low",
      },
      {
        description: "Medium effort",
        reasoningEffort: "medium",
      },
    ],
    ...overrides,
  };
}

function mockExecutionOptions({
  models,
  providers,
}: {
  models: AvailableModel[];
  providers: ReturnType<typeof createTestSystemProvider>[];
}): void {
  vi.mocked(api.getSystemExecutionOptions).mockResolvedValue({
    models,
    providers,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useThreadCreationOptions", () => {
  it("does not load provider or model options while disabled", () => {
    const { wrapper } = createQueryClientTestHarness();
    renderHook(
      () =>
        useThreadCreationOptions({
          enabled: false,
          initialProviderId: "codex",
          projectId: "project-disabled-options",
          scope: "thread",
        }),
      { wrapper },
    );

    expect(api.listSystemProviders).not.toHaveBeenCalled();
    expect(api.getAvailableModels).not.toHaveBeenCalled();
    expect(api.getSystemExecutionOptions).not.toHaveBeenCalled();
  });

  it("does not load hostless execution options for a thread without an environment", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          initialProviderId: "codex",
          projectId: "project-thread-without-environment",
          scope: "thread",
        }),
      { wrapper },
    );

    expect(result.current.providerOptions).toEqual([]);
    expect(api.getSystemExecutionOptions).not.toHaveBeenCalled();
  });

  it("loads provider metadata and models with one execution-options request", async () => {
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          model: "gpt-5.4",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId: "project-provider-gating",
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
    });

    expect(api.getSystemExecutionOptions).toHaveBeenCalledWith({
      environmentId: undefined,
      providerId: undefined,
      providerScope: "all",
      selectedModel: undefined,
    });
    expect(api.listSystemProviders).not.toHaveBeenCalled();
    expect(api.getAvailableModels).not.toHaveBeenCalled();
  });

  it("falls back to valid provider and model values from query data", async () => {
    const projectId = "project-1";
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.provider", projectId),
      "missing",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.model", projectId),
      "missing-model",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.reasoning", projectId),
      "xhigh",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.service-tier", projectId),
      "fast",
    );

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsServiceTier: false,
          },
          displayName: "Codex",
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          defaultReasoningEffort: "low",
          displayName: "gpt-5.4",
          id: "gpt-5.4",
          model: "gpt-5.4",
          supportedReasoningEfforts: [
            {
              description: "Low effort",
              reasoningEffort: "low",
            },
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
    });

    expect(result.current.selectedModel).toBe("gpt-5.4");
    expect(result.current.reasoningLevel).toBe("low");
    expect(result.current.permissionMode).toBe("full");
    expect(result.current.permissionModeOptions).toEqual(
      PERMISSION_MODE_OPTIONS,
    );
    expect(result.current.serviceTier).toBeUndefined();
    expect(result.current.supportsServiceTier).toBe(false);
  });

  it("persists new-thread selections to project-scoped local storage", async () => {
    const projectId = "project-storage";

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsServiceTier: true,
          },
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          model: "gpt-5.4",
        }),
        makeModel({
          defaultReasoningEffort: "high",
          displayName: "gpt-5.4-mini",
          id: "gpt-5.4-mini",
          isDefault: false,
          model: "gpt-5.4-mini",
          supportedReasoningEfforts: [
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
            {
              description: "High effort",
              reasoningEffort: "high",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4");
    });

    act(() => {
      result.current.setSelectedModel("gpt-5.4-mini");
      result.current.setReasoningLevel("high");
      result.current.setPermissionMode("workspace-write");
      result.current.setServiceTier("fast");
      result.current.setEnvironmentSelectionValue("worktree");
    });

    await waitFor(() => {
      expect(
        localStorage.getItem(
          getProjectScopedStorageKey("bb.promptbox.model", projectId),
        ),
      ).toBe("gpt-5.4-mini");
    });

    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.reasoning", projectId),
      ),
    ).toBe("high");
    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.permission-mode", projectId),
      ),
    ).toBe("workspace-write");
    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.service-tier", projectId),
      ),
    ).toBe("fast");
    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.environment", projectId),
      ),
    ).toBe("worktree");
  });

  it("preserves touched thread selections until the reset key changes", async () => {
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          isDefault: true,
          model: "gpt-5.4",
        }),
        makeModel({
          defaultReasoningEffort: "high",
          displayName: "gpt-5.4-mini",
          id: "gpt-5.4-mini",
          isDefault: false,
          model: "gpt-5.4-mini",
          supportedReasoningEfforts: [
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
            {
              description: "High effort",
              reasoningEffort: "high",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({
        initialModel,
        resetKey,
      }: {
        initialModel: string;
        resetKey: string;
      }) =>
        useThreadCreationOptions({
          environmentId: "environment-thread",
          initialModel,
          initialProviderId: "codex",
          projectId: "project-thread",
          resetKey,
          scope: "thread",
        }),
      {
        initialProps: {
          initialModel: "gpt-5.4",
          resetKey: "thread-1",
        },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4");
    });

    act(() => {
      result.current.setSelectedModel("gpt-5.4-mini");
    });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4-mini");
    });

    rerender({
      initialModel: "gpt-5.4",
      resetKey: "thread-1",
    });

    expect(result.current.selectedModel).toBe("gpt-5.4-mini");

    rerender({
      initialModel: "gpt-5.4",
      resetKey: "thread-2",
    });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4");
    });
  });

  it("switches to the new provider default model when the provider changes", async () => {
    const providers = [
      createTestSystemProvider({
        displayName: "Codex",
        id: "codex",
      }),
      createTestSystemProvider({
        capabilities: {
          supportsArchive: false,
        },
        displayName: "Claude Code",
        id: "claude-code",
      }),
    ];
    vi.mocked(api.getSystemExecutionOptions).mockImplementation(
      async ({ providerId }) => ({
        providers,
        models:
          providerId === "claude-code"
            ? [
                makeModel({
                  defaultReasoningEffort: "high",
                  displayName: "Claude Sonnet 4.6",
                  id: "claude-sonnet-4-6",
                  model: "claude-sonnet-4-6",
                }),
              ]
            : [
                makeModel({
                  displayName: "gpt-5.4",
                  id: "gpt-5.4",
                  model: "gpt-5.4",
                }),
              ],
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId: "project-switch",
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
    });

    act(() => {
      result.current.setSelectedProviderId("claude-code");
    });

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("claude-code");
    });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("claude-sonnet-4-6");
    });

    expect(result.current.modelOptions).toEqual([
      {
        label: "Sonnet 4.6",
        value: "claude-sonnet-4-6",
      },
    ]);
  });

  it("passes the current model to provider lookup for selected-only runtime models", async () => {
    const providers = [
      createTestSystemProvider({
        displayName: "Codex",
        id: "codex",
      }),
      createTestSystemProvider({
        capabilities: {
          supportsArchive: false,
        },
        displayName: "Claude Code",
        id: "claude-code",
      }),
    ];
    vi.mocked(api.getSystemExecutionOptions).mockImplementation(
      async ({ providerId, selectedModel }) => ({
        providers,
        models:
          providerId === "claude-code" && selectedModel === "opus[1m]"
            ? [
                makeModel({
                  displayName: "Opus Alias (1M, Legacy)",
                  id: "opus[1m]",
                  isDefault: false,
                  model: "opus[1m]",
                }),
                makeModel({
                  defaultReasoningEffort: "xhigh",
                  displayName: "Claude Opus 4.7 (1M)",
                  id: "claude-opus-4-7[1m]",
                  isDefault: true,
                  model: "claude-opus-4-7[1m]",
                }),
              ]
            : [
                makeModel({
                  displayName: "gpt-5.4",
                  id: "gpt-5.4",
                  model: "gpt-5.4",
                }),
              ],
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          environmentId: "environment-selected-only",
          initialModel: "opus[1m]",
          initialProviderId: "claude-code",
          projectId: "project-selected-only",
          scope: "thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.getSystemExecutionOptions).toHaveBeenCalledWith({
        environmentId: "environment-selected-only",
        providerId: "claude-code",
        providerScope: "all",
        selectedModel: "opus[1m]",
      });
    });
    await waitFor(() => {
      expect(result.current.modelOptions[0]).toEqual({
        label: "Opus Alias (1M, Legacy)",
        value: "opus[1m]",
      });
    });
    expect(result.current.selectedModel).toBe("opus[1m]");
  });
});
