import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  deriveStoredEventItemFields,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import {
  buildTimelineRows,
  decodeRow,
  extractThreadContextWindowUsage,
  toViewMessages,
  type ThreadEventWithMeta,
} from "@bb/core-ui";
import { replayFixtures } from "@bb/provider-audit";
import { buildThreadEvent } from "@bb/domain";
import type { ThreadEventRow, ViewMessage } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import {
  buildThreadTimeline,
  compactSummaryStoredEventRows,
} from "../../src/services/timeline.js";
import {
  type StoredEventRow,
  listRecentStoredEventRows,
  listTokenUsageRowsForContextWindowUsage,
  parseStoredEventRow,
} from "../../src/services/thread-data.js";

interface TimelineBenchmarkFixture {
  corpusId: string;
  providerId: string;
  taskId: string;
}

export interface TimelineBenchmarkScenario {
  id: string;
  eventCount: number;
  summaryEventCount: number;
  summaryBytes: number;
  fullBytes: number;
  buildSummary: () => ThreadTimelineResponse;
  buildExpectedSummary: () => ThreadTimelineResponse;
  buildAndSerializeSummary: () => string;
  loadSummaryStoredRows: () => StoredEventRow[];
  loadTokenUsageRows: () => StoredEventRow[];
  compactSummaryStoredRows: () => StoredEventRow[];
  decodeSummaryEvents: () => ThreadEventWithMeta[];
  projectSummaryMessages: () => ViewMessage[];
  buildSummaryRowsOnly: () => ThreadTimelineResponse["rows"];
}

const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/provider-audit/fixtures",
);

const TIMELINE_BENCHMARK_FIXTURES: TimelineBenchmarkFixture[] = [
  {
    corpusId: "excalidraw",
    providerId: "codex",
    taskId: "collab-startup-explanation",
  },
  {
    corpusId: "excalidraw",
    providerId: "codex",
    taskId: "magicframe-feature",
  },
  {
    corpusId: "excalidraw",
    providerId: "pi",
    taskId: "command-palette-map",
  },
];

let cachedScenarios: TimelineBenchmarkScenario[] | null = null;
const TIMELINE_EXCLUDED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/tokenUsage/updated",
] as const;

function applyStoredMetadata(args: {
  row: ThreadEventRow;
  storedRow: StoredEventRow;
}): ThreadEventRow {
  return {
    ...args.row,
    createdAt: args.storedRow.createdAt,
    id: args.storedRow.id,
    seq: args.storedRow.sequence,
    threadId: args.storedRow.threadId,
  };
}

