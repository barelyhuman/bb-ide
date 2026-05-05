import { describe, expect, it } from "vitest";
import type {
  TimelineActivityIntent,
  TimelineCommandWorkRow,
  TimelineFileChangeWorkRow,
  TimelineRowBase,
  TimelineSystemRow,
  TimelineToolWorkRow,
  TimelineWebFetchWorkRow,
  TimelineWebSearchWorkRow,
} from "@bb/server-contract";
import {
  buildTimelineActivityIntentTitles,
  buildTimelineRowTitle,
  type BuildTimelineRowTitleOptions,
  type TimelineViewDelegationWorkRow,
  type TimelineViewTurnRow,
  type TimelineViewWorkRow,
  type TimelineWorkSummaryKind,
  type TimelineWorkSummaryRow,
} from "../src/index.js";

const DEFAULT_OPTIONS: BuildTimelineRowTitleOptions = {
  summaryStyle: "bundle",
  workStyle: "default",
};

function baseRow(id: string): TimelineRowBase {
  return {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
  };
}

function commandRow(): TimelineCommandWorkRow {
  return {
    ...baseRow("command-1"),
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: "call-1",
    command: "pnpm exec turbo run test --filter=@bb/app",
    cwd: null,
    source: null,
    output: "",
    exitCode: 0,
    durationMs: 2_100,
    approvalStatus: null,
    activityIntents: [],
  };
}

function toolRow(): TimelineToolWorkRow {
  return {
    ...baseRow("tool-1"),
    kind: "work",
    workKind: "tool",
    status: "completed",
    callId: "tool-call-1",
    toolName: "Read",
    toolArgs: {
      file_path: "/repo/src/app.ts",
    },
    label: "Read /repo/src/app.ts",
    output: "",
    durationMs: 2_100,
    approvalStatus: null,
    activityIntents: [readIntent("/repo/src/app.ts")],
  };
}

function readIntent(path: string): TimelineActivityIntent {
  return {
    type: "read",
    command: `cat ${path}`,
    name: path.split("/").pop() ?? path,
    path,
  };
}

function searchIntent(query: string, path: string): TimelineActivityIntent {
  return {
    type: "search",
    command: `rg ${query} ${path}`,
    query,
    path,
  };
}

function deletedFileRow(): TimelineFileChangeWorkRow {
  return {
    ...baseRow("file-1"),
    kind: "work",
    workKind: "file-change",
    status: "completed",
    callId: "file-call-1",
    change: {
      path: "docs/react-perf-audit.md",
      kind: "delete",
      movePath: null,
      diff: "-line 1\n-line 2",
      diffStats: {
        added: 0,
        removed: 2,
      },
    },
    stdout: null,
    stderr: null,
    approvalStatus: null,
  };
}

function createdFileRow(): TimelineFileChangeWorkRow {
  return {
    ...baseRow("file-created-1"),
    kind: "work",
    workKind: "file-change",
    status: "completed",
    callId: "file-call-2",
    change: {
      path: "src/new-file.ts",
      kind: "add",
      movePath: null,
      diff: "first\nsecond\n",
      diffStats: {
        added: 2,
        removed: 0,
      },
    },
    stdout: null,
    stderr: null,
    approvalStatus: null,
  };
}

function editedFileRow(): TimelineFileChangeWorkRow {
  return {
    ...baseRow("file-edited-1"),
    kind: "work",
    workKind: "file-change",
    status: "completed",
    callId: "file-call-3",
    change: {
      path: "src/existing-file.ts",
      kind: "update",
      movePath: null,
      diff: "-before\n+after",
      diffStats: {
        added: 1,
        removed: 1,
      },
    },
    stdout: null,
    stderr: null,
    approvalStatus: null,
  };
}

function webSearchRow(): TimelineWebSearchWorkRow {
  return {
    ...baseRow("web-search-1"),
    kind: "work",
    workKind: "web-search",
    status: "completed",
    callId: "web-search-call-1",
    queries: ["timeline renderer"],
  };
}

