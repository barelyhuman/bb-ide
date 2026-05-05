// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TimelineActivityIntent,
  TimelineCommandWorkRow,
  TimelineConversationAttachments,
  TimelineConversationRow,
  TimelineConversationUserRequest,
  TimelineDelegationWorkRow,
  TimelineFileChangeWorkRow,
  TimelineRow,
  TimelineRowBase,
  TimelineRowStatus,
  TimelineSystemRow,
  TimelineToolWorkRow,
  TimelineTurnRow,
  TimelineWebFetchWorkRow,
  TimelineWebSearchWorkRow,
} from "@bb/server-contract";
import { ThreadTimelineRows } from "../src/thread-timeline/ThreadTimelineRows.js";
import type {
  ThreadTimelineLocalFileLinkHandler,
  UserAttachmentImageSrcResolver,
} from "../src/thread-timeline/types.js";

interface BaseRowArgs {
  id: string;
  sourceSeqEnd?: number;
  sourceSeqStart: number;
}

interface CommandRowArgs {
  id: string;
  command: string;
  activityIntents?: TimelineActivityIntent[];
  output?: string;
  sourceSeqEnd?: number;
  sourceSeqStart?: number;
  status?: TimelineRowStatus;
}

interface ConversationRowArgs {
  attachments?: TimelineConversationAttachments | null;
  id?: string;
  role?: TimelineConversationRow["role"];
  text: string;
  userRequest?: TimelineConversationUserRequest;
}

interface FileChangeRowArgs {
  diff?: string;
  diffStats?: {
    added: number;
    removed: number;
  };
  id?: string;
  kind?: string;
  path?: string;
  stderr?: string | null;
  stdout?: string | null;
}

interface ToolRowArgs {
  activityIntents?: TimelineActivityIntent[];
  id?: string;
  label?: string;
  output?: string;
  status?: TimelineRowStatus;
  toolArgs?: TimelineToolWorkRow["toolArgs"];
  toolName?: string;
}

type ElementScrollMetricName = "clientHeight" | "scrollHeight";

function baseRow({
  id,
  sourceSeqEnd,
  sourceSeqStart,
}: BaseRowArgs): TimelineRowBase {
  return {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart,
    sourceSeqEnd: sourceSeqEnd ?? sourceSeqStart,
    startedAt: sourceSeqStart,
    createdAt: sourceSeqStart,
  };
}

function conversationRow({
  attachments = null,
  id = "conversation-1",
  role = "assistant",
  text,
  userRequest,
}: ConversationRowArgs): TimelineConversationRow {
  return role === "user"
    ? {
        ...baseRow({ id, sourceSeqStart: 1 }),
        kind: "conversation",
        role,
        text,
        attachments,
        userRequest: userRequest ?? { kind: "message", status: "accepted" },
      }
    : {
        ...baseRow({ id, sourceSeqStart: 1 }),
        kind: "conversation",
        role,
        text,
        attachments,
        userRequest: null,
      };
}

