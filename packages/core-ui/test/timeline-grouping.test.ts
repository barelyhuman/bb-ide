import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import type {
  TimelineRow,
  ViewAssistantTextMessage,
  ViewCommandMessage,
  ViewProjection,
  ViewToolCallMessage,
  ViewToolParsedIntent,
  ViewTurn,
  ViewUserMessage,
} from "@bb/domain";
import {
  buildGroupedTimelineRows,
  formatTimelineAsText,
} from "../src/index.js";

type TimelineMessageRow = Extract<TimelineRow, { kind: "message" }>;
type TimelineToolBundleRow = Extract<TimelineRow, { kind: "tool-bundle" }>;
type TimelineTurnSummaryRow = Extract<TimelineRow, { kind: "turn-summary" }>;
type TimelineAssistantStepChildTestRow =
  | TimelineMessageRow
  | TimelineToolBundleRow;
type TimelineAssistantStepChildTestRows =
  readonly TimelineAssistantStepChildTestRow[];
type TimelineRowList = readonly TimelineRow[];
type OptionalTimelineRow = TimelineRow | undefined;
type ViewProjectionEntry = ViewProjection["entries"][number];

interface MessageFixtureArgs {
  createdAt?: number;
  id: string;
  sourceSeq: number;
  turnId?: string;
}

interface CommandFixtureArgs extends MessageFixtureArgs {
  command: string;
  status?: ViewCommandMessage["status"];
}

interface ToolCallFixtureArgs extends MessageFixtureArgs {
  path?: string | null;
  query?: string | null;
  toolName: string;
  type: "read" | "search";
}

interface AssistantFixtureArgs extends MessageFixtureArgs {
  status?: ViewAssistantTextMessage["status"];
  text: string;
}

interface UserFixtureArgs extends MessageFixtureArgs {
  text: string;
}

interface TurnFixtureArgs {
  completedAt: number | null;
  createdAt: number;
  messages: ViewTurn["messages"];
  status: ViewTurn["status"];
  terminalMessage?: ViewTurn["terminalMessage"];
}

function commandMessage(args: CommandFixtureArgs): ViewCommandMessage {
  return {
    kind: "command",
    id: args.id,
    threadId: "thread-1",
    turnId: args.turnId ?? "turn-1",
    sourceSeqStart: args.sourceSeq,
    sourceSeqEnd: args.sourceSeq,
    createdAt: args.createdAt ?? args.sourceSeq,
    scope: turnScope(args.turnId ?? "turn-1"),
    callId: `call-${args.id}`,
    command: args.command,
    parsedIntents: [],
    status: args.status ?? "completed",
    approvalStatus: null,
  };
}

function toolCallMessage(args: ToolCallFixtureArgs): ViewToolCallMessage {
  const parsedIntents: ViewToolParsedIntent[] =
    args.type === "read"
      ? [
          {
            type: "read",
            cmd: `${args.toolName} ${args.path ?? ""}`.trim(),
            name: args.toolName,
            path: args.path ?? "src/file.ts",
          },
        ]
      : [
          {
            type: "search",
            cmd: `${args.toolName} ${args.query ?? ""}`.trim(),
            query: args.query ?? "query",
            path: args.path ?? null,
          },
        ];

  return {
    kind: "tool-call",
    id: args.id,
    threadId: "thread-1",
    turnId: args.turnId ?? "turn-1",
    sourceSeqStart: args.sourceSeq,
    sourceSeqEnd: args.sourceSeq,
    createdAt: args.createdAt ?? args.sourceSeq,
    scope: turnScope(args.turnId ?? "turn-1"),
    callId: `call-${args.id}`,
    toolName: args.toolName,
    toolArgs: null,
    parsedIntents,
    output: "done",
    approvalStatus: null,
    status: "completed",
  };
}