function webFetchRow(): TimelineWebFetchWorkRow {
  return {
    ...baseRow("web-fetch-1"),
    kind: "work",
    workKind: "web-fetch",
    status: "completed",
    callId: "web-fetch-call-1",
    url: "https://example.com/thread-view",
    prompt: null,
    pattern: null,
  };
}

function delegationRow(): TimelineViewDelegationWorkRow {
  return {
    ...baseRow("delegation-1"),
    kind: "work",
    workKind: "delegation",
    status: "completed",
    callId: "delegation-call-1",
    toolName: "spawnAgent",
    subagentType: "general-purpose-review-agent-with-a-long-name",
    description: "Review correctness + plan adherence",
    output: "",
    durationMs: 45_000,
    childRows: [],
  };
}

function systemOperationRow(): TimelineSystemRow {
  return {
    ...baseRow("system-1"),
    kind: "system",
    systemKind: "operation",
    title: "Thread release failed",
    detail: null,
    status: "error",
  };
}

function workSummaryRow(
  children: TimelineViewWorkRow[],
  kind: TimelineWorkSummaryKind = "step-summary",
): TimelineWorkSummaryRow {
  return {
    ...baseRow("summary-1"),
    kind,
    status: "completed",
    children,
  };
}

function turnRow(): TimelineViewTurnRow {
  return {
    ...baseRow("turn-1"),
    kind: "turn",
    status: "completed",
    summaryCount: 1,
    durationMs: 3_661_000,
    children: null,
  };
}

