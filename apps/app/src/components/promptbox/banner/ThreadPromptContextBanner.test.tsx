// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { WorkspaceFileStatus } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  ThreadPromptContextBanner,
  type ThreadPromptContextBannerProps,
  type ThreadPromptGitSection,
  type ThreadPromptTodoSection,
} from "./ThreadPromptContextBanner";

type BannerOverrides = Partial<ThreadPromptContextBannerProps>;

const changedFile: WorkspaceFileStatus = {
  path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
  status: "M",
  insertions: 3,
  deletions: 1,
};

const todoSection: ThreadPromptTodoSection = {
  pendingTodos: {
    sourceSeq: 1,
    updatedAt: 1,
    items: [
      {
        id: "todo_1",
        text: "Keep compact context readable",
        status: "pending",
      },
    ],
  },
};

const gitSection: ThreadPromptGitSection = {
  changedFiles: {
    kind: "uncommitted",
    label: "Uncommitted",
    files: [changedFile],
    mergeBaseRef: null,
    stats: {
      files: [changedFile],
      insertions: 3,
      deletions: 1,
    },
  },
  mergeBase: null,
  onPromptBannerFileClick: vi.fn(),
};

const gitSectionWithMergeBase: ThreadPromptGitSection = {
  ...gitSection,
  mergeBase: {
    branch: "main",
    options: ["main", "develop"],
    onChange: vi.fn(),
  },
};

const managedBySection: ThreadPromptContextBannerProps["managedBySection"] = {
  managerName: "Manager",
  href: "/projects/proj_1/threads/thr_manager",
};

function renderBanner(overrides: BannerOverrides): void {
  render(
    <MemoryRouter>
      <ThreadPromptContextBanner
        todoSection={null}
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        managedBySection={null}
        managerChildrenSection={null}
        expandedSection={null}
        onToggleSection={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("ThreadPromptContextBanner", () => {
  it("keeps a single context segment label visible in compact markup", () => {
    renderBanner({ todoSection });

    const todoButton = screen.getByRole("button", { name: "Todos: 1" });

    expect(todoButton.querySelector("[data-promptbox-hide-compact]")).toBeNull();
  });

  it("keeps the archived label visible when it is the only segment", () => {
    renderBanner({
      archivedSection: { archivedAt: 1 },
    });

    expect(
      screen
        .getByText("Thread is archived")
        .hasAttribute("data-promptbox-hide-compact"),
    ).toBe(false);
  });

  it("keeps an accessible archived status when archived text compacts next to managed-by", () => {
    renderBanner({
      archivedSection: { archivedAt: 1 },
      managedBySection,
    });

    expect(
      screen.getByRole("status", { name: "Thread is archived" }),
    ).toBeTruthy();
    expect(
      screen
        .getByText("Thread is archived")
        .hasAttribute("data-promptbox-hide-compact"),
    ).toBe(true);
  });

  it("allows segment labels to collapse when multiple segments share the row", () => {
    renderBanner({ todoSection, gitSection });

    expect(
      screen
        .getByRole("button", { name: "Todos: 1" })
        .querySelector("[data-promptbox-hide-compact]"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /Changed files:/ })
        .querySelector("[data-promptbox-hide-compact]"),
    ).not.toBeNull();
  });

  it("hides the merge-base selector in compact markup", () => {
    renderBanner({ gitSection: gitSectionWithMergeBase });

    expect(
      screen
        .getByText("Merge base:")
        .parentElement?.hasAttribute("data-promptbox-hide-compact"),
    ).toBe(true);
  });
});