function createTimelineBenchmarkScenario(
  fixture: TimelineBenchmarkFixture,
): TimelineBenchmarkScenario {
  const replay = replayFixtures({
    fixtureRoot: FIXTURE_ROOT,
    corpusId: fixture.corpusId,
    providerId: fixture.providerId,
    taskId: fixture.taskId,
  }).fixtures[0];

  if (!replay) {
    throw new Error(
      `Missing provider-audit fixture ${fixture.corpusId}/${fixture.providerId}/${fixture.taskId}`,
    );
  }

  const db = createConnection(":memory:");
  migrate(db);

  const host = upsertHost(db, noopNotifier, {
    id: "host-bench",
    name: "Timeline Bench Host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: `Timeline Bench ${fixture.taskId}`,
    source: {
      type: "local_path",
      hostId: host.id,
      path: `/tmp/${fixture.taskId}`,
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: `/tmp/${fixture.taskId}`,
    status: "ready",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    branchName: "main",
    defaultBranch: "main",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: fixture.providerId,
    status: "idle",
    type: "standard",
    title: fixture.taskId,
    titleFallback: fixture.taskId,
    mergeBaseBranch: "main",
    parentThreadId: null,
  });

  insertEvents(
    db,
    noopNotifier,
    replay.bundle.threadEventRows.map((row) => ({
      threadId: thread.id,
      environmentId: environment.id,
      turnId: row.turnId ?? null,
      providerThreadId: row.providerThreadId ?? null,
      sequence: row.seq,
      type: row.type,
      ...deriveStoredEventItemFields(buildThreadEvent(row)),
      data: JSON.stringify(row.data),
    })),
  );
  const storedEventRows = listRecentStoredEventRows(db, {
    threadId: thread.id,
    excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
  });
  const summaryEventRows = compactSummaryStoredEventRows(storedEventRows);
  const fixtureEventRows = replay.bundle.threadEventRows;
  const summaryFixtureEventRows = fixtureEventRows.filter(
    (row) => TIMELINE_EXCLUDED_EVENT_TYPES.includes(row.type) === false,
  );
  const summaryStoredEventRowsBySequence = new Map(
    storedEventRows.map((row) => [row.sequence, row]),
  );
  const summaryExpectedEventRows = summaryFixtureEventRows.map((row) => {
    const storedRow = summaryStoredEventRowsBySequence.get(row.seq);
    if (!storedRow) {
      throw new Error(`Missing stored row for summary event sequence ${row.seq}`);
    }
    return applyStoredMetadata({
      row,
      storedRow,
    });
  });
  const decodedSummaryEvents = summaryEventRows.map((row) => decodeRow(parseStoredEventRow(row)));
  const summaryMessages = toViewMessages(decodedSummaryEvents, {
    threadStatus: thread.status,
    threadType: thread.type,
  });

  const buildSummary = () => buildThreadTimeline(db, thread, {});
  const buildExpectedSummary = () => {
    const messages = toViewMessages(
      summaryExpectedEventRows.map((row) => decodeRow(row)),
      {
        threadStatus: thread.status,
        threadType: thread.type,
      },
    );

    return {
      rows: buildTimelineRows(messages, {
        includeToolGroupMessages: false,
      }),
      contextWindowUsage:
        extractThreadContextWindowUsage(fixtureEventRows) ?? undefined,
    };
  };
  const buildAndSerializeSummary = () => JSON.stringify(buildSummary());
  const loadSummaryStoredRows = () =>
    listRecentStoredEventRows(db, {
      threadId: thread.id,
      excludedTypes: TIMELINE_EXCLUDED_EVENT_TYPES,
    });
  const compactSummaryStoredRows = () => compactSummaryStoredEventRows(storedEventRows);
  const loadTokenUsageRows = () =>
    listTokenUsageRowsForContextWindowUsage(db, {
      threadId: thread.id,
    });
  const decodeSummaryEvents = () =>
    summaryEventRows.map((row) => decodeRow(parseStoredEventRow(row)));
  const projectSummaryMessages = () =>
    toViewMessages(decodedSummaryEvents, {
      threadStatus: thread.status,
      threadType: thread.type,
    });
  const buildSummaryRowsOnly = () =>
    buildTimelineRows(summaryMessages, {
      includeToolGroupMessages: false,
    });
  const summaryBytes = Buffer.byteLength(buildAndSerializeSummary(), "utf8");
  const fullBytes = Buffer.byteLength(
    JSON.stringify(
      buildThreadTimeline(db, thread, {
        includeToolGroupMessages: true,
      }),
    ),
    "utf8",
  );

  return {
    id: `${fixture.corpusId}/${fixture.providerId}/${fixture.taskId}`,
    eventCount: fixtureEventRows.length,
    summaryEventCount: summaryEventRows.length,
    summaryBytes,
    fullBytes,
    buildSummary,
    buildExpectedSummary,
    buildAndSerializeSummary,
    loadSummaryStoredRows,
    loadTokenUsageRows,
    compactSummaryStoredRows,
    decodeSummaryEvents,
    projectSummaryMessages,
    buildSummaryRowsOnly,
  };
}

export function getTimelineBenchmarkScenarios(): TimelineBenchmarkScenario[] {
  if (cachedScenarios) {
    return cachedScenarios;
  }

  cachedScenarios = TIMELINE_BENCHMARK_FIXTURES.map((fixture) =>
    createTimelineBenchmarkScenario(fixture),
  );
  return cachedScenarios;
}
