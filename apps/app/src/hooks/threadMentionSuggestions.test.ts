import type { Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildThreadMentionSuggestions,
  type ThreadSuggestionMode,
} from "./threadMentionSuggestions";

interface ThreadFixtureOptions {
  id: string;
  parentThreadId?: string | null;
  projectId?: string;
  type: Thread["type"];
  title: string | null;
  titleFallback?: string | null;
}

interface BuildSuggestionFixtureArgs {
  threads: readonly Thread[];
  query: string;
  mode: ThreadSuggestionMode;
  currentProjectId?: string;
  currentThreadId?: string;
  limit?: number;
}

function makeThread(options: ThreadFixtureOptions): Thread {
  return {
    id: options.id,
    projectId: options.projectId ?? "proj-1",
    environmentId: "env-1",
    automationId: null,
    providerId: "openai",
    type: options.type,
    title: options.title,
    titleFallback: options.titleFallback ?? null,
    status: "idle",
    parentThreadId: options.parentThreadId ?? null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function getSuggestionThreadIds(
  args: BuildSuggestionFixtureArgs,
): readonly string[] {
  return buildThreadMentionSuggestions({
    threads: args.threads,
    query: args.query,
    mode: args.mode,
    currentProjectId: args.currentProjectId,
    currentThreadId: args.currentThreadId,
    projectNamesById: new Map([
      ["proj-1", "Core App"],
      ["proj-2", "Docs Site"],
    ]),
    limit: args.limit ?? 8,
  }).map((suggestion) => suggestion.threadId);
}

describe("buildThreadMentionSuggestions", () => {
  it("matches non-contiguous title queries", () => {
    const threads = [
      makeThread({
        id: "thr_research",
        type: "standard",
        title: "Research notes",
      }),
      makeThread({
        id: "thr_prompt",
        type: "manager",
        title: "Prompt mention improvements",
      }),
      makeThread({
        id: "thr_release",
        type: "standard",
        title: "Release checklist",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "pmi",
        mode: "all",
      }),
    ).toEqual(["thr_prompt"]);
  });

  it("matches thread ids", () => {
    const threads = [
      makeThread({
        id: "thr_alpha",
        type: "manager",
        title: "Design review",
      }),
      makeThread({
        id: "thr_beta",
        type: "standard",
        title: "Implementation plan",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "beta",
        mode: "all",
      }),
    ).toEqual(["thr_beta"]);
  });

  it("excludes the current thread", () => {
    const threads = [
      makeThread({
        id: "thr_current",
        type: "manager",
        title: "Prompt mention improvements",
      }),
      makeThread({
        id: "thr_other",
        type: "manager",
        title: "Prompt mention rollout",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "prompt",
        mode: "all",
        currentThreadId: "thr_current",
      }),
    ).toEqual(["thr_other"]);
  });

  it("returns managers and standard threads in all mode with deterministic ties", () => {
    const threads = [
      makeThread({
        id: "thr_standard",
        type: "standard",
        title: "Shared context",
      }),
      makeThread({
        id: "thr_manager",
        type: "manager",
        title: "Shared context",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "shared",
        mode: "all",
      }),
    ).toEqual(["thr_manager", "thr_standard"]);
  });

  it("ranks directly related, same-manager, and same-project thread matches together", () => {
    const threads = [
      makeThread({
        id: "thr_current",
        parentThreadId: "thr_manager",
        title: "Shared context",
        type: "standard",
      }),
      makeThread({
        id: "thr_other_project_manager",
        projectId: "proj-2",
        title: "Shared context",
        type: "manager",
      }),
      makeThread({
        id: "thr_same_project",
        title: "Shared context",
        type: "standard",
      }),
      makeThread({
        id: "thr_sibling",
        parentThreadId: "thr_manager",
        title: "Shared context",
        type: "standard",
      }),
      makeThread({
        id: "thr_manager",
        title: "Shared context",
        type: "manager",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "shared",
        mode: "all",
        currentProjectId: "proj-1",
        currentThreadId: "thr_current",
      }),
    ).toEqual([
      "thr_manager",
      "thr_sibling",
      "thr_same_project",
      "thr_other_project_manager",
    ]);
  });

  it("ranks children of the current manager as directly managed", () => {
    const threads = [
      makeThread({
        id: "thr_manager",
        title: "Shared context",
        type: "manager",
      }),
      makeThread({
        id: "thr_same_project_manager",
        title: "Shared context",
        type: "manager",
      }),
      makeThread({
        id: "thr_child",
        parentThreadId: "thr_manager",
        title: "Shared context",
        type: "standard",
      }),
      makeThread({
        id: "thr_other_project_manager",
        projectId: "proj-2",
        title: "Shared context",
        type: "manager",
      }),
    ];

    expect(
      getSuggestionThreadIds({
        threads,
        query: "shared",
        mode: "all",
        currentProjectId: "proj-1",
        currentThreadId: "thr_manager",
      }),
    ).toEqual([
      "thr_child",
      "thr_same_project_manager",
      "thr_other_project_manager",
    ]);
  });

  it("adds project names only for threads outside the current project", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_current_project",
          projectId: "proj-1",
          title: "Shared context",
          type: "standard",
        }),
        makeThread({
          id: "thr_other_project",
          projectId: "proj-2",
          title: "Shared context",
          type: "standard",
        }),
      ],
      query: "shared",
      mode: "all",
      currentProjectId: "proj-1",
      projectNamesById: new Map([
        ["proj-1", "Core App"],
        ["proj-2", "Docs Site"],
      ]),
      limit: 8,
    });

    expect(
      suggestions.map((suggestion) => ({
        projectId: suggestion.projectId,
        projectName: suggestion.projectName,
        threadId: suggestion.threadId,
      })),
    ).toEqual([
      {
        projectId: "proj-1",
        projectName: undefined,
        threadId: "thr_current_project",
      },
      {
        projectId: "proj-2",
        projectName: "Docs Site",
        threadId: "thr_other_project",
      },
    ]);
  });

  it("adds project names when the current project is unknown", () => {
    const suggestions = buildThreadMentionSuggestions({
      threads: [
        makeThread({
          id: "thr_first_project",
          projectId: "proj-1",
          title: "Shared context",
          type: "standard",
        }),
        makeThread({
          id: "thr_second_project",
          projectId: "proj-2",
          title: "Shared context",
          type: "standard",
        }),
      ],
      query: "shared",
      mode: "all",
      projectNamesById: new Map([
        ["proj-1", "Core App"],
        ["proj-2", "Docs Site"],
      ]),
      limit: 8,
    });

    expect(
      suggestions.map((suggestion) => ({
        projectId: suggestion.projectId,
        projectName: suggestion.projectName,
        threadId: suggestion.threadId,
      })),
    ).toEqual([
      {
        projectId: "proj-1",
        projectName: "Core App",
        threadId: "thr_first_project",
      },
      {
        projectId: "proj-2",
        projectName: "Docs Site",
        threadId: "thr_second_project",
      },
    ]);
  });
});