function commandRow({
  activityIntents = [],
  command,
  id,
  output = "",
  sourceSeqEnd,
  sourceSeqStart = 1,
  status = "completed",
}: CommandRowArgs): TimelineCommandWorkRow {
  return {
    ...baseRow({
      id,
      sourceSeqEnd: sourceSeqEnd ?? sourceSeqStart,
      sourceSeqStart,
    }),
    kind: "work",
    workKind: "command",
    status,
    callId: id,
    command,
    cwd: null,
    source: null,
    output,
    exitCode: status === "completed" ? 0 : null,
    durationMs: 2_000,
    approvalStatus: null,
    activityIntents,
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

function webSearchRow(): TimelineWebSearchWorkRow {
  return {
    ...baseRow({ id: "web-search-1", sourceSeqStart: 1 }),
    kind: "work",
    workKind: "web-search",
    status: "completed",
    callId: "web-search-1",
    queries: ["timeline renderer"],
  };
}

function fileChangeRow({
  diff = "@@ -1 +1 @@\n-before\n+after",
  diffStats = {
    added: 1,
    removed: 1,
  },
  id = "file-change-1",
  kind = "update",
  path = "src/app.ts",
  stderr = null,
  stdout = "applied",
}: FileChangeRowArgs = {}): TimelineFileChangeWorkRow {
  return {
    ...baseRow({ id, sourceSeqStart: 1 }),
    kind: "work",
    workKind: "file-change",
    status: "completed",
    callId: id,
    change: {
      path,
      kind,
      movePath: null,
      diff,
      diffStats,
    },
    stdout,
    stderr,
    approvalStatus: null,
  };
}

function toolRow({
  activityIntents = [],
  id = "tool-1",
  label = "Read /repo/src/app.ts",
  output = "",
  status = "completed",
  toolArgs = null,
  toolName = "Read",
}: ToolRowArgs = {}): TimelineToolWorkRow {
  return {
    ...baseRow({ id, sourceSeqStart: 1 }),
    kind: "work",
    workKind: "tool",
    status,
    callId: id,
    toolName,
    toolArgs,
    label,
    output,
    durationMs: 2_000,
    approvalStatus: null,
    activityIntents,
  };
}

function delegationRow(): TimelineDelegationWorkRow {
  return {
    ...baseRow({ id: "delegation-1", sourceSeqStart: 1 }),
    kind: "work",
    workKind: "delegation",
    status: "completed",
    callId: "delegation-1",
    toolName: "spawnAgent",
    subagentType: "general-purpose",
    description: "Review renderer",
    output: "Final subagent answer.",
    durationMs: 2_000,
    childRows: [
      commandRow({
        id: "delegation-child-command-1",
        command: "rg timeline packages/ui-core",
        sourceSeqStart: 2,
      }),
    ],
  };
}

function systemRow(
  detail = "Running setup\nProvisioned thread (2s)",
): TimelineSystemRow {
  return {
    ...baseRow({ id: "system-1", sourceSeqStart: 1 }),
    kind: "system",
    systemKind: "operation",
    title: "Provisioned thread",
    detail,
    status: "completed",
  };
}

function webFetchRow(): TimelineWebFetchWorkRow {
  return {
    ...baseRow({ id: "web-fetch-1", sourceSeqStart: 2 }),
    kind: "work",
    workKind: "web-fetch",
    status: "completed",
    callId: "web-fetch-1",
    url: "https://example.com/docs",
    prompt: null,
    pattern: null,
  };
}

function turnRow(): TimelineTurnRow {
  return {
    ...baseRow({ id: "turn-summary-1", sourceSeqStart: 10 }),
    kind: "turn",
    status: "completed",
    summaryCount: 1,
    durationMs: 4_000,
    children: null,
  };
}

function renderRowsToStaticMarkup(timelineRows: TimelineRow[]): string {
  return renderToStaticMarkup(
    <ThreadTimelineRows
      loadingTurnSummaryIds={new Set()}
      erroredTurnSummaryIds={new Set()}
      onLoadTurnSummaryRows={() => {}}
      timelineRows={timelineRows}
      threadRuntimeDisplayStatus="idle"
      turnSummaryRowsIdentity="test-view"
      turnSummaryRowsById={{}}
    />,
  );
}

function renderTimelineRows(timelineRows: TimelineRow[]) {
  return render(
    <ThreadTimelineRows
      loadingTurnSummaryIds={new Set()}
      erroredTurnSummaryIds={new Set()}
      onLoadTurnSummaryRows={() => {}}
      timelineRows={timelineRows}
      threadRuntimeDisplayStatus="idle"
      turnSummaryRowsIdentity="test-view"
      turnSummaryRowsById={{}}
    />,
  );
}

function restoreElementScrollMetric(
  name: ElementScrollMetricName,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(HTMLElement.prototype, name, descriptor);
    return;
  }
  delete HTMLElement.prototype[name];
}

function withElementScrollMetrics(run: () => void): void {
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return 1_000;
    },
  });

  try {
    run();
  } finally {
    restoreElementScrollMetric("clientHeight", originalClientHeight);
    restoreElementScrollMetric("scrollHeight", originalScrollHeight);
  }
}

afterEach(() => {
  cleanup();
});

