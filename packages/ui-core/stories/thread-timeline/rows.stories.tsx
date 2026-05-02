import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import type {
  TimelineActivityIntent,
  TimelineCommandWorkRow,
  TimelineConversationAttachments,
  TimelineConversationRow,
  TimelineConversationUserRequest,
  TimelineDelegationWorkRow,
  TimelineFileChange,
  TimelineFileChangeWorkRow,
  TimelineRow,
  TimelineRowBase,
  TimelineRowStatus,
  TimelineSystemRow,
  TimelineTurnRow,
  TimelineWebFetchWorkRow,
  TimelineWebSearchWorkRow,
} from "@bb/server-contract";
import { ConversationTimeline, ThreadTimelineRows } from "../../src/index.js";

export default {
  title: "Thread Timeline/Rows",
};

interface BaseRowArgs {
  id: string;
  seq: number;
  turnId?: string | null;
}

interface ConversationRowArgs {
  attachments?: TimelineConversationAttachments | null;
  id: string;
  role: TimelineConversationRow["role"];
  seq: number;
  text: string;
  userRequest?: TimelineConversationUserRequest;
}

interface CommandRowArgs {
  activityIntents?: TimelineActivityIntent[];
  command: string;
  durationMs?: number | null;
  exitCode?: number | null;
  id: string;
  output?: string;
  seq: number;
  status?: TimelineRowStatus;
}

interface FileChangeRowArgs {
  change: TimelineFileChange;
  id: string;
  seq: number;
  status?: TimelineRowStatus;
}

interface TimelineRowsStoryProps {
  rows: TimelineRow[];
  threadRuntimeDisplayStatus?: ThreadRuntimeDisplayStatus;
  turnSummaryRowsById?: Record<string, TimelineRow[]>;
}

function baseRow({ id, seq, turnId = "turn-1" }: BaseRowArgs): TimelineRowBase {
  return {
    id,
    threadId: "thread-1",
    turnId,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
  };
}

