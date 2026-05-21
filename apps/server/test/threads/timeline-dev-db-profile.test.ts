import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  getThread,
  listRecentStoredEventRows,
  type DbConnection,
} from "@bb/db";
import { THREAD_TIMELINE_EXCLUDED_EVENT_TYPES } from "@bb/thread-view";
import type { Thread } from "@bb/domain";
import {
  profileThreadTimeline,
  type ThreadTimelineBuildProfile,
  type ThreadTimelineBuildProfileStage,
  type ThreadTimelineEventSelectionStrategy,
  type ThreadTimelineServiceViewMode,
} from "../../src/services/threads/timeline.js";

interface DevDbSnapshot {
  cleanup: () => void;
  db: DbConnection;
}

interface TimelineProfileScenario {
  expectedSelectionStrategies: readonly ThreadTimelineEventSelectionStrategy[];
  id: string;
  maxSelectedEventRowRatio?: number;
  segmentLimit: number;
  threadId: string;
  timelineViewMode: ThreadTimelineServiceViewMode;
}

interface TimelineProfileSample {
  profile: ThreadTimelineBuildProfile;
  totalMs: number;
}

type TimelineProfileStageDurations = Record<
  ThreadTimelineBuildProfileStage,
  number
>;

const DEV_DB_PATH = process.env.BB_TIMELINE_PROFILE_DB;
const PROFILE_OUTPUT_PATH = process.env.BB_TIMELINE_PROFILE_OUTPUT;
const PROFILE_ITERATIONS = parsePositiveInteger(
  process.env.BB_TIMELINE_PROFILE_ITERATIONS,
  5,
);
const PROFILE_WARMUP_ITERATIONS = parsePositiveInteger(
  process.env.BB_TIMELINE_PROFILE_WARMUP_ITERATIONS,
  1,
);

const PROFILE_SCENARIOS: readonly TimelineProfileScenario[] = [
  {
    id: "target-manager-conversation",
    expectedSelectionStrategies: ["manager-conversation-window"],
    maxSelectedEventRowRatio: 0.6,
    threadId: "thr_bj3p5vk9py",
    timelineViewMode: "manager-conversation",
    segmentLimit: 30,
  },
  {
    id: "target-manager-standard",
    expectedSelectionStrategies: ["standard-window"],
    maxSelectedEventRowRatio: 0.25,
    threadId: "thr_bj3p5vk9py",
    timelineViewMode: "standard",
    segmentLimit: 30,
  },
  {
    id: "regular-standard-large",
    expectedSelectionStrategies: ["standard-window"],
    maxSelectedEventRowRatio: 0.95,
    threadId: "thr_qfk8ksbxkk",
    timelineViewMode: "standard",
    segmentLimit: 20,
  },
  {
    id: "regular-standard-medium",
    expectedSelectionStrategies: ["full", "standard-window"],
    threadId: "thr_eqm8uijebf",
    timelineViewMode: "standard",
    segmentLimit: 20,
  },
] as const;

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function canRunDevDbProfile(): boolean {
  return DEV_DB_PATH !== undefined && existsSync(DEV_DB_PATH);
}

function resetProfileOutput(): void {
  if (PROFILE_OUTPUT_PATH === undefined) {
    return;
  }
  writeFileSync(PROFILE_OUTPUT_PATH, "");
}

function writeProfileLine(line: string): void {
  if (PROFILE_OUTPUT_PATH === undefined) {
    console.info(line);
    return;
  }
  appendFileSync(PROFILE_OUTPUT_PATH, `${line}\n`);
}

async function createDevDbSnapshot(sourcePath: string): Promise<DevDbSnapshot> {
  const sourceDb = createConnection(sourcePath);
  const snapshotDir = mkdtempSync(join(tmpdir(), "bb-timeline-profile-"));
  const snapshotPath = join(snapshotDir, "bb.db");
  let backupSucceeded = false;
  try {
    await sourceDb.$client.backup(snapshotPath);
    backupSucceeded = true;
  } finally {
    sourceDb.$client.close();
    if (!backupSucceeded) {
      rmSync(snapshotDir, { recursive: true, force: true });
    }
  }

  return {
    db: createConnection(snapshotPath),
    cleanup: () => {
      rmSync(snapshotDir, { recursive: true, force: true });
    },
  };
}

function requireDevThread(db: DbConnection, threadId: string): Thread {
  const thread = getThread(db, threadId);
  if (!thread) {
    throw new Error(`Expected dev DB thread ${threadId}`);
  }
  return thread;
}

function countFullTimelineEventRows(
  db: DbConnection,
  threadId: string,
): number {
  return listRecentStoredEventRows(db, {
    excludedTypes: THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
    threadId,
  }).length;
}

function expectProfileMatchesScenario(
  db: DbConnection,
  profile: ThreadTimelineBuildProfile,
  scenario: TimelineProfileScenario,
): void {
  const fullEventRowCount = countFullTimelineEventRows(db, scenario.threadId);
  expect(scenario.expectedSelectionStrategies).toContain(
    profile.selectionStrategy,
  );

  expect(profile.eventRowCount).toBeLessThanOrEqual(fullEventRowCount);
  if (
    profile.selectionStrategy === "standard-window" ||
    profile.selectionStrategy === "manager-conversation-window"
  ) {
    expect(profile.eventRowCount).toBeLessThan(fullEventRowCount);
  }
  if (scenario.maxSelectedEventRowRatio === undefined) {
    return;
  }

  const maxSelectedEventRowCount = Math.ceil(
    fullEventRowCount * scenario.maxSelectedEventRowRatio,
  );
  expect(profile.eventRowCount).toBeLessThanOrEqual(maxSelectedEventRowCount);
}