describe("ThreadTimelineRows", () => {
  it("keeps same-props timeline rerenders from re-resolving attachment image sources", () => {
    const erroredTurnSummaryIds = new Set<string>();
    const loadingTurnSummaryIds = new Set<string>();
    const onLoadTurnSummaryRows = () => {};
    const resolveUserAttachmentImageSrc =
      vi.fn<UserAttachmentImageSrcResolver>(
        (path, projectId) => `/attachments/${projectId}${path}`,
      );
    const timelineRows = [
      conversationRow({
        role: "user",
        text: "Attached.",
        attachments: {
          webImages: 0,
          localImages: 1,
          localFiles: 0,
          imageUrls: [],
          localImagePaths: ["/workspace/shot.png"],
          localFilePaths: [],
        },
      }),
    ];
    const turnSummaryRowsById = {};

    const view = render(
      <ThreadTimelineRows
        erroredTurnSummaryIds={erroredTurnSummaryIds}
        loadingTurnSummaryIds={loadingTurnSummaryIds}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        projectId="project-1"
        resolveUserAttachmentImageSrc={resolveUserAttachmentImageSrc}
        timelineRows={timelineRows}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={turnSummaryRowsById}
      />,
    );
    expect(resolveUserAttachmentImageSrc).toHaveBeenCalledTimes(1);

    view.rerender(
      <ThreadTimelineRows
        erroredTurnSummaryIds={erroredTurnSummaryIds}
        loadingTurnSummaryIds={loadingTurnSummaryIds}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        projectId="project-1"
        resolveUserAttachmentImageSrc={resolveUserAttachmentImageSrc}
        timelineRows={timelineRows}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={turnSummaryRowsById}
      />,
    );

    expect(resolveUserAttachmentImageSrc).toHaveBeenCalledTimes(1);
  });

  it("keeps completed activity summaries in past tense in an active scope", () => {
    const html = renderToStaticMarkup(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "read-1",
            command: "cat src/app.ts",
            activityIntents: [readIntent("src/app.ts")],
            sourceSeqStart: 1,
          }),
          commandRow({
            id: "read-2",
            command: "cat src/other.ts",
            activityIntents: [readIntent("src/other.ts")],
            sourceSeqStart: 2,
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(html).toContain("Explored");
    expect(html).not.toContain("Exploring");
    expect(html).toContain("2 files");
  });

  it("uses active wording for pending tail activity summaries in an active scope", () => {
    const html = renderToStaticMarkup(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-pending-1",
            command: "pnpm test",
            sourceSeqStart: 1,
            status: "pending",
          }),
          commandRow({
            id: "command-pending-2",
            command: "pnpm lint",
            sourceSeqStart: 2,
            status: "pending",
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(html).toContain("Running");
    expect(html).toContain("2 commands");
  });

  it("renders activity summary exploration details as compact static rows", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "exploration-1",
            command: "cat src/app.ts && rg TODO src",
            activityIntents: [
              readIntent("src/app.ts"),
              searchIntent("TODO", "src"),
            ],
            output: "large file contents",
            sourceSeqStart: 1,
          }),
          commandRow({
            id: "exploration-2",
            command: "rg FIXME src",
            activityIntents: [searchIntent("FIXME", "src")],
            output: "more large output",
            sourceSeqStart: 2,
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button"));

    expect(
      view.container.querySelector('[aria-label="Read src/app.ts"]'),
    ).not.toBeNull();
    expect(view.container.textContent ?? "").not.toContain("Read src/app.ts");
    expect(
      view.container.querySelector('[aria-label="Searched for TODO in src"]'),
    ).not.toBeNull();
    expect(view.container.textContent ?? "").not.toContain("$ cat src/app.ts");
    expect(view.container.textContent ?? "").not.toContain(
      "large file contents",
    );
    expect(view.container.textContent ?? "").not.toContain("more large output");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders delegation child progress and final output when both are present", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[delegationRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(view.container.textContent ?? "").not.toContain(
      "Final subagent answer.",
    );

    fireEvent.click(screen.getByRole("button", { name: /Ran subagent:/u }));
    expect(view.container.textContent ?? "").toContain("Final subagent answer.");

    fireEvent.click(
      screen.getByRole("button", {
        name: /Ran\s+rg timeline packages\/ui-core/u,
      }),
    );

    expect(view.container.textContent ?? "").toContain(
      "rg timeline packages/ui-core",
    );
  });

  it("does not render web search and fetch leaves as expandable rows", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[webSearchRow(), webFetchRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button"));

    expect(view.container.textContent ?? "").toContain("Ran web search:");
    expect(view.container.textContent ?? "").toContain("Fetched:");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("style contract: renders top-level timeline rows with a visible list gap", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          conversationRow({ id: "assistant-1", text: "Done." }),
          commandRow({
            id: "command-1",
            command: "pnpm test",
            sourceSeqStart: 2,
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const topLevelList = view.container.querySelector(
      '[data-timeline-row-list="top-level"]',
    );
    expect(topLevelList).not.toBeNull();
    expect(topLevelList?.classList.contains("gap-1")).toBe(true);
    expect(topLevelList?.classList.contains("gap-0.5")).toBe(false);
  });

  it("style contract: adds bottom padding to non-user rows but not user message rows", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          conversationRow({ id: "assistant-1", text: "Done." }),
          conversationRow({
            id: "user-1",
            role: "user",
            text: "Please patch this.",
          }),
          commandRow({
            id: "command-1",
            command: "pnpm test",
            sourceSeqStart: 3,
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const topLevelList = view.container.querySelector(
      '[data-timeline-row-list="top-level"]',
    );
    const topLevelRows = Array.from(topLevelList?.children ?? []);

    expect(topLevelRows).toHaveLength(3);
    expect(topLevelRows[0]?.classList.contains("pb-2")).toBe(true);
    expect(topLevelRows[1]?.classList.contains("pb-2")).toBe(false);
    expect(topLevelRows[2]?.classList.contains("pb-2")).toBe(true);
  });

  it("style contract: does not add bottom padding to nested rows", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{
          "turn-summary-1": [
            commandRow({
              id: "nested-command-1",
              command: "pnpm test",
              sourceSeqStart: 11,
            }),
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Worked for\s*4s/u }));

    const nestedList = view.container.querySelector(
      '[data-timeline-row-list="nested"]',
    );
    const nestedRows = Array.from(nestedList?.children ?? []);

    expect(nestedRows.length).toBeGreaterThan(0);
    expect(nestedRows.some((row) => row.classList.contains("pb-2"))).toBe(
      false,
    );
  });

  it("style contract: renders rows inside activity summaries with no list gap", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-1",
            command: "pnpm test",
            sourceSeqStart: 1,
          }),
          commandRow({
            id: "command-2",
            command: "pnpm lint",
            sourceSeqStart: 2,
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ran 2 commands/u }));

    const bundleList = view.container.querySelector(
      '[data-timeline-row-list="bundle"]',
    );
    expect(bundleList).not.toBeNull();
    expect(bundleList?.classList.contains("gap-0")).toBe(true);
    expect(bundleList?.classList.contains("gap-0.5")).toBe(false);
    expect(
      Array.from(bundleList?.children ?? []).some((child) =>
        child.classList.contains("pb-2"),
      ),
    ).toBe(false);

    const bundledCommandButton = screen.getByRole("button", {
      name: /Ran\s+pnpm test\s+2s/u,
    });
    expect(bundledCommandButton.classList.contains("px-0")).toBe(true);
    expect(bundledCommandButton.classList.contains("px-2")).toBe(false);
  });

  it("groups completed work once a second completed row appends to the run", () => {
    const firstCommand = commandRow({
      id: "command-1",
      command: "pnpm test",
      sourceSeqStart: 1,
    });
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[firstCommand]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const directCommandButton = screen.getByRole("button", {
      name: /Ran\s+pnpm test\s+2s/u,
    });

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          firstCommand,
          commandRow({
            id: "command-2",
            command: "pnpm lint",
            sourceSeqStart: 2,
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(screen.queryByRole("button", { name: /Ran\s+pnpm test\s+2s/u }))
      .not.toBe(directCommandButton);
    expect(screen.getByRole("button", { name: /Ran 2 commands/u })).toBeTruthy();
  });

  it("style contract: uses flush horizontal padding for static title rows inside activity summaries", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[webSearchRow(), webFetchRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ran 1 web search/u }));

    const staticTitle = view.container.querySelector(
      '[aria-label="Ran web search: timeline renderer"]',
    );
    const staticHeader = staticTitle?.closest(".timeline-row-header");
    expect(staticTitle).not.toBeNull();
    expect(staticHeader?.classList.contains("px-0")).toBe(true);
    expect(staticHeader?.classList.contains("px-2")).toBe(false);
  });

  it("loads lazy turn details once for one expansion", () => {
    const onLoadTurnSummaryRows = vi.fn();
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(onLoadTurnSummaryRows).toHaveBeenCalledTimes(1);

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(onLoadTurnSummaryRows).toHaveBeenCalledTimes(1);
  });

  it("retries lazy turn details from the error state", () => {
    const onLoadTurnSummaryRows = vi.fn();
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button"));
    expect(onLoadTurnSummaryRows).toHaveBeenCalledTimes(1);

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set(["turn-summary-1"])}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(view.container.textContent ?? "").toContain(
      "Failed to load turn details.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onLoadTurnSummaryRows).toHaveBeenCalledTimes(2);
  });

  it("reloads lazy turn details after the loaded-row identity changes", () => {
    const onLoadTurnSummaryRows = vi.fn();
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="thread-1:conversation"
        turnSummaryRowsById={{}}
      />,
    );

    const turnButton = screen.getByRole("button", {
      name: /Worked for\s*4s/u,
    });
    fireEvent.click(turnButton);
    expect(onLoadTurnSummaryRows).toHaveBeenCalledTimes(1);

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="thread-1:conversation"
        turnSummaryRowsById={{
          "turn-summary-1": [
            conversationRow({
              id: "conversation-detail-1",
              text: "Conversation view details",
            }),
          ],
        }}
      />,
    );
    expect(view.container.textContent ?? "").toContain(
      "Conversation view details",
    );

    fireEvent.click(turnButton);
    expect(turnButton.getAttribute("aria-expanded")).toBe("false");

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="thread-1:standard"
        turnSummaryRowsById={{}}
      />,
    );

    const standardTurnButton = screen.getByRole("button", {
      name: /Worked for\s*4s/u,
    });
    fireEvent.click(standardTurnButton);
    expect(onLoadTurnSummaryRows).toHaveBeenCalledTimes(2);
    expect(view.container.textContent ?? "").toContain(
      "Loading turn details...",
    );

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={onLoadTurnSummaryRows}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="thread-1:standard"
        turnSummaryRowsById={{
          "turn-summary-1": [
            conversationRow({
              id: "standard-detail-1",
              text: "Standard view details",
            }),
          ],
        }}
      />,
    );
    expect(view.container.textContent ?? "").toContain("Standard view details");
    expect(view.container.textContent ?? "").not.toContain(
      "Loading turn details...",
    );
  });

  it("hides command detail until the row is expanded", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-1",
            command: "true",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(view.container.textContent ?? "").toContain("Ran");
    expect(screen.queryByRole("button", { name: /Ran 1 command/u })).toBeNull();
    expect(view.container.textContent ?? "").not.toContain("$ true");

    fireEvent.click(screen.getByRole("button", { name: /Ran\s+true/u }));

    expect(view.container.textContent ?? "").toContain("$ true");
    expect(view.container.textContent ?? "").toContain("exit code 0");
  });

  it("renders expanded tool details as labeled content", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          toolRow({
            id: "tool-detail-1",
            label: "LookupTool select:TodoWrite",
            output: "Matched tools: TodoWrite",
            toolArgs: { query: "select:TodoWrite" },
            toolName: "LookupTool",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Ran tool:\s+LookupTool/u }),
    );

    const text = view.container.textContent ?? "";
    expect(text).toContain("Tool: LookupTool");
    expect(text).toContain("Arguments");
    expect(text).toContain('"query": "select:TodoWrite"');
    expect(text).toContain("Output");
    expect(text).toContain("Matched tools: TodoWrite");
  });

  it("updates expanded pending command output when source sequence advances", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-streaming-1",
            command: "pnpm test",
            output: "first chunk",
            sourceSeqEnd: 1,
            sourceSeqStart: 1,
            status: "pending",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Running\s+pnpm test/u }),
    );

    expect(view.container.textContent ?? "").toContain("first chunk");

    view.rerender(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-streaming-1",
            command: "pnpm test",
            output: "second chunk",
            sourceSeqEnd: 2,
            sourceSeqStart: 1,
            status: "pending",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(view.container.textContent ?? "").toContain("second chunk");
    expect(view.container.textContent ?? "").not.toContain("first chunk");
  });

  it("renders error command summaries with neutral status metadata", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-error-1",
            command: "pnpm test",
            status: "error",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const summaryButton = screen.getByRole("button", {
      name: /Ran 1 command \(error\)/u,
    });

    fireEvent.click(summaryButton);

    const button = screen.getByRole("button", {
      name: /Ran\s+pnpm test\s+2s/u,
    });
    expect(button.textContent ?? "").not.toContain("(error");
  });

  it("renders failed structured tools with intent titles and no error decorations", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          toolRow({
            activityIntents: [readIntent("/repo/src/app.ts")],
            output: "ENOENT: no such file or directory",
            status: "error",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const summaryButton = screen.getByRole("button", {
      name: /Explored 1 file \(error\)/u,
    });

    fireEvent.click(summaryButton);

    const button = screen.getByRole("button", {
      name: /Read\s+\/repo\/src\/app\.ts/u,
    });
    expect(button.textContent ?? "").not.toContain("Ran tool:");
    expect(button.textContent ?? "").not.toContain("(error");

    fireEvent.click(button);

    expect(view.container.textContent ?? "").toContain(
      "ENOENT: no such file or directory",
    );
  });

  it("does not auto-expand error command details", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-error-1",
            command: "pnpm test",
            output: "test failure",
            status: "error",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const summaryButton = screen.getByRole("button", {
      name: /Ran 1 command/u,
    });
    expect(summaryButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.textContent ?? "").not.toContain("test failure");

    fireEvent.click(summaryButton);
    const commandButton = screen.getByRole("button", {
      name: /Ran\s+pnpm test/u,
    });
    expect(commandButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.textContent ?? "").not.toContain("test failure");
  });

  it("auto-expands pending single work rows in an active turn", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-pending-1",
            command: "pnpm test",
            output: "still running",
            status: "pending",
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const commandButton = screen.getByRole("button", {
      name: /Running\s+pnpm test\s+2s/u,
    });
    expect(commandButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("still running");
  });

  it("auto-expands pending work summarized by an active bundle", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-pending-1",
            command: "pnpm test",
            output: "first output",
            sourceSeqStart: 1,
            status: "pending",
          }),
          commandRow({
            id: "command-pending-2",
            command: "pnpm lint",
            output: "second output",
            sourceSeqStart: 2,
            status: "pending",
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const bundleButton = screen.getByRole("button", {
      name: /Running 2 commands/u,
    });
    expect(bundleButton.getAttribute("aria-expanded")).toBe("true");

    const commandButton = screen.getByRole("button", {
      name: /Running\s+pnpm test/u,
    });
    expect(commandButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("first output");
    expect(view.container.textContent ?? "").toContain("second output");
  });

  it("auto-expands pending summaries when a pending steer is the trailing row", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-pending-1",
            command: "pnpm test",
            output: "first output",
            sourceSeqStart: 1,
            status: "pending",
          }),
          commandRow({
            id: "command-pending-2",
            command: "pnpm lint",
            output: "second output",
            sourceSeqStart: 2,
            status: "pending",
          }),
          conversationRow({
            id: "pending-steer-1",
            role: "user",
            text: "Keep this in mind",
            userRequest: { kind: "steer", status: "pending" },
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const bundleButton = screen.getByRole("button", {
      name: /Running 2 commands/u,
    });
    expect(bundleButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("first output");
    expect(view.container.textContent ?? "").toContain("second output");
    expect(screen.getByText("steer pending")).toBeTruthy();
  });

  it("auto-expands pending summaries even when completed work follows", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-pending-1",
            command: "pnpm test",
            output: "first still running",
            sourceSeqStart: 1,
            status: "pending",
          }),
          commandRow({
            id: "command-pending-2",
            command: "pnpm lint",
            output: "second still running",
            sourceSeqStart: 2,
            status: "pending",
          }),
          commandRow({
            id: "command-completed-1",
            command: "date",
            output: "today",
            sourceSeqStart: 3,
            status: "completed",
          }),
          commandRow({
            id: "command-completed-2",
            command: "pwd",
            output: "/repo",
            sourceSeqStart: 4,
            status: "completed",
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const pendingBundleButton = screen.getByRole("button", {
      name: /Running 2 commands/u,
    });
    expect(pendingBundleButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("first still running");
    expect(view.container.textContent ?? "").toContain("second still running");

    const completedBundleButton = screen.getByRole("button", {
      name: /Ran 2 commands/u,
    });
    expect(completedBundleButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.textContent ?? "").not.toContain("today");
    expect(view.container.textContent ?? "").not.toContain("/repo");
  });

  it("omits command cwd metadata and mutes exit code detail", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          {
            ...commandRow({
              id: "command-detail-1",
              command: "pwd",
            }),
            cwd: "/repo",
            output: "done",
          },
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ran\s+pwd/u }));

    expect(view.container.textContent ?? "").not.toContain("cwd:");
    expect(view.container.textContent ?? "").toContain("exit code 0");
  });

  it("renders ANSI command output without leaking escape codes", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          commandRow({
            id: "command-ansi-1",
            command: "printf color",
            output: "\u001b[31mred\u001b[0m",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ran\s+printf color/u }));

    expect(view.container.textContent ?? "").toContain("red");
    expect(view.container.textContent ?? "").not.toContain("\u001b");
  });

  it("hides file diff detail until the row is expanded", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[fileChangeRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(view.container.textContent ?? "").toContain("Edited");
    expect(view.container.querySelector("[data-timeline-file-diff]")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /Edited\s+src\/app\.ts/u }),
    );

    expect(
      view.container.querySelector("[data-timeline-file-diff]"),
    ).not.toBeNull();
    expect(view.container.textContent ?? "").not.toContain("applied");
  });

  it("style contract: mutes completed single file change title diff stats", () => {
    const html = renderToStaticMarkup(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[fileChangeRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(html).toContain("+1");
    expect(html).toContain("-1");
    expect(html).not.toContain("text-diff-added");
    expect(html).not.toContain("text-diff-removed");
  });

  it("renders file-change stderr without rendering stdout below diffs", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          fileChangeRow({
            stdout: "Success. Updated the following files:\nM src/app.ts",
            stderr: "patch failed",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Edited\s+src\/app\.ts/u }),
    );

    expect(view.container.textContent ?? "").not.toContain(
      "Success. Updated the following files:",
    );
    expect(view.container.textContent ?? "").toContain("patch failed");
  });

  it("renders raw created-file diffs with the same diff viewer", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          fileChangeRow({
            id: "created-file-change-1",
            kind: "add",
            path: "src/new-file.ts",
            diff: "first line\nsecond line\n",
            diffStats: {
              added: 2,
              removed: 0,
            },
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Created\s+src\/new-file\.ts\s+\+2/u,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Created\s+src\/new-file\.ts\s+\+2/u,
      }),
    );

    expect(
      view.container.querySelector("[data-timeline-file-diff]"),
    ).not.toBeNull();
    expect(view.container.textContent ?? "").not.toContain("No diff available");
  });

  it("renders assistant conversation rows without a role label", () => {
    const html = renderRowsToStaticMarkup([conversationRow({ text: "Done." })]);

    expect(html).not.toContain("Assistant");
    expect(html).toContain("Done.");
  });

  it("style contract: renders user conversation rows as a right-aligned message bubble", () => {
    const html = renderRowsToStaticMarkup([
      conversationRow({ role: "user", text: "Please patch this." }),
    ]);

    expect(html).not.toContain("User");
    expect(html).toContain("group mt-2 w-full");
    expect(html).toContain("ml-auto w-fit max-w-[80%]");
    expect(html).toContain("bg-primary/10");
    expect(html).toContain("Please patch this.");
  });

  it("renders accepted steer metadata below the user message bubble", () => {
    renderTimelineRows([
      conversationRow({
        role: "user",
        text: "Use the existing renderer.",
        userRequest: { kind: "steer", status: "accepted" },
      }),
    ]);

    expect(screen.getByText("Use the existing renderer.")).toBeTruthy();
    expect(screen.getByText("steer")).toBeTruthy();
  });

  it("renders pending steer metadata below the user message bubble", () => {
    renderTimelineRows([
      conversationRow({
        role: "user",
        text: "Still apply this steer.",
        userRequest: { kind: "steer", status: "pending" },
      }),
    ]);

    expect(screen.getByText("Still apply this steer.")).toBeTruthy();
    expect(screen.getByText("steer pending")).toBeTruthy();
  });

  it("style contract: puts top spacing on user messages instead of every timeline row", () => {
    const html = renderRowsToStaticMarkup([
      conversationRow({ id: "assistant-1", text: "Before." }),
      conversationRow({
        id: "user-1",
        role: "user",
        text: "Please patch this.",
      }),
    ]);

    expect(html).not.toContain('class="pt-1"');
    expect(html).toContain("group mt-2 w-full");
  });

  it("renders assistant markdown with the custom timeline markdown styling", () => {
    const html = renderRowsToStaticMarkup([
      conversationRow({
        text: [
          "Here is code:",
          "",
          "```ts",
          "const value = 1;",
          "const next = value + 1;",
          "```",
        ].join("\n"),
      }),
    ]);

    expect(html).not.toContain("Assistant");
    expect(html).toContain("Copy code");
    expect(html).toContain("border border-border/70 bg-muted/35");
    expect(html).toContain("language-ts");
  });

  it("keeps nested lazy-loaded bundles expandable", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[turnRow()]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{
          "turn-summary-1": [
            commandRow({
              id: "command-1",
              command: "echo one",
              sourceSeqStart: 11,
            }),
            commandRow({
              id: "command-2",
              command: "echo two",
              sourceSeqStart: 12,
            }),
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Worked for\s*4s/u }));

    const bundleButton = screen.getByRole("button", {
      name: /Ran 2 commands/u,
    });
    expect(bundleButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.textContent ?? "").not.toContain("echo one");

    fireEvent.click(bundleButton);

    expect(bundleButton.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent ?? "").toContain("echo one");
    expect(view.container.textContent ?? "").toContain("echo two");
  });

  it("does not auto-expand lazy turn children when the runtime scope is idle", () => {
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[
          {
            ...turnRow(),
            status: "pending",
          },
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{
          "turn-summary-1": [
            commandRow({
              id: "nested-pending-command-1",
              command: "pnpm test",
              output: "still running",
              sourceSeqStart: 11,
              status: "pending",
            }),
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Working for\s*4s/u }));

    const nestedCommandButton = screen.getByRole("button", {
      name: /Running\s+pnpm test/u,
    });
    expect(nestedCommandButton.getAttribute("aria-expanded")).toBe("false");
    expect(view.container.textContent ?? "").not.toContain("still running");
  });

  it("renders system rows with detail as expandable", () => {
    withElementScrollMetrics(() => {
      const view = render(
        <ThreadTimelineRows
          loadingTurnSummaryIds={new Set()}
          erroredTurnSummaryIds={new Set()}
          onLoadTurnSummaryRows={() => {}}
          timelineRows={[systemRow()]}
          threadRuntimeDisplayStatus="idle"
          turnSummaryRowsIdentity="test-view"
          turnSummaryRowsById={{}}
        />,
      );

      const systemButton = screen.getByRole("button", {
        name: /Provisioned thread/u,
      });
      expect(systemButton.getAttribute("aria-expanded")).toBe("false");
      expect(view.container.textContent ?? "").not.toContain("Running setup");

      fireEvent.click(systemButton);

      expect(systemButton.getAttribute("aria-expanded")).toBe("true");
      expect(view.container.textContent ?? "").toContain("Running setup");
      const detail = view.container.querySelector("pre");
      expect(detail?.className).toContain("whitespace-pre");
      expect(detail?.className).not.toContain("whitespace-pre-wrap");
      expect(detail?.scrollTop).toBe(900);
    });
  });

  it("uses destructive detail tone for failed system operations", () => {
    const failedOperationRow = {
      ...systemRow("Release command failed"),
      title: "Thread release failed",
      status: "error",
    } satisfies TimelineSystemRow;
    const view = render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        timelineRows={[failedOperationRow]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Thread release failed/u }),
    );

    const detail = view.container.querySelector("pre");
    expect(detail?.textContent).toBe("Release command failed");
    expect(detail?.className).toContain("text-destructive");
  });

  it("keeps expanded system details pinned unless the user scrolls up", () => {
    withElementScrollMetrics(() => {
      const view = render(
        <ThreadTimelineRows
          loadingTurnSummaryIds={new Set()}
          erroredTurnSummaryIds={new Set()}
          onLoadTurnSummaryRows={() => {}}
          timelineRows={[systemRow("first\nsecond")]}
          threadRuntimeDisplayStatus="idle"
          turnSummaryRowsIdentity="test-view"
          turnSummaryRowsById={{}}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: /Provisioned thread/u }),
      );
      const detail = view.container.querySelector("pre");
      expect(detail?.scrollTop).toBe(900);

      if (!detail) {
        throw new Error("Expected system detail to render");
      }

      detail.scrollTop = 500;
      fireEvent.scroll(detail);
      view.rerender(
        <ThreadTimelineRows
          loadingTurnSummaryIds={new Set()}
          erroredTurnSummaryIds={new Set()}
          onLoadTurnSummaryRows={() => {}}
          timelineRows={[systemRow("first\nsecond\nthird")]}
          threadRuntimeDisplayStatus="idle"
          turnSummaryRowsIdentity="test-view"
          turnSummaryRowsById={{}}
        />,
      );
      expect(detail.scrollTop).toBe(900);

      detail.scrollTop = 500;
      fireEvent.wheel(detail);
      fireEvent.scroll(detail);
      view.rerender(
        <ThreadTimelineRows
          loadingTurnSummaryIds={new Set()}
          erroredTurnSummaryIds={new Set()}
          onLoadTurnSummaryRows={() => {}}
          timelineRows={[systemRow("first\nsecond\nthird\nfourth")]}
          threadRuntimeDisplayStatus="idle"
          turnSummaryRowsIdentity="test-view"
          turnSummaryRowsById={{}}
        />,
      );
      expect(detail.scrollTop).toBe(500);
    });
  });

  it("routes markdown local file links through the timeline handler", () => {
    const onOpenLocalFileLink =
      vi.fn<ThreadTimelineLocalFileLinkHandler>(() => true);

    render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        onOpenLocalFileLink={onOpenLocalFileLink}
        timelineRows={[
          conversationRow({
            text: "[Open file](/workspace/src/app.ts:7)",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open file" }));

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: 7,
      path: "/workspace/src/app.ts",
    });
  });

  it("renders user attachments and routes file attachment clicks", () => {
    const onOpenLocalFileLink =
      vi.fn<ThreadTimelineLocalFileLinkHandler>(() => true);
    const resolveUserAttachmentImageSrc: UserAttachmentImageSrcResolver = (
      path,
      projectId,
    ) => `/attachments/${projectId}${path}`;

    render(
      <ThreadTimelineRows
        loadingTurnSummaryIds={new Set()}
        erroredTurnSummaryIds={new Set()}
        onLoadTurnSummaryRows={() => {}}
        onOpenLocalFileLink={onOpenLocalFileLink}
        projectId="project-1"
        resolveUserAttachmentImageSrc={resolveUserAttachmentImageSrc}
        timelineRows={[
          conversationRow({
            role: "user",
            text: "Attached.",
            attachments: {
              webImages: 0,
              localImages: 1,
              localFiles: 1,
              imageUrls: [],
              localImagePaths: ["/workspace/shot.png"],
              localFilePaths: ["/workspace/notes.md"],
            },
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        turnSummaryRowsIdentity="test-view"
        turnSummaryRowsById={{}}
      />,
    );

    const image = screen.getByRole("img", { name: "shot.png" });
    expect(image.getAttribute("src")).toBe(
      "/attachments/project-1/workspace/shot.png",
    );

    fireEvent.click(screen.getByRole("button", { name: "notes.md" }));

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: null,
      path: "/workspace/notes.md",
    });
  });
});