describe("buildTimelineRowTitle", () => {
  it("keeps command content separate from fixed prefix and duration suffix", () => {
    const title = buildTimelineRowTitle(commandRow(), DEFAULT_OPTIONS);

    expect(title.plain).toBe(
      "Ran pnpm exec turbo run test --filter=@bb/app 2s",
    );
    expect(title.prefix).toBe("Ran");
    expect(title.content).toBe("pnpm exec turbo run test --filter=@bb/app");
    expect(title.suffix).toEqual({
      kind: "text",
      text: "2s",
      truncate: false,
    });
  });

  it("shows pending command duration once it is over one second", () => {
    const title = buildTimelineRowTitle(
      {
        ...commandRow(),
        status: "pending",
        exitCode: null,
        durationMs: 2_100,
      },
      DEFAULT_OPTIONS,
    );

    expect(title.plain).toBe(
      "Running pnpm exec turbo run test --filter=@bb/app 2s",
    );
    expect(title.prefix).toBe("Running");
    expect(title.content).toBe("pnpm exec turbo run test --filter=@bb/app");
    expect(title.suffix).toEqual({
      kind: "text",
      text: "2s",
      truncate: false,
    });
    expect(title.motion).toBe("shimmer");
  });

  it("can render completed work leaves with muted summary title treatment", () => {
    const title = buildTimelineRowTitle(commandRow(), {
      summaryStyle: "background",
      workStyle: "summary",
    });

    expect(title.plain).toBe(
      "Ran pnpm exec turbo run test --filter=@bb/app 2s",
    );
    expect(title.prefix).toBe("Ran");
    expect(title.content).toBe("pnpm exec turbo run test --filter=@bb/app");
    expect(title.contentTone).toBe("muted");
    expect(title.tone).toBe("summary");
  });

  it.each([
    {
      expectedPlain:
        "Permission denied: pnpm exec turbo run test --filter=@bb/app 2s",
      row: {
        ...commandRow(),
        approvalStatus: "denied",
      } satisfies TimelineCommandWorkRow,
    },
    {
      expectedPlain: "Permission denied: src/existing-file.ts +1 -1",
      row: {
        ...editedFileRow(),
        approvalStatus: "denied",
      } satisfies TimelineFileChangeWorkRow,
    },
    {
      expectedPlain: "Permission denied: Read /repo/src/app.ts 2s",
      row: {
        ...toolRow(),
        approvalStatus: "denied",
      } satisfies TimelineToolWorkRow,
    },
  ])(
    "keeps denied $row.workKind titles destructive when summary work style is requested",
    ({ expectedPlain, row }) => {
      const title = buildTimelineRowTitle(row, {
        summaryStyle: "background",
        workStyle: "summary",
      });

      expect(title.plain).toBe(expectedPlain);
      expect(title.prefix).toBe("Permission denied:");
      expect(title.contentTone).toBe("emphasis");
      expect(title.tone).toBe("destructive");
    },
  );

  it("keeps error commands as command rows with status metadata", () => {
    const row = {
      ...commandRow(),
      status: "error",
      exitCode: 1,
      durationMs: 2_000,
    } satisfies TimelineCommandWorkRow;

    const title = buildTimelineRowTitle(row, DEFAULT_OPTIONS);

    expect(title.plain).toBe("Ran pnpm exec turbo run test --filter=@bb/app 2s");
    expect(title.tone).toBe("default");
  });

  it("keeps error tools in the normal tool title style", () => {
    const row = {
      ...toolRow(),
      status: "error",
    } satisfies TimelineToolWorkRow;

    const title = buildTimelineRowTitle(row, DEFAULT_OPTIONS);

    expect(title.plain).toBe("Ran tool: Read /repo/src/app.ts 2s");
    expect(title.tone).toBe("default");
    expect(title.suffix).toEqual({
      kind: "text",
      text: "2s",
      truncate: false,
    });
  });

  it("omits zero-sided diff stats from file change suffixes", () => {
    const title = buildTimelineRowTitle(deletedFileRow(), DEFAULT_OPTIONS);

    expect(title.plain).toBe("Deleted docs/react-perf-audit.md -2");
    expect(title.content).toBe("react-perf-audit.md");
    expect(title.suffix).toEqual({
      kind: "diff-stats",
      added: 0,
      removed: 2,
    });
  });

  it("keeps created file diff stats in the title suffix", () => {
    const title = buildTimelineRowTitle(createdFileRow(), DEFAULT_OPTIONS);

    expect(title.plain).toBe("Created src/new-file.ts +2");
    expect(title.prefix).toBe("Created");
    expect(title.content).toBe("new-file.ts");
    expect(title.suffix).toEqual({
      kind: "diff-stats",
      added: 2,
      removed: 0,
    });
  });

  it("declares an open-file-diff action on file-change titles using the canonical path", () => {
    const editTitle = buildTimelineRowTitle(editedFileRow(), DEFAULT_OPTIONS);
    expect(editTitle.action).toEqual({
      kind: "open-file-diff",
      path: "src/existing-file.ts",
    });

    const createTitle = buildTimelineRowTitle(
      createdFileRow(),
      DEFAULT_OPTIONS,
    );
    expect(createTitle.action).toEqual({
      kind: "open-file-diff",
      path: "src/new-file.ts",
    });
  });

  it("uses the rename destination as the open-file-diff path", () => {
    const renamedRow: TimelineFileChangeWorkRow = {
      ...editedFileRow(),
      change: {
        path: "src/old-name.ts",
        kind: "update",
        movePath: "src/new-name.ts",
        diff: "-before\n+after",
        diffStats: {
          added: 1,
          removed: 1,
        },
      },
    };

    const title = buildTimelineRowTitle(renamedRow, DEFAULT_OPTIONS);

    expect(title.action).toEqual({
      kind: "open-file-diff",
      path: "src/new-name.ts",
    });
  });

  it("does not declare an action on non-file-change titles", () => {
    const commandRow = {
      ...baseRow("cmd-1"),
      kind: "work" as const,
      workKind: "command" as const,
      status: "completed" as const,
      command: "ls",
      source: null,
      output: null,
      exitCode: 0,
      durationMs: 0,
      stdout: null,
      stderr: null,
      approvalStatus: null,
    } satisfies TimelineCommandWorkRow;

    const title = buildTimelineRowTitle(commandRow, DEFAULT_OPTIONS);

    expect(title.action).toBeNull();
  });

  it("marks long delegation metadata as a truncating suffix", () => {
    const title = buildTimelineRowTitle(delegationRow(), DEFAULT_OPTIONS);

    expect(title.plain).toBe(
      "Ran subagent: Review correctness + plan adherence (general-purpose-review-agent-with-a-long-name) 45s",
    );
    expect(title.suffix).toEqual({
      kind: "text",
      text: "(general-purpose-review-agent-with-a-long-name) 45s",
      truncate: true,
    });
  });

  it.each([
    {
      status: "error" as const,
      expectedPlain:
        "Failed subagent: Review correctness + plan adherence (general-purpose-review-agent-with-a-long-name) 45s",
      expectedTone: "destructive",
    },
    {
      status: "interrupted" as const,
      expectedPlain:
        "Interrupted subagent: Review correctness + plan adherence (general-purpose-review-agent-with-a-long-name) 45s",
      expectedTone: "default",
    },
  ])(
    "uses lifecycle wording for $status delegation titles",
    ({ status, expectedPlain, expectedTone }) => {
      const row = {
        ...delegationRow(),
        status,
      } satisfies TimelineViewDelegationWorkRow;

      const title = buildTimelineRowTitle(row, DEFAULT_OPTIONS);

      expect(title.plain).toBe(expectedPlain);
      expect(title.tone).toBe(expectedTone);
    },
  );

  it("uses destructive tone for failed system operation titles", () => {
    const title = buildTimelineRowTitle(systemOperationRow(), DEFAULT_OPTIONS);

    expect(title.plain).toBe("Thread release failed");
    expect(title.contentTone).toBe("emphasis");
    expect(title.tone).toBe("destructive");
  });

  it("formats turn durations over 60 minutes as hours", () => {
    const title = buildTimelineRowTitle(turnRow(), DEFAULT_OPTIONS);

    expect(title.plain).toBe("Worked for 1h 1m 1s");
  });

  it("hides subsecond turn durations", () => {
    const row = {
      ...turnRow(),
      durationMs: 250,
      summaryCount: 3,
    } satisfies TimelineViewTurnRow;

    const title = buildTimelineRowTitle(row, DEFAULT_OPTIONS);

    expect(title.plain).toBe("Worked");
  });

  it("hides one-second turn durations", () => {
    const row = {
      ...turnRow(),
      durationMs: 1_000,
      status: "pending",
    } satisfies TimelineViewTurnRow;

    const title = buildTimelineRowTitle(row, DEFAULT_OPTIONS);

    expect(title.plain).toBe("Working");
    expect(title.motion).toBe("shimmer");
  });

  it("does not use item-count fallback titles when turn duration is missing", () => {
    const row = {
      ...turnRow(),
      durationMs: null,
      summaryCount: 3,
    } satisfies TimelineViewTurnRow;

    const title = buildTimelineRowTitle(row, DEFAULT_OPTIONS);

    expect(title.plain).toBe("Worked");
  });

  it("can render step summaries as bundle titles or muted background summaries", () => {
    const row = workSummaryRow([webSearchRow(), webFetchRow()]);

    const bundleTitle = buildTimelineRowTitle(row, DEFAULT_OPTIONS);
    const backgroundTitle = buildTimelineRowTitle(row, {
      summaryStyle: "background",
      workStyle: "default",
    });

    expect(bundleTitle.plain).toBe("Ran 1 web search, fetched 1 web page");
    expect(bundleTitle.prefix).toBe("Ran");
    expect(bundleTitle.content).toBe("1 web search, fetched 1 web page");
    expect(bundleTitle.contentTone).toBe("emphasis");
    expect(backgroundTitle.plain).toBe("Ran 1 web search, fetched 1 web page");
    expect(backgroundTitle.prefix).toBeNull();
    expect(backgroundTitle.contentTone).toBe("muted");
    expect(backgroundTitle.tone).toBe("summary");
  });

  it("summarizes file changes by action", () => {
    const title = buildTimelineRowTitle(
      workSummaryRow([
        createdFileRow(),
        deletedFileRow(),
        editedFileRow(),
      ]),
      DEFAULT_OPTIONS,
    );

    expect(title.plain).toBe("Created 1 file, deleted 1 file, edited 1 file");
  });

  it("does not relabel completed summaries as active", () => {
    const title = buildTimelineRowTitle(workSummaryRow([webSearchRow()]), {
      summaryStyle: "bundle",
      workStyle: "default",
    });

    expect(title.plain).toBe("Ran 1 web search");
    expect(title.motion).toBe("none");
  });

  it("keeps non-success summary status visible without destructive tone", () => {
    const row = {
      ...workSummaryRow([
        {
          ...commandRow(),
          status: "error",
        },
      ]),
      status: "error",
    } satisfies TimelineWorkSummaryRow;

    const title = buildTimelineRowTitle(row, {
      summaryStyle: "background",
      workStyle: "default",
    });

    expect(title.plain).toBe("Ran 1 command (error)");
    expect(title.suffix).toEqual({
      kind: "text",
      text: "(error)",
      truncate: false,
    });
    expect(title.tone).toBe("summary");
  });

  it("keeps interrupted summary status visible", () => {
    const row = {
      ...workSummaryRow([
        {
          ...commandRow(),
          status: "interrupted",
        },
      ]),
      status: "interrupted",
    } satisfies TimelineWorkSummaryRow;

    const title = buildTimelineRowTitle(row, {
      summaryStyle: "background",
      workStyle: "default",
    });

    expect(title.plain).toBe("Ran 1 command (interrupted)");
    expect(title.tone).toBe("summary");
  });

  it("uses active wording for bundle summaries", () => {
    const row = {
      ...workSummaryRow(
        [
          {
            ...webSearchRow(),
            status: "pending",
          },
        ],
        "bundle-summary",
      ),
      status: "pending",
    } satisfies TimelineWorkSummaryRow;
    const title = buildTimelineRowTitle(row, {
      summaryStyle: "bundle",
      workStyle: "default",
    });

    expect(title.plain).toBe("Running 1 web search");
    expect(title.motion).toBe("shimmer");
  });

  it("uses semantic active wording for mixed bundle summaries", () => {
    const row = {
      ...workSummaryRow(
        [
          {
            ...toolRow(),
            status: "pending",
          },
          {
            ...commandRow(),
            status: "pending",
          },
        ],
        "bundle-summary",
      ),
      status: "pending",
    } satisfies TimelineWorkSummaryRow;
    const title = buildTimelineRowTitle(row, {
      summaryStyle: "bundle",
      workStyle: "default",
    });

    expect(title.plain).toBe("Exploring 1 file, running 1 command");
    expect(title.motion).toBe("shimmer");
  });

  it("uses active wording for tool-only bundle summaries", () => {
    const row = {
      ...workSummaryRow(
        [
          {
            ...toolRow(),
            activityIntents: [],
            label: "UnknownTool",
            toolName: "UnknownTool",
            status: "pending",
          },
        ],
        "bundle-summary",
      ),
      status: "pending",
    } satisfies TimelineWorkSummaryRow;
    const title = buildTimelineRowTitle(row, {
      summaryStyle: "bundle",
      workStyle: "default",
    });

    expect(title.plain).toBe("Running 1 tool");
    expect(title.motion).toBe("shimmer");
  });

  it("builds compact exploration intent titles with read de-duping", () => {
    const row = {
      ...commandRow(),
      activityIntents: [
        readIntent("src/app.ts"),
        readIntent("src/app.ts"),
        searchIntent("TODO", "src"),
      ],
    } satisfies TimelineCommandWorkRow;

    const titles = buildTimelineActivityIntentTitles(row);

    expect(titles.map((entry) => entry.title.plain)).toEqual([
      "Read src/app.ts",
      "Searched for TODO in src",
    ]);
    expect(titles[0]?.title.prefix).toBe("Read");
    expect(titles[0]?.title.content).toBe("app.ts");
    expect(titles.every((entry) => entry.title.contentTone === "muted")).toBe(
      true,
    );
  });

  it("uses active wording for pending compact exploration intent titles", () => {
    const row = {
      ...commandRow(),
      status: "pending",
      exitCode: null,
      activityIntents: [readIntent("src/app.ts"), searchIntent("TODO", "src")],
    } satisfies TimelineCommandWorkRow;

    const titles = buildTimelineActivityIntentTitles(row);

    expect(titles.map((entry) => entry.title.plain)).toEqual([
      "Reading src/app.ts",
      "Searching for TODO in src",
    ]);
    expect(titles[0]?.title.prefix).toBe("Reading");
    expect(titles[0]?.title.content).toBe("app.ts");
    expect(titles.every((entry) => entry.title.motion === "shimmer")).toBe(
      true,
    );
  });
});