function assistantMessage(
  args: AssistantFixtureArgs,
): ViewAssistantTextMessage {
  return {
    kind: "assistant-text",
    id: args.id,
    threadId: "thread-1",
    turnId: args.turnId ?? "turn-1",
    sourceSeqStart: args.sourceSeq,
    sourceSeqEnd: args.sourceSeq,
    createdAt: args.createdAt ?? args.sourceSeq,
    scope: turnScope(args.turnId ?? "turn-1"),
    text: args.text,
    status: args.status ?? "completed",
  };
}

function userMessage(args: UserFixtureArgs): ViewUserMessage {
  return {
    kind: "user",
    id: args.id,
    threadId: "thread-1",
    turnId: args.turnId ?? "turn-1",
    sourceSeqStart: args.sourceSeq,
    sourceSeqEnd: args.sourceSeq,
    createdAt: args.createdAt ?? args.sourceSeq,
    scope: turnScope(args.turnId ?? "turn-1"),
    text: args.text,
  };
}

function turnEntry(args: TurnFixtureArgs): ViewProjectionEntry {
  return {
    kind: "turn",
    turn: {
      turnId: "turn-1",
      threadId: "thread-1",
      sourceSeqStart: 1,
      sourceSeqEnd: args.createdAt,
      startedAt: 1,
      createdAt: args.createdAt,
      completedAt: args.completedAt,
      status: args.status,
      summaryCount: args.messages?.length ?? 0,
      durationMs: args.completedAt === null ? undefined : args.completedAt - 1,
      terminalMessage: args.terminalMessage,
      messages: args.messages,
    },
  };
}

function expectMessageRow(row: OptionalTimelineRow): TimelineMessageRow {
  expect(row?.kind).toBe("message");
  if (!row || row.kind !== "message") {
    throw new Error("Expected message row");
  }
  return row;
}

function expectTurnSummaryRow(
  row: OptionalTimelineRow,
): TimelineTurnSummaryRow {
  expect(row?.kind).toBe("turn-summary");
  if (!row || row.kind !== "turn-summary") {
    throw new Error("Expected turn-summary row");
  }
  return row;
}

function collectLeafMessageIds(rows: TimelineRowList): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    switch (row.kind) {
      case "message":
        ids.push(row.message.id);
        break;
      case "tool-bundle":
        ids.push(...row.rows.map((child) => child.message.id));
        break;
      case "assistant-step-summary":
        ids.push(...collectAssistantStepLeafMessageIds(row.rows));
        break;
      case "turn-summary":
        ids.push(...collectLeafMessageIds(row.rows ?? []));
        break;
      default:
        break;
    }
  }
  return ids;
}

function collectAssistantStepLeafMessageIds(
  rows: TimelineAssistantStepChildTestRows,
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.kind === "message") {
      ids.push(row.message.id);
      continue;
    }
    ids.push(...row.rows.map((child) => child.message.id));
  }
  return ids;
}

