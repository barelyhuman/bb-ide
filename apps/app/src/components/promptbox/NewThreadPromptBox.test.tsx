// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Host, PermissionMode, ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  NewThreadPromptBoxUI,
  type NewThreadModeConfig,
} from "./NewThreadPromptBox";

const noop = vi.fn();

type HostIdCandidate = string | null | undefined;
type EligibleHosts = readonly Host[];

interface TestProviderIconProps {
  className?: string;
}

const localHost: Host = {
  id: "host_local",
  name: "This Mac",
  type: "persistent",
  status: "connected",
  lastSeenAt: 100,
  createdAt: 0,
  updatedAt: 100,
};

const remoteHost: Host = {
  id: "host_remote",
  name: "Build box",
  type: "persistent",
  status: "connected",
  lastSeenAt: 100,
  createdAt: 0,
  updatedAt: 100,
};

const projectSources: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: "proj_bb",
    type: "local_path",
    hostId: localHost.id,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

const permissionModeOptions: readonly {
  value: PermissionMode;
  label: string;
}[] = [{ value: "workspace-write", label: "Workspace Write" }];

function TestProviderIcon({ className }: TestProviderIconProps) {
  return <svg className={className} aria-hidden />;
}

function isLocalHost(hostId: HostIdCandidate): boolean {
  return hostId === localHost.id;
}

function buildThreadModeConfig(
  eligibleHosts: EligibleHosts,
): NewThreadModeConfig {
  return {
    mode: "thread",
    environment: {
      value: `host:${localHost.id}:local`,
      onChange: noop,
      sources: projectSources,
      hosts: [localHost, remoteHost],
      isLocalHost,
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
    projectlessHost: {
      hosts: [localHost, remoteHost],
      eligibleHosts,
      value: localHost.id,
      onChange: noop,
      isLocalHost,
    },
  };
}

function buildManagerModeConfig(): NewThreadModeConfig {
  return {
    mode: "manager",
    host: {
      hosts: [localHost, remoteHost],
      eligibleHosts: [localHost],
      value: localHost.id,
      onChange: noop,
      isLocalHost,
    },
  };
}

function renderNewThreadPrompt(modeConfig: NewThreadModeConfig): void {
  const { wrapper } = createQueryClientTestHarness();

  render(
    <NewThreadPromptBoxUI
      value=""
      onChange={noop}
      onSubmit={noop}
      isSubmitting={false}
      disabled={false}
      zenModeStorageKey="bb.test.new-thread"
      history={{
        currentDraft: { text: "", attachments: [] },
        entries: [],
        onSelectEntry: noop,
      }}
      mentions={{
        suggestions: [],
        threadSectionMode: "threads",
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
          options: [
            { value: "codex", label: "Codex", icon: TestProviderIcon },
          ],
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
    renderNewThreadPrompt(buildThreadModeConfig([localHost]));

    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
      "Ask anything.",
    );
  });

  it("omits file mention copy from the projectless manager placeholder", () => {
    renderNewThreadPrompt(buildManagerModeConfig());

    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
      "Optional — instructions for the manager: what to work on, or how you like things done.",
    );
  });

  it("uses a host picker instead of the environment picker for projectless threads", () => {
    renderNewThreadPrompt(buildThreadModeConfig([localHost, remoteHost]));

    expect(screen.getByRole("button", { name: "Host" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
  });

  it("hides the projectless host picker when only one host is eligible", () => {
    renderNewThreadPrompt(buildThreadModeConfig([localHost]));

    expect(screen.queryByRole("button", { name: "Host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
  });

  it("uses shared promptbox selector dimensions for mode, model, and project controls", () => {
    renderNewThreadPrompt(buildThreadModeConfig([localHost]));

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
