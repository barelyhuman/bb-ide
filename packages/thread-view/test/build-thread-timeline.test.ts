import { threadScope, turnScope } from "@bb/domain";
import type {
  JsonObject,
  OwnershipChangeOperationAction,
  ThreadEventFileChange,
  ThreadEventItemStatus,
} from "@bb/domain";
import type {
  ThreadContextWindowUsage,
  TimelineFileChangeWorkRow,
  TimelineRow,
  TimelineSystemRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { parseOperationMessage } from "../src/parse-operation-message.js";

interface ContextWindowUsageEventArgs {
  estimated: boolean;
  modelContextWindow: number | null;
  seq: number;
  usedTokens: number | null;
}

interface FileChangeItemEventArgs {
  changes: ThreadEventFileChange[];
  itemId?: string;
  seq: number;
  status?: ThreadEventItemStatus;
  type: "item/completed" | "item/started";
}

interface ToolCallItemEventArgs {
  itemId?: string;
  result?: string;
  seq: number;
  status?: ThreadEventItemStatus;
  tool: string;
  toolArgs?: JsonObject;
  type: "item/completed" | "item/started";
}

interface TurnStartedEventArgs {
  seq: number;
}

interface SystemOperationEventArgs {
  message: string;
  metadata?: JsonObject;
  operation?: string;
  operationId?: string;
  seq: number;
  status?: "running" | "completed" | "failed";
}

interface OwnershipOperationCase {
  action: OwnershipChangeOperationAction;
  message: string;
  nextParentThreadId: string | null;
  previousParentThreadId: string | null;
}

const ownershipOperationCases: OwnershipOperationCase[] = [
  {
    action: "assign",
    message: "Thread assigned to manager",
    nextParentThreadId: "thr-manager",
    previousParentThreadId: null,
  },
  {
    action: "release",
    message: "Thread released from manager",
    nextParentThreadId: null,
    previousParentThreadId: "thr-manager",
  },
  {
    action: "transfer",
    message: "Thread transferred to new manager",
    nextParentThreadId: "thr-manager-next",
    previousParentThreadId: "thr-manager-previous",
  },
];

function contextWindowUsageEvent({
  estimated,
  modelContextWindow,
  seq,
  usedTokens,
}: ContextWindowUsageEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "thread/contextWindowUsage/updated",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope(`turn-${seq}`),
      contextWindowUsage: {
        estimated,
        modelContextWindow,
        usedTokens,
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function fileChangeItemEvent({
  changes,
  itemId = "file-edit-1",
  seq,
  status,
  type,
}: FileChangeItemEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "fileChange",
        id: itemId,
        changes,
        status: status ?? (type === "item/completed" ? "completed" : "pending"),
        approvalStatus: null,
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function toolCallItemEvent({
  itemId = "tool-call-1",
  result,
  seq,
  status,
  tool,
  toolArgs,
  type,
}: ToolCallItemEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id: itemId,
        tool,
        ...(toolArgs ? { arguments: toolArgs } : {}),
        status: status ?? (type === "item/completed" ? "completed" : "pending"),
        ...(result ? { result } : {}),
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function turnStartedEvent({ seq }: TurnStartedEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function systemOperationEvent({
  message,
  metadata,
  operation = "ownership_change",
  operationId = "operation-1",
  seq,
  status = "completed",
}: SystemOperationEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/operation",
      threadId: "thread-1",
      scope: threadScope(),
      message,
      operation,
      operationId,
      status,
      ...(metadata ? { metadata } : {}),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function buildContextWindowUsage(
  contextWindowEvents: ThreadEventWithMeta[],
): ThreadContextWindowUsage | null {
  return buildThreadTimelineFromEvents({
    contextWindowEvents,
    events: [],
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: false,
      includeOptionalOperations: false,
      includeProviderUnhandledOperations: false,
      systemClientRequestVisibility: "hidden",
      threadStatus: "idle",
      turnMessageDetail: "summary",
      viewMode: "standard",
    },
  }).contextWindowUsage;
}

function buildTimelineRows(events: ThreadEventWithMeta[]): TimelineRow[] {
  return buildThreadTimelineFromEvents({
    contextWindowEvents: [],
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeOptionalOperations: false,
      includeProviderUnhandledOperations: false,
      systemClientRequestVisibility: "hidden",
      threadStatus: "idle",
      turnMessageDetail: "full",
      viewMode: "standard",
    },
  }).rows;
}

function isFileChangeRow(row: TimelineRow): row is TimelineFileChangeWorkRow {
  return row.kind === "work" && row.workKind === "file-change";
}

function isToolRow(row: TimelineRow): row is TimelineToolWorkRow {
  return row.kind === "work" && row.workKind === "tool";
}

function collectFileChangeRows(
  rows: readonly TimelineRow[],
): TimelineFileChangeWorkRow[] {
  const fileChangeRows: TimelineFileChangeWorkRow[] = [];
  for (const row of rows) {
    if (isFileChangeRow(row)) {
      fileChangeRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      fileChangeRows.push(...collectFileChangeRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      fileChangeRows.push(...collectFileChangeRows(row.childRows));
    }
  }
  return fileChangeRows;
}

function collectToolRows(rows: readonly TimelineRow[]): TimelineToolWorkRow[] {
  const toolRows: TimelineToolWorkRow[] = [];
  for (const row of rows) {
    if (isToolRow(row)) {
      toolRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      toolRows.push(...collectToolRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      toolRows.push(...collectToolRows(row.childRows));
    }
  }
  return toolRows;
}

function collectSystemRows(rows: readonly TimelineRow[]): TimelineSystemRow[] {
  const systemRows: TimelineSystemRow[] = [];
  for (const row of rows) {
    if (row.kind === "system") {
      systemRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      systemRows.push(...collectSystemRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      systemRows.push(...collectSystemRows(row.childRows));
    }
  }
  return systemRows;
}

function fileChangeRowIdByPath(
  rows: readonly TimelineFileChangeWorkRow[],
): Record<string, string> {
  const idByPath: Record<string, string> = {};
  for (const row of rows) {
    idByPath[row.change.path] = row.id;
  }
  return idByPath;
}

describe("buildThreadTimelineFromEvents", () => {
  it.each(ownershipOperationCases)(
    "uses $action ownership metadata rather than event message for operation titles",
    ({ action, message, nextParentThreadId, previousParentThreadId }) => {
      const event = systemOperationEvent({
        message: "Ownership operation completed",
        metadata: {
          action,
          nextParentThreadId,
          previousParentThreadId,
        },
        seq: 1,
      });

      expect(parseOperationMessage(event.event, event.meta)).toMatchObject({
        kind: "operation",
        title: message,
      });
    },
  );

  it("uses a neutral completed ownership title for legacy metadata", () => {
    const event = systemOperationEvent({
      message: "Ownership operation completed",
      metadata: {
        action: "unknown-action",
        nextParentThreadId: null,
        previousParentThreadId: null,
      },
      seq: 1,
    });

    expect(parseOperationMessage(event.event, event.meta)).toMatchObject({
      kind: "operation",
      title: "Ownership change completed",
    });
  });

  it.each(ownershipOperationCases)(
    "does not duplicate $action ownership operation titles as row detail",
    ({ action, message, nextParentThreadId, previousParentThreadId }) => {
      const rows = buildTimelineRows([
        systemOperationEvent({
          message,
          metadata: {
            action,
            nextParentThreadId,
            previousParentThreadId,
          },
          seq: 1,
        }),
      ]);

      expect(collectSystemRows(rows)).toEqual([
        expect.objectContaining({
          detail: null,
          systemKind: "operation",
          title: message,
        }),
      ]);
    },
  );

  it("uses a neutral completed ownership title for invalid ownership actions", () => {
    const rows = buildTimelineRows([
      systemOperationEvent({
        message: "Thread ownership updated by migration",
        metadata: {
          action: "migrate",
          nextParentThreadId: "thr-manager",
          previousParentThreadId: null,
        },
        seq: 1,
      }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        detail: "Thread ownership updated by migration",
        systemKind: "operation",
        title: "Ownership change completed",
      }),
    ]);
  });

  it("suppresses low-value ToolSearch rows", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 0 }),
      toolCallItemEvent({
        seq: 1,
        tool: "ToolSearch",
        toolArgs: { query: "select:TodoWrite", max_results: 1 },
        type: "item/started",
      }),
      toolCallItemEvent({
        result: "Matched tools: TodoWrite",
        seq: 2,
        tool: "ToolSearch",
        toolArgs: { query: "select:TodoWrite", max_results: 1 },
        type: "item/completed",
      }),
    ]);

    expect(collectToolRows(rows)).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("Matched tools: TodoWrite");
  });

  it("extracts context-window usage from ordered events", () => {
    expect(
      buildContextWindowUsage([
        contextWindowUsageEvent({
          estimated: false,
          modelContextWindow: 200_000,
          seq: 1,
          usedTokens: 120,
        }),
        contextWindowUsageEvent({
          estimated: true,
          modelContextWindow: null,
          seq: 2,
          usedTokens: 60,
        }),
      ]),
    ).toEqual({
      estimated: true,
      modelContextWindow: 200_000,
      usedTokens: 60,
    });
  });

  it("extracts context-window usage from unordered events", () => {
    expect(
      buildContextWindowUsage([
        contextWindowUsageEvent({
          estimated: true,
          modelContextWindow: null,
          seq: 2,
          usedTokens: 60,
        }),
        contextWindowUsageEvent({
          estimated: false,
          modelContextWindow: 200_000,
          seq: 1,
          usedTokens: 120,
        }),
      ]),
    ).toEqual({
      estimated: true,
      modelContextWindow: 200_000,
      usedTokens: 60,
    });
  });

  it("keeps file-change row identity stable when provider changes reorder", () => {
    const initialChanges: ThreadEventFileChange[] = [
      {
        path: "src/a.ts",
        kind: "update",
        diff: "@@ -1 +1 @@\n-old a\n+new a",
      },
      {
        path: "src/b.ts",
        kind: "update",
        diff: "@@ -1 +1 @@\n-old b\n+new b",
      },
    ];
    const reorderedChanges = [initialChanges[1], initialChanges[0]].filter(
      (change): change is ThreadEventFileChange => Boolean(change),
    );
    const startedEvent = fileChangeItemEvent({
      changes: initialChanges,
      seq: 1,
      type: "item/started",
    });
    const turnStarted = turnStartedEvent({ seq: 0 });

    const initialRows = collectFileChangeRows(
      buildTimelineRows([turnStarted, startedEvent]),
    );
    const finalRows = collectFileChangeRows(
      buildTimelineRows([
        turnStarted,
        startedEvent,
        fileChangeItemEvent({
          changes: reorderedChanges,
          seq: 2,
          type: "item/completed",
        }),
      ]),
    );

    expect(fileChangeRowIdByPath(finalRows)).toEqual(
      fileChangeRowIdByPath(initialRows),
    );
  });

  it("drops stale file-change rows that are missing from later provider changes", () => {
    const startedEvent = fileChangeItemEvent({
      changes: [
        {
          path: "src/a.ts",
          kind: "update",
          diff: "@@ -1 +1 @@\n-old a\n+new a",
        },
        {
          path: "src/b.ts",
          kind: "update",
          diff: "@@ -1 +1 @@\n-old b\n+new b",
        },
      ],
      seq: 1,
      type: "item/started",
    });
    const turnStarted = turnStartedEvent({ seq: 0 });
    const finalRows = collectFileChangeRows(
      buildTimelineRows([
        turnStarted,
        startedEvent,
        fileChangeItemEvent({
          changes: [
            {
              path: "src/a.ts",
              kind: "update",
              diff: "@@ -1 +1 @@\n-old a\n+newer a",
            },
          ],
          seq: 2,
          type: "item/completed",
        }),
      ]),
    );

    expect(finalRows.map((row) => row.change.path)).toEqual(["src/a.ts"]);
  });

  it("keeps file-change row identity stable when movePath appears later", () => {
    const startedEvent = fileChangeItemEvent({
      changes: [
        {
          path: "src/old.ts",
          kind: "update",
          diff: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
      seq: 1,
      type: "item/started",
    });
    const turnStarted = turnStartedEvent({ seq: 0 });

    const initialRows = collectFileChangeRows(
      buildTimelineRows([turnStarted, startedEvent]),
    );
    const finalRows = collectFileChangeRows(
      buildTimelineRows([
        turnStarted,
        startedEvent,
        fileChangeItemEvent({
          changes: [
            {
              path: "src/old.ts",
              kind: "update",
              movePath: "src/new.ts",
              diff: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
          seq: 2,
          type: "item/completed",
        }),
      ]),
    );

    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]?.id).toBe(initialRows[0]?.id);
    expect(finalRows[0]?.change).toMatchObject({
      path: "src/old.ts",
      movePath: "src/new.ts",
    });
  });
});