function conversationRow({
  attachments = null,
  id,
  role,
  seq,
  text,
  userRequest,
}: ConversationRowArgs): TimelineConversationRow {
  return role === "user"
    ? {
        ...baseRow({ id, seq }),
        kind: "conversation",
        role,
        text,
        attachments,
        userRequest: userRequest ?? { kind: "message", status: "accepted" },
      }
    : {
        ...baseRow({ id, seq }),
        kind: "conversation",
        role,
        text,
        attachments,
        userRequest: null,
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

function commandRow({
  activityIntents = [],
  command,
  durationMs = 2_300,
  exitCode = 0,
  id,
  output = "",
  seq,
  status = "completed",
}: CommandRowArgs): TimelineCommandWorkRow {
  return {
    ...baseRow({ id, seq }),
    kind: "work",
    workKind: "command",
    status,
    callId: id,
    command,
    cwd: "/workspace/bb",
    source: "exec_command",
    output,
    exitCode,
    durationMs,
    approvalStatus: null,
    activityIntents,
  };
}

function fileChangeRow({
  change,
  id,
  seq,
  status = "completed",
}: FileChangeRowArgs): TimelineFileChangeWorkRow {
  return {
    ...baseRow({ id, seq }),
    kind: "work",
    workKind: "file-change",
    status,
    callId: id,
    change,
    stdout: null,
    stderr: null,
    approvalStatus: null,
  };
}

function webSearchRow(seq: number): TimelineWebSearchWorkRow {
  return {
    ...baseRow({ id: "web-search-1", seq }),
    kind: "work",
    workKind: "web-search",
    status: "completed",
    callId: "web-search-1",
    queries: ["React timeline renderer"],
    resultText: "Search result summary",
  };
}

function webFetchRow(seq: number): TimelineWebFetchWorkRow {
  return {
    ...baseRow({ id: "web-fetch-1", seq }),
    kind: "work",
    workKind: "web-fetch",
    status: "completed",
    callId: "web-fetch-1",
    url: "https://example.com/thread-view",
    prompt: null,
    pattern: null,
    resultText: "Fetched page text",
  };
}

function systemRow(): TimelineSystemRow {
  return {
    ...baseRow({ id: "system-1", seq: 8, turnId: null }),
    kind: "system",
    systemKind: "operation",
    title: "Provisioned workspace",
    detail: "Created branch codex/react-timeline-renderer",
    status: "completed",
  };
}

function lazyTurnRow(): TimelineTurnRow {
  return {
    ...baseRow({ id: "turn-summary-1", seq: 9 }),
    kind: "turn",
    status: "completed",
    summaryCount: 4,
    durationMs: 18_000,
    children: null,
  };
}

function delegationRow(): TimelineDelegationWorkRow {
  return {
    ...baseRow({ id: "delegation-1", seq: 2 }),
    kind: "work",
    workKind: "delegation",
    status: "pending",
    callId: "delegation-1",
    toolName: "spawnAgent",
    subagentType: "general-purpose",
    description: "Review renderer edge cases",
    output: "",
    durationMs: 38_000,
    childRows: [
      conversationRow({
        id: "delegation-child-message-1",
        role: "assistant",
        seq: 3,
        text: "Checking expansion and scroll behavior.",
      }),
      commandRow({
        id: "delegation-child-command-1",
        command: "pnpm exec turbo run test --filter=@bb/ui-core",
        output: "RUN  v4.1.1\n10 tests passed\nwatching for more output...",
        seq: 4,
        status: "pending",
        durationMs: 11_000,
        exitCode: null,
      }),
    ],
  };
}

function TimelineRowsStory({
  rows,
  threadRuntimeDisplayStatus = "idle",
  turnSummaryRowsById = {},
}: TimelineRowsStoryProps) {
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-3xl rounded-md border border-border/70 bg-background p-4">
        <ConversationTimeline>
          <ThreadTimelineRows
            loadingTurnSummaryIds={new Set()}
            erroredTurnSummaryIds={new Set()}
            onLoadTurnSummaryRows={() => undefined}
            timelineRows={rows}
            threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
            turnSummaryRowsById={turnSummaryRowsById}
          />
        </ConversationTimeline>
      </div>
    </div>
  );
}

export function MixedRows() {
  return (
    <TimelineRowsStory
      rows={[
        conversationRow({
          id: "user-1",
          role: "user",
          seq: 1,
          text: "Please tighten the timeline renderer.",
        }),
        conversationRow({
          id: "assistant-1",
          role: "assistant",
          seq: 2,
          text: "I will audit the current timeline path first.",
        }),
        commandRow({
          id: "explore-1",
          command: "cat src/app.ts && rg Timeline src",
          activityIntents: [
            readIntent("src/app.ts"),
            searchIntent("Timeline", "src"),
          ],
          seq: 3,
          output: "large file contents omitted from compact exploration rows",
        }),
        commandRow({
          id: "command-1",
          command: "pnpm exec turbo run test --filter=@bb/ui-core",
          output: "Tests passed",
          seq: 4,
        }),
        fileChangeRow({
          id: "file-change-1",
          seq: 5,
          change: {
            path: "packages/ui-core/src/thread-timeline/ThreadTimelineRows.tsx",
            kind: "update",
            movePath: null,
            diff: "@@ -1 +1 @@\n-old\n+new",
            diffStats: {
              added: 12,
              removed: 3,
            },
          },
        }),
        webSearchRow(6),
        webFetchRow(7),
        systemRow(),
        lazyTurnRow(),
      ]}
      turnSummaryRowsById={{
        "turn-summary-1": [
          commandRow({
            id: "lazy-command-1",
            command: "git status --short",
            output: "M packages/ui-core/src/thread-timeline/ThreadTimelineRows.tsx",
            seq: 10,
          }),
        ],
      }}
    />
  );
}

export function ActiveStreamingRows() {
  return (
    <TimelineRowsStory
      threadRuntimeDisplayStatus="active"
      rows={[
        conversationRow({
          id: "user-active-1",
          role: "user",
          seq: 1,
          text: "Keep the active step visible while it streams.",
        }),
        commandRow({
          id: "active-read-1",
          command: "cat packages/ui-core/src/thread-timeline/ThreadTimelineRows.tsx",
          activityIntents: [
            readIntent("packages/ui-core/src/thread-timeline/ThreadTimelineRows.tsx"),
          ],
          output: "streaming file contents",
          seq: 2,
          status: "pending",
          durationMs: 8_000,
          exitCode: null,
        }),
        commandRow({
          id: "active-search-1",
          command: "rg ThreadTimelineRows packages/ui-core/src",
          activityIntents: [
            searchIntent("ThreadTimelineRows", "packages/ui-core/src"),
          ],
          output: "streaming search output",
          seq: 3,
          status: "pending",
          durationMs: 6_000,
          exitCode: null,
        }),
      ]}
    />
  );
}

export function NestedDelegationRows() {
  return (
    <TimelineRowsStory
      threadRuntimeDisplayStatus="active"
      rows={[
        conversationRow({
          id: "user-delegation-1",
          role: "user",
          seq: 1,
          text: "Use a subagent to review the renderer.",
        }),
        delegationRow(),
      ]}
    />
  );
}

export function FileDiffAndTerminalRows() {
  return (
    <TimelineRowsStory
      threadRuntimeDisplayStatus="active"
      rows={[
        commandRow({
          id: "terminal-1",
          command: "pnpm exec turbo run typecheck --filter=@bb/app",
          output: "\u001b[32mtypecheck passed\u001b[0m\nwaiting for next chunk...",
          seq: 1,
          status: "pending",
          durationMs: 12_000,
          exitCode: null,
        }),
        fileChangeRow({
          id: "diff-1",
          seq: 2,
          status: "pending",
          change: {
            path: "packages/ui-core/src/thread-timeline/TimelineTitleView.tsx",
            kind: "update",
            movePath: null,
            diff: "@@ -1 +1 @@\n-before\n+after",
            diffStats: {
              added: 1,
              removed: 1,
            },
          },
        }),
      ]}
    />
  );
}