describe("timeline grouping boundary", () => {
  it("keeps assistant text as a boundary inside completed turn groups", () => {
    const assistantOne = assistantMessage({
      id: "assistant-1",
      sourceSeq: 2,
      text: "Now checking the label.",
    });
    const assistantTwo = assistantMessage({
      id: "assistant-2",
      sourceSeq: 5,
      text: "The label resolves correctly.",
    });
    const projection: ViewProjection = {
      entries: [
        turnEntry({
          completedAt: 5,
          createdAt: 5,
          status: "completed",
          terminalMessage: assistantTwo,
          messages: [
            toolCallMessage({
              id: "read-1",
              sourceSeq: 1,
              toolName: "Read",
              type: "read",
              path: "src/deburr.ts",
            }),
            assistantOne,
            toolCallMessage({
              id: "search-1",
              sourceSeq: 3,
              toolName: "Grep",
              type: "search",
              query: "search",
              path: "src/locales/en.json",
            }),
            commandMessage({
              id: "command-1",
              sourceSeq: 4,
              command: "python3 -c 'print(\"Search\")'",
            }),
            assistantTwo,
          ],
        }),
      ],
    };

    const rows = buildGroupedTimelineRows(projection, {
      includeNestedRows: true,
    });

    expect(rows.map((row) => row.kind)).toEqual(["turn-summary", "message"]);
    const turnSummary = expectTurnSummaryRow(rows[0]);
    expect(turnSummary.rows?.map((row) => row.kind)).toEqual([
      "tool-bundle",
      "message",
      "assistant-step-summary",
    ]);
    expect(collectLeafMessageIds(turnSummary.rows ?? [])).toEqual([
      "read-1",
      "assistant-1",
      "search-1",
      "command-1",
    ]);
    expect(expectMessageRow(rows[1]).message.id).toBe("assistant-2");
  });

  it("keeps user steers as hard boundaries for completed turn grouping", () => {
    const assistant = assistantMessage({
      id: "assistant-1",
      sourceSeq: 4,
      text: "Validation is complete.",
    });
    const projection: ViewProjection = {
      entries: [
        turnEntry({
          completedAt: 4,
          createdAt: 4,
          status: "completed",
          terminalMessage: assistant,
          messages: [
            commandMessage({
              id: "command-1",
              sourceSeq: 1,
              command: "pnpm test",
            }),
            userMessage({
              id: "user-1",
              sourceSeq: 2,
              text: "Run the focused package test instead.",
            }),
            commandMessage({
              id: "command-2",
              sourceSeq: 3,
              command: "pnpm exec turbo run test --filter=@bb/core-ui",
            }),
            assistant,
          ],
        }),
      ],
    };

    const rows = buildGroupedTimelineRows(projection, {
      includeNestedRows: true,
    });

    expect(rows.map((row) => row.kind)).toEqual([
      "tool-bundle",
      "message",
      "turn-summary",
      "message",
    ]);
    expect(collectLeafMessageIds([rows[0]!])).toEqual(["command-1"]);
    expect(expectMessageRow(rows[1]).message.id).toBe("user-1");
    expect(
      collectLeafMessageIds(expectTurnSummaryRow(rows[2]).rows ?? []),
    ).toEqual(["command-2"]);
    expect(expectMessageRow(rows[3]).message.id).toBe("assistant-1");
  });

  it("does not make stale pending work in completed turns look active", () => {
    const assistant = assistantMessage({
      id: "assistant-1",
      sourceSeq: 2,
      text: "The disconnected command is no longer active.",
    });
    const projection: ViewProjection = {
      entries: [
        turnEntry({
          completedAt: 2,
          createdAt: 2,
          status: "completed",
          terminalMessage: assistant,
          messages: [
            commandMessage({
              id: "command-1",
              sourceSeq: 1,
              command: "pnpm test",
              status: "pending",
            }),
            assistant,
          ],
        }),
      ],
    };

    const text = formatTimelineAsText(buildGroupedTimelineRows(projection), {
      color: false,
    });

    expect(text).toContain("Worked on");
    expect(text).not.toContain("Running 1 command");
  });

  it("uses active labels for grouped tail work inside active turns", () => {
    const projection: ViewProjection = {
      entries: [
        turnEntry({
          completedAt: null,
          createdAt: 3,
          status: "pending",
          messages: [
            userMessage({
              id: "user-1",
              sourceSeq: 1,
              text: "Run validation.",
            }),
            commandMessage({
              id: "command-1",
              sourceSeq: 2,
              command: "pnpm test",
              status: "pending",
            }),
            commandMessage({
              id: "command-2",
              sourceSeq: 3,
              command: "pnpm exec turbo run typecheck --filter=@bb/core-ui",
              status: "pending",
            }),
          ],
        }),
      ],
    };

    const text = formatTimelineAsText(buildGroupedTimelineRows(projection), {
      color: false,
    });

    expect(text).toContain("Running 2 commands");
  });
});
