// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { PermissionMode, ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  NewThreadPromptBoxUI,
  type NewThreadModeConfig,
} from "./NewThreadPromptBox";

const noop = vi.fn();

interface TestProviderIconProps {
  className?: string;
}

const localHostId = "host_local";

const projectSources: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: "proj_bb",
    type: "local_path",
    hostId: localHostId,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

const permissionModeOptions: readonly {
  value: PermissionMode;
  label: string;
}[] = [
  { value: "workspace-write", label: "Workspace Write" },
  { value: "full", label: "Full" },
];

function TestProviderIcon({ className }: TestProviderIconProps) {
  return <svg className={className} aria-hidden />;
}

function buildThreadModeConfig(): NewThreadModeConfig {
  return {
    mode: "thread",
    environment: {
      value: `host:${localHostId}:local`,
      onChange: noop,
      sources: projectSources,
      hostId: localHostId,
    },
    branch: {
      value: null,
      currentBranch: "main",
      isNew: false,
      options: ["main"],
      onChange: noop,
      onCreate: noop,
    },
    worktree: {
      options: [],
      value: null,
      onChange: noop,
    },
    permission: {
      value: "workspace-write",
      options: permissionModeOptions,
      onChange: noop,
      supported: true,
    },
  };
}

function buildManagerModeConfig(): NewThreadModeConfig {
  return {
    mode: "manager",
  };
}

function renderNewThreadPrompt(modeConfig: NewThreadModeConfig): void {
  const { wrapper } = createQueryClientTestHarness();

  render(
    <NewThreadPromptBoxUI
      value=""
      mentionRanges={[]}
      onChange={noop}
      onSubmit={noop}
      isSubmitting={false}
      disabled={false}
      zenModeStorageKey="bb.test.new-thread"
      history={{
        currentDraft: { text: "", mentions: [], attachments: [] },
        entries: [],
        onSelectEntry: noop,
      }}
      mentions={{
        suggestions: [],
        isLoading: false,
        isError: false,
        onQueryChange: noop,
      }}
      attachments={{ items: [] }}
      modeConfig={modeConfig}
      onModeChange={noop}
      project={{
        projects: [{ id: "proj_bb", name: "bb" }],
        value: null,
        onChange: noop,
        allowNoProject: true,
      }}
      execution={{
        provider: {
          selectedId: "codex",
          hasMultiple: false,
          options: [{ value: "codex", label: "Codex", icon: TestProviderIcon }],
        },
        model: {
          selected: "gpt-5",
          options: [{ value: "gpt-5", label: "GPT-5" }],
          onChange: noop,
        },
        reasoning: { value: "medium", options: [], onChange: noop },
      }}
    />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  noop.mockClear();
});

describe("NewThreadPromptBoxUI", () => {
  it("omits file mention copy from the projectless thread placeholder", () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    expect(screen.getByRole("textbox").getAttribute("data-placeholder")).toBe(
      "Ask anything.",
    );
  });

  it("omits file mention copy from the projectless manager placeholder", () => {
    renderNewThreadPrompt(buildManagerModeConfig());

    expect(screen.getByRole("textbox").getAttribute("data-placeholder")).toBe(
      "Optional — instructions for the manager: what to work on, or how you like things done.",
    );
  });

  it("does not render permission controls in manager mode", () => {
    renderNewThreadPrompt(buildManagerModeConfig());

    expect(
      screen.queryByRole("button", { name: /Permission mode/ }),
    ).toBeNull();
  });

  it("hides environment controls for projectless threads", () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    expect(screen.queryByRole("button", { name: "Host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
  });

  it("uses shared promptbox selector dimensions for mode, model, and project controls", () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    const selectorButtons = [
      screen.getByRole("button", { name: "Thread creation mode" }),
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
      screen.getByRole("button", { name: "Project" }),
    ];

    for (const button of selectorButtons) {
      expect(button.className).toContain("h-8");
      expect(button.className).toContain("px-1");
      expect(button.querySelector("svg")?.getAttribute("class")).toContain(
        "size-3.5",
      );
    }
  });
});
