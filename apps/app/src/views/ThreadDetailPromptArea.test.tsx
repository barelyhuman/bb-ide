// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

vi.mock("@/components/thread/ThreadPendingInteractionBanner", () => ({
  ThreadPendingInteractionBanner: ({
    interaction,
  }: {
    interaction: { id: string };
  }) => <div data-testid="thread-pending-interaction-banner">{interaction.id}</div>,
}));

vi.mock("@/hooks/queries/thread-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/queries/thread-queries")>();

  return {
    ...actual,
    useThreadDefaultExecutionOptions: vi.fn(() => ({ data: null })),
    useThreadDrafts: vi.fn(() => ({ data: [] })),
    useThreadPendingInteractions: vi.fn(() => ({
      data: [
        {
          id: "pi_1",
          threadId: "thr_1",
          turnId: "turn_1",
          providerId: "codex",
          providerThreadId: "provider-thread-1",
          providerRequestId: "request-1",
          providerRequestMethod: "item/tool/requestUserInput",
          status: "pending",
          payload: {
            kind: "user_input_request",
            itemId: "item_1",
            questions: [],
          },
          resolution: null,
          statusReason: null,
          createdAt: 1,
          resolvedAt: null,
        },
      ],
    })),
  };
});

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: vi.fn(() => ({
    isPending: false,
    mutateAsync: vi.fn(),
  })),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThreadDraft: vi.fn(() => ({
    isPending: false,
    mutateAsync: vi.fn(),
  })),
  useDeleteThreadDraft: vi.fn(() => ({
    isPending: false,
    mutateAsync: vi.fn(),
  })),
  useSendThreadDraft: vi.fn(() => ({
    isPending: false,
    mutateAsync: vi.fn(),
  })),
  useStopThread: vi.fn(() => ({
    isPending: false,
    mutate: vi.fn(),
  })),
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: vi.fn(() => ({
    text: "",
    attachments: [],
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    clearIfCurrentMatches: vi.fn(),
    setText: vi.fn(),
    setAttachments: vi.fn(),
  })),
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: vi.fn(() => ({
    isError: false,
    isLoading: false,
    suggestions: [],
    setQuery: vi.fn(),
    threadSuggestionMode: "managers",
  })),
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: vi.fn(() => ({
    selectedProviderId: "codex",
    providerOptions: [],
    hasMultipleProviders: false,
    selectedProviderDisplayName: "Codex",
    selectedModel: "gpt-5.4",
    setSelectedModel: vi.fn(),
    serviceTier: undefined,
    setServiceTier: vi.fn(),
    reasoningLevel: "medium",
    setReasoningLevel: vi.fn(),
    sandboxMode: "danger-full-access",
    setSandboxMode: vi.fn(),
    activeModel: null,
    modelOptions: [],
    reasoningOptions: [],
    sandboxOptions: [],
    supportsServiceTier: false,
    serviceTierSupportByProvider: {},
  })),
}));

vi.mock("./useThreadFollowUpTracking", () => ({
  useThreadFollowUpTracking: vi.fn(() => ({
    beginPendingFollowUp: vi.fn(),
    clearPendingFollowUp: vi.fn(),
    pendingSubmittedFollowUp: null,
  })),
}));

function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Pending interaction thread",
    titleFallback: "Pending interaction thread",
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea", () => {
  it("shows the pending interaction banner and disables the normal follow-up prompt", () => {
    render(
      <ThreadDetailPromptArea
        canExpandPromptChangeList={false}
        canUseGitUi={false}
        isDiffPanelActive={false}
        isEnvironmentActionPending={false}
        isLoadingMergeBaseBranchOptions={false}
        openDiffFile={() => {}}
        openThreadDiffPanel={() => {}}
        projectId="proj_1"
        promptBannerSummary="No changes"
        promptComposerRef={{ current: null }}
        scrollToBottom={() => {}}
        sendMessage={{
          isPending: false,
          mutateAsync: vi.fn(async () => {}),
        }}
        showBranchComparisonUi={false}
        showPromptGitStatsBanner={false}
        showScrollToBottom={false}
        thread={createThread()}
        threadDetailRows={[]}
      />,
    );

    expect(screen.getByTestId("thread-pending-interaction-banner").textContent).toContain("pi_1");
    expect(
      screen.getByPlaceholderText(
        "Resolve the pending interaction below before sending another message",
      ),
    ).not.toBeNull();
    const submitButton = screen.getByTitle("Submit (Enter)");
    expect(submitButton).toHaveProperty("disabled", true);
  });
});