function sumStageTimings(profile: ThreadTimelineBuildProfile): number {
  let totalMs = 0;
  for (const timing of profile.stageTimings) {
    totalMs += timing.durationMs;
  }
  return totalMs;
}

function stageDurations(
  profile: ThreadTimelineBuildProfile,
): TimelineProfileStageDurations {
  const durations: TimelineProfileStageDurations = {
    "accepted-client-request-context-query": 0,
    "context-window-json-decode": 0,
    "context-window-query": 0,
    "event-json-decode": 0,
    "event-query": 0,
    "pagination-segmentation": 0,
    "response-serialization": 0,
    "summary-compaction": 0,
    "thread-view-projection": 0,
  };
  for (const timing of profile.stageTimings) {
    durations[timing.stage] += timing.durationMs;
  }
  return durations;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundedStageDurations(
  profile: ThreadTimelineBuildProfile,
): TimelineProfileStageDurations {
  const durations = stageDurations(profile);
  return {
    "accepted-client-request-context-query": roundMetric(
      durations["accepted-client-request-context-query"],
    ),
    "context-window-json-decode": roundMetric(
      durations["context-window-json-decode"],
    ),
    "context-window-query": roundMetric(durations["context-window-query"]),
    "event-json-decode": roundMetric(durations["event-json-decode"]),
    "event-query": roundMetric(durations["event-query"]),
    "pagination-segmentation": roundMetric(
      durations["pagination-segmentation"],
    ),
    "response-serialization": roundMetric(durations["response-serialization"]),
    "summary-compaction": roundMetric(durations["summary-compaction"]),
    "thread-view-projection": roundMetric(durations["thread-view-projection"]),
  };
}

function runProfileSample(
  db: DbConnection,
  thread: Thread,
  scenario: TimelineProfileScenario,
): TimelineProfileSample {
  const result = profileThreadTimeline(db, thread, {
    isDevelopment: true,
    page: {
      kind: "latest",
      segmentLimit: scenario.segmentLimit,
    },
    timelineViewMode: scenario.timelineViewMode,
  });
  return {
    profile: result.profile,
    totalMs: sumStageTimings(result.profile),
  };
}

function chooseMedianSample(
  samples: readonly TimelineProfileSample[],
): TimelineProfileSample {
  const sortedSamples = [...samples].sort(
    (left, right) => left.totalMs - right.totalMs,
  );
  const sample = sortedSamples[Math.floor(sortedSamples.length / 2)];
  if (!sample) {
    throw new Error("Expected at least one timeline profile sample");
  }
  return sample;
}

function runScenarioProfile(
  db: DbConnection,
  scenario: TimelineProfileScenario,
): TimelineProfileSample {
  const thread = requireDevThread(db, scenario.threadId);
  for (let index = 0; index < PROFILE_WARMUP_ITERATIONS; index += 1) {
    runProfileSample(db, thread, scenario);
  }

  const samples: TimelineProfileSample[] = [];
  for (let index = 0; index < PROFILE_ITERATIONS; index += 1) {
    samples.push(runProfileSample(db, thread, scenario));
  }
  return chooseMedianSample(samples);
}

describe.skipIf(!canRunDevDbProfile())("timeline dev DB profile", () => {
  it("prints stage timings for representative timeline requests", async () => {
    if (DEV_DB_PATH === undefined) {
      throw new Error("BB_TIMELINE_PROFILE_DB is required");
    }
    const snapshot = await createDevDbSnapshot(DEV_DB_PATH);
    resetProfileOutput();
    try {
      for (const scenario of PROFILE_SCENARIOS) {
        const sample = runScenarioProfile(snapshot.db, scenario);
        const profile = sample.profile;
        expectProfileMatchesScenario(snapshot.db, profile, scenario);
        writeProfileLine(
          `[timeline-profile] ${JSON.stringify({
            compactedEventCount: profile.compactedEventCount,
            contextWindowEventDataBytes: profile.contextWindowEventDataBytes,
            contextWindowEventRowCount: profile.contextWindowEventRowCount,
            decodedEventCount: profile.decodedEventCount,
            eventDataBytes: profile.eventDataBytes,
            eventRowCount: profile.eventRowCount,
            id: scenario.id,
            pageKind: profile.pageKind,
            projectedRowCount: profile.projectedRowCount,
            responseJsonBytes: profile.responseJsonBytes,
            responseRowCount: profile.responseRowCount,
            returnedSegmentCount: profile.returnedSegmentCount,
            segmentLimit: profile.segmentLimit,
            selectionStrategy: profile.selectionStrategy,
            stagesMs: roundedStageDurations(profile),
            threadId: scenario.threadId,
            timelineViewMode: profile.timelineViewMode,
            totalMs: roundMetric(sample.totalMs),
          })}`,
        );
        expect(profile.responseRowCount).toBeGreaterThan(0);
      }
    } finally {
      snapshot.db.$client.close();
      snapshot.cleanup();
    }
  }, 120_000);
});
